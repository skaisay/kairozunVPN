const { execFile, exec, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const WarpClient = require('./warp-client');

class VPNManager {
  constructor() {
    this.connected = false;
    this.currentProcess = null;
    this.configDir = path.join(os.homedir(), '.kairozun-vpn');
    this.serversFile = path.join(this.configDir, 'servers.json');
    this.warpDataFile = path.join(this.configDir, 'warp-data.json');
    this.settingsFile = path.join(this.configDir, 'settings.json');
    this.activeInterface = 'kairozun0';
    this.trafficData = { sent: 0, received: 0, ip: null };
    this.warpClient = new WarpClient();
    this.warpData = null;

    this.ensureConfigDir();
    this.loadWarpData();
  }

  ensureConfigDir() {
    if (!fs.existsSync(this.configDir)) {
      fs.mkdirSync(this.configDir, { recursive: true });
    }
  }

  // ===== WARP (бесплатный VPN) =====

  loadWarpData() {
    try {
      if (fs.existsSync(this.warpDataFile)) {
        this.warpData = JSON.parse(fs.readFileSync(this.warpDataFile, 'utf-8'));
      }
    } catch {
      this.warpData = null;
    }
  }

  saveWarpData(data) {
    this.warpData = data;
    fs.writeFileSync(this.warpDataFile, JSON.stringify(data, null, 2), { encoding: 'utf-8' });
  }

  /**
   * Автоматическая настройка WARP.
   * Генерирует ключи, регистрируется в Cloudflare, создаёт конфиги.
   */
  async setupWarp() {
    // Генерируем ключи WireGuard
    const keys = await this.generateKeys();
    const privateKey = keys.privateKey;
    const publicKey = keys.publicKey;

    // Регистрируемся в Cloudflare WARP
    const registration = await this.warpClient.register(privateKey, publicKey);

    // Сохраняем данные
    const warpData = {
      privateKey,
      publicKey,
      regId: registration.id,
      token: registration.token,
      config: registration.config,
      createdAt: new Date().toISOString()
    };
    this.saveWarpData(warpData);

    // Создаём серверы для каждого endpoint
    const endpoints = this.warpClient.getEndpoints();
    const servers = [];

    for (let i = 0; i < endpoints.length; i++) {
      const ep = endpoints[i];
      // Пропускаем IPv6 endpoints для простоты
      if (ep.host.startsWith('[')) continue;

      const serverId = `warp-${ep.location.toLowerCase()}`;
      const config = JSON.parse(JSON.stringify(registration.config.parsed));
      config.Peer.Endpoint = ep.host;

      servers.push({
        id: serverId,
        name: `WARP — ${ep.label}`,
        endpoint: ep.host,
        flag: ep.flag || ep.location,
        country: ep.country || 'Cloudflare Network',
        type: 'warp',
        config: config,
        configRaw: this.buildWireGuardConfig(config)
      });
    }

    this.saveServers(servers);
    return servers;
  }

  /**
   * Перегенерировать WARP-конфигурацию (для смены IP)
   */
  async refreshWarp() {
    if (this.connected) {
      await this.disconnect();
    }

    // Удаляем старые данные, создаём новые
    this.warpData = null;
    if (fs.existsSync(this.warpDataFile)) {
      fs.unlinkSync(this.warpDataFile);
    }

    return await this.setupWarp();
  }

  /**
   * Проверяет, настроен ли WARP
   */
  isWarpSetup() {
    return this.warpData !== null && this.warpData.config !== null;
  }

  // ===== Серверы =====

  getServers() {
    try {
      if (fs.existsSync(this.serversFile)) {
        const data = fs.readFileSync(this.serversFile, 'utf-8');
        return JSON.parse(data);
      }
    } catch {
      // Файл поврежден
    }
    return [];
  }

  saveServers(servers) {
    fs.writeFileSync(this.serversFile, JSON.stringify(servers, null, 2), { encoding: 'utf-8' });
  }

  removeServer(serverId) {
    const servers = this.getServers();
    const filtered = servers.filter(s => s.id !== serverId);
    this.saveServers(filtered);

    const confPath = path.join(this.configDir, `${serverId}.conf`);
    if (fs.existsSync(confPath)) {
      fs.unlinkSync(confPath);
    }
  }

  // ===== Импорт конфигурации =====

  async importConfig(configPath) {
    const content = fs.readFileSync(configPath, 'utf-8');
    const parsed = this.parseWireGuardConfig(content);

    const serverId = 'custom-' + crypto.randomUUID().slice(0, 8);
    const serverName = path.basename(configPath, '.conf');

    let endpoint = 'Пользовательский сервер';
    let flag = 'USR';
    if (parsed.Peer && parsed.Peer.Endpoint) {
      endpoint = parsed.Peer.Endpoint;
      flag = this.guessCountryFlag(endpoint);
    }

    const server = {
      id: serverId,
      name: serverName,
      endpoint: endpoint,
      flag: flag,
      type: 'custom',
      config: parsed,
      configRaw: content
    };

    const confPath = path.join(this.configDir, `${serverId}.conf`);
    fs.writeFileSync(confPath, content, { encoding: 'utf-8' });

    const servers = this.getServers();
    servers.push(server);
    this.saveServers(servers);

    return server;
  }

  parseWireGuardConfig(content) {
    const config = {};
    let currentSection = null;

    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      const sectionMatch = trimmed.match(/^\[(\w+)\]$/);
      if (sectionMatch) {
        currentSection = sectionMatch[1];
        if (!config[currentSection]) config[currentSection] = {};
        continue;
      }

      const kvMatch = trimmed.match(/^(\w+)\s*=\s*(.+)$/);
      if (kvMatch && currentSection) {
        config[currentSection][kvMatch[1]] = kvMatch[2].trim();
      }
    }
    return config;
  }

  guessCountryFlag(endpoint) {
    const host = endpoint.split(':')[0].toLowerCase();
    const hints = {
      'de': 'DE', 'nl': 'NL', 'us': 'US', 'uk': 'UK', 'fi': 'FI',
      'se': 'SE', 'jp': 'JP', 'sg': 'SG', 'ca': 'CA', 'fr': 'FR',
      'germany': 'DE', 'amsterdam': 'NL', 'london': 'UK', 'tokyo': 'JP',
      'frankfurt': 'DE', 'helsinki': 'FI', 'stockholm': 'SE', 'paris': 'FR',
    };
    for (const [hint, code] of Object.entries(hints)) {
      if (host.includes(hint)) return code;
    }
    return 'VPN';
  }

  // ===== Подключение =====

  async connect(config) {
    if (this.connected) {
      await this.disconnect();
    }

    // Убираем IPv6 из AllowedIPs и Address — ломает интернет на Windows
    if (config.Peer && config.Peer.AllowedIPs) {
      config.Peer.AllowedIPs = config.Peer.AllowedIPs
        .split(',')
        .map(s => s.trim())
        .filter(s => !s.includes(':'))
        .join(', ') || '0.0.0.0/0';
    }
    if (config.Interface && config.Interface.Address) {
      config.Interface.Address = config.Interface.Address
        .split(',')
        .map(s => s.trim())
        .filter(s => !s.includes(':'))
        .join(', ');
    }
    // Добавляем PersistentKeepalive если нет
    if (config.Peer && !config.Peer.PersistentKeepalive) {
      config.Peer.PersistentKeepalive = '25';
    }

    const confContent = this.buildWireGuardConfig(config);
    const confPath = path.join(this.configDir, `${this.activeInterface}.conf`);
    fs.writeFileSync(confPath, confContent, { encoding: 'utf-8' });

    const platform = os.platform();

    if (platform === 'win32') {
      return await this.connectWindows(confPath);
    } else if (platform === 'linux') {
      return await this.connectLinux(confPath);
    } else if (platform === 'darwin') {
      return await this.connectMac(confPath);
    } else {
      throw new Error('Неподдерживаемая платформа');
    }
  }

  connectWindows(confPath) {
    return new Promise(async (resolve, reject) => {
      let wgExe = this.findWireGuardExe();

      if (!wgExe) {
        // Автоматически скачиваем и устанавливаем WireGuard
        try {
          await this.installWireGuard();
          wgExe = this.findWireGuardExe();
        } catch (e) {
          reject(new Error('Не удалось установить WireGuard: ' + e.message));
          return;
        }
      }

      if (!wgExe) {
        reject(new Error('WireGuard не найден после установки. Перезапустите приложение.'));
        return;
      }

      const serviceName = `WireGuardTunnel$${this.activeInterface}`;

      // Создаём PowerShell-скрипт для всех операций с правами администратора
      const psScript = `
        $wg = '${wgExe}'
        $iface = '${this.activeInterface}'
        $conf = '${confPath.replace(/\\/g, '\\\\').replace(/'/g, "''")}'
        
        # Удаляем старый туннель если есть
        try { & $wg /uninstalltunnelservice $iface 2>$null } catch {}
        Start-Sleep -Seconds 1
        
        # Устанавливаем новый туннель
        & $wg /installtunnelservice $conf
        if ($LASTEXITCODE -ne 0) { exit 1 }
        
        # Ждём пока сервис запустится
        Start-Sleep -Seconds 3
        
        # Проверяем сервис
        $svc = Get-Service -Name 'WireGuardTunnel$$iface' -ErrorAction SilentlyContinue
        if ($svc -and $svc.Status -eq 'Running') {
          Write-Output 'TUNNEL_OK'
        } else {
          Write-Output 'TUNNEL_FAIL'
        }
      `.trim();

      const scriptPath = path.join(this.configDir, 'connect.ps1');
      fs.writeFileSync(scriptPath, psScript, { encoding: 'utf-8' });

      // Запускаем с правами администратора
      const psCmd = `Start-Process -FilePath 'powershell.exe' -ArgumentList '-ExecutionPolicy','Bypass','-File','${scriptPath.replace(/'/g, "''")}' -Verb RunAs -Wait -WindowStyle Hidden`;
      
      exec(`powershell -Command "${psCmd}"`, { timeout: 30000 }, (error) => {
        // Очищаем скрипт
        try { fs.unlinkSync(scriptPath); } catch {}

        if (error) {
          reject(new Error('Подключение отменено или не удалось. Подтвердите запрос администратора (UAC).'));
          return;
        }

        // Проверяем статус сервиса (не требует прав админа)
        exec(`sc query "${serviceName}"`, { timeout: 5000 }, (err, stdout) => {
          if (!err && stdout && stdout.includes('RUNNING')) {
            this.connected = true;
            this.trafficData = { sent: 0, received: 0, ip: null };
            resolve({ connected: true });
          } else {
            // Подождём ещё и проверим
            setTimeout(() => {
              exec(`sc query "${serviceName}"`, { timeout: 5000 }, (err2, stdout2) => {
                if (!err2 && stdout2 && stdout2.includes('RUNNING')) {
                  this.connected = true;
                  this.trafficData = { sent: 0, received: 0, ip: null };
                  resolve({ connected: true });
                } else {
                  this.connected = false;
                  reject(new Error('Туннель WireGuard не запустился. Проверьте конфигурацию.'));
                }
              });
            }, 3000);
          }
        });
      });
    });
  }

  connectLinux(confPath) {
    return new Promise((resolve, reject) => {
      exec(`sudo wg-quick up "${confPath}"`, { timeout: 30000 }, (error) => {
        if (error) {
          reject(new Error(`Ошибка: ${error.message}`));
          return;
        }
        this.connected = true;
        this.trafficData = { sent: 0, received: 0, ip: null };
        resolve({ connected: true });
      });
    });
  }

  connectMac(confPath) {
    return new Promise((resolve, reject) => {
      exec(`sudo wg-quick up "${confPath}"`, { timeout: 30000 }, (error) => {
        if (error) {
          reject(new Error(`Ошибка: ${error.message}`));
          return;
        }
        this.connected = true;
        this.trafficData = { sent: 0, received: 0, ip: null };
        resolve({ connected: true });
      });
    });
  }

  findWireGuardExe() {
    const paths = [
      'C:\\Program Files\\WireGuard\\wireguard.exe',
      'C:\\Program Files (x86)\\WireGuard\\wireguard.exe',
      path.join(os.homedir(), 'AppData', 'Local', 'WireGuard', 'wireguard.exe')
    ];
    for (const p of paths) {
      if (fs.existsSync(p)) return p;
    }
    return null;
  }

  installWireGuard() {
    const https = require('https');
    const downloadUrl = 'https://download.wireguard.com/windows-client/wireguard-installer.exe';
    const installerPath = path.join(os.tmpdir(), 'wireguard-installer.exe');

    return new Promise((resolve, reject) => {
      console.log('[VPN] Скачиваю WireGuard...');
      const file = fs.createWriteStream(installerPath);

      const download = (url) => {
        https.get(url, (response) => {
          if (response.statusCode === 301 || response.statusCode === 302) {
            download(response.headers.location);
            return;
          }
          if (response.statusCode !== 200) {
            reject(new Error(`HTTP ${response.statusCode}`));
            return;
          }
          response.pipe(file);
          file.on('finish', () => {
            file.close();
            console.log('[VPN] Устанавливаю WireGuard...');
            exec(`"${installerPath}" /S /D=C:\\Program Files\\WireGuard`, { timeout: 120000 }, (error) => {
              // Удаляем установщик
              try { fs.unlinkSync(installerPath); } catch {}
              if (error) {
                // Попробуем msiexec если /S не работает
                exec(`Start-Process -FilePath "${installerPath}" -ArgumentList '/qn' -Verb RunAs -Wait`, { shell: 'powershell.exe', timeout: 120000 }, (err2) => {
                  try { fs.unlinkSync(installerPath); } catch {}
                  if (err2) reject(new Error('Ошибка установки WireGuard'));
                  else resolve();
                });
              } else {
                resolve();
              }
            });
          });
        }).on('error', reject);
      };
      download(downloadUrl);
    });
  }

  findWgExe() {
    const paths = [
      'C:\\Program Files\\WireGuard\\wg.exe',
      'C:\\Program Files (x86)\\WireGuard\\wg.exe'
    ];
    for (const p of paths) {
      if (fs.existsSync(p)) return p;
    }
    return 'wg';
  }

  // ===== Отключение =====

  async disconnect() {
    return new Promise((resolve) => {
      const platform = os.platform();

      if (platform === 'win32') {
        const wgExe = this.findWireGuardExe();
        if (wgExe) {
          const psCmd = `Start-Process -FilePath '${wgExe}' -ArgumentList '/uninstalltunnelservice','${this.activeInterface}' -Verb RunAs -Wait -WindowStyle Hidden`;
          exec(`powershell -Command "${psCmd}"`, { timeout: 15000 }, () => {
            this.connected = false;
            resolve();
          });
        } else {
          this.connected = false;
          resolve();
        }
      } else {
        const confPath = path.join(this.configDir, `${this.activeInterface}.conf`);
        exec(`sudo wg-quick down "${confPath}"`, { timeout: 10000 }, () => {
          this.connected = false;
          resolve();
        });
      }
    });
  }

  // ===== Статус =====

  async getStatus() {
    const platform = os.platform();
    if (platform === 'win32') {
      return this.getStatusWindows();
    }
    return new Promise((resolve) => {
      const wgExe = this.findWgExe();
      exec(`"${wgExe}" show`, { timeout: 5000 }, (error, stdout) => {
        if (error || !stdout || !stdout.trim()) {
          resolve({ connected: this.connected });
          return;
        }
        this.connected = true;
        resolve({ connected: true, details: stdout.trim() });
      });
    });
  }

  getStatusWindows() {
    return new Promise((resolve) => {
      const serviceName = `WireGuardTunnel$${this.activeInterface}`;
      exec(`sc query "${serviceName}"`, { timeout: 5000 }, (error, stdout) => {
        if (!error && stdout && stdout.includes('RUNNING')) {
          this.connected = true;
          resolve({ connected: true });
        } else {
          if (this.connected) {
            this.connected = false;
          }
          resolve({ connected: false });
        }
      });
    });
  }

  // ===== Трафик =====

  async getTraffic() {
    const platform = os.platform();
    if (platform === 'win32') {
      return this.getTrafficWindows();
    }
    return new Promise((resolve) => {
      const wgExe = this.findWgExe();
      exec(`"${wgExe}" show all transfer`, { timeout: 5000 }, (error, stdout) => {
        if (error || !stdout || !stdout.trim()) {
          resolve(this.trafficData);
          return;
        }
        let totalSent = 0;
        let totalReceived = 0;
        for (const line of stdout.trim().split('\n')) {
          const parts = line.split('\t');
          if (parts.length >= 3) {
            totalReceived += parseInt(parts[1]) || 0;
            totalSent += parseInt(parts[2]) || 0;
          }
        }
        this.trafficData.sent = totalSent;
        this.trafficData.received = totalReceived;
        resolve(this.trafficData);
      });
    });
  }

  getTrafficWindows() {
    return new Promise((resolve) => {
      // Используем Get-NetAdapterStatistics — не требует прав админа
      const psCmd = `Get-NetAdapterStatistics -Name '${this.activeInterface}' -ErrorAction SilentlyContinue | Select-Object -Property ReceivedBytes,SentBytes | ConvertTo-Json`;
      exec(`powershell -NoProfile -Command "${psCmd}"`, { timeout: 5000 }, (error, stdout) => {
        if (error || !stdout || !stdout.trim()) {
          // Фолбэк: пробуем через netstat
          this.getTrafficFallback().then(resolve);
          return;
        }
        try {
          const stats = JSON.parse(stdout.trim());
          this.trafficData.received = stats.ReceivedBytes || 0;
          this.trafficData.sent = stats.SentBytes || 0;
          resolve(this.trafficData);
        } catch {
          resolve(this.trafficData);
        }
      });
    });
  }

  getTrafficFallback() {
    return new Promise((resolve) => {
      // Пробуем получить статистику через netsh
      exec(`netsh interface ipv4 show subinterfaces`, { timeout: 5000 }, (error, stdout) => {
        if (error || !stdout) {
          resolve(this.trafficData);
          return;
        }
        // Ищем строку с нашим интерфейсом
        for (const line of stdout.split('\n')) {
          if (line.includes(this.activeInterface)) {
            const parts = line.trim().split(/\s+/);
            // Формат: MTU  InBytes  OutBytes  Interface
            if (parts.length >= 4) {
              this.trafficData.received = parseInt(parts[1]) || 0;
              this.trafficData.sent = parseInt(parts[2]) || 0;
            }
            break;
          }
        }
        resolve(this.trafficData);
      });
    });
  }

  // ===== Проверка IP =====

  async checkIP() {
    return await this.warpClient.checkIP();
  }

  // ===== Тест скорости =====

  async speedTest() {
    return await this.warpClient.speedTest();
  }

  // ===== Генерация ключей =====

  async generateKeys() {
    return new Promise((resolve, reject) => {
      const wgExe = this.findWgExe();
      exec(`"${wgExe}" genkey`, { timeout: 5000 }, (error, privateKey) => {
        if (error) {
          // Фолбэк: Node.js crypto
          try {
            resolve(this.generateKeysLocal());
          } catch (e) {
            reject(new Error('Не удалось сгенерировать ключи'));
          }
          return;
        }

        const privKey = privateKey.trim();
        // pipe через echo в Windows
        const cmd = os.platform() === 'win32'
          ? `echo ${privKey} | "${wgExe}" pubkey`
          : `echo '${privKey}' | "${wgExe}" pubkey`;

        exec(cmd, { timeout: 5000 }, (error2, publicKey) => {
          if (error2) {
            try { resolve(this.generateKeysLocal()); } catch { reject(error2); }
            return;
          }
          resolve({ privateKey: privKey, publicKey: publicKey.trim() });
        });
      });
    });
  }

  generateKeysLocal() {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('x25519');
    const privDer = privateKey.export({ type: 'pkcs8', format: 'der' });
    const pubDer = publicKey.export({ type: 'spki', format: 'der' });
    return {
      privateKey: privDer.subarray(privDer.length - 32).toString('base64'),
      publicKey: pubDer.subarray(pubDer.length - 32).toString('base64')
    };
  }

  // ===== Настройки =====

  getSettings() {
    try {
      if (fs.existsSync(this.settingsFile)) {
        return JSON.parse(fs.readFileSync(this.settingsFile, 'utf-8'));
      }
    } catch {}
    return { autoconnect: false, startup: false, killswitch: false, dns: '1.1.1.1, 1.0.0.1' };
  }

  saveSettings(settings) {
    fs.writeFileSync(this.settingsFile, JSON.stringify(settings, null, 2), { encoding: 'utf-8' });
  }

  // ===== Утилиты =====

  buildWireGuardConfig(config) {
    let result = '[Interface]\n';
    if (config.Interface) {
      for (const [key, value] of Object.entries(config.Interface)) {
        result += `${key} = ${value}\n`;
      }
    }
    result += '\n[Peer]\n';
    if (config.Peer) {
      for (const [key, value] of Object.entries(config.Peer)) {
        result += `${key} = ${value}\n`;
      }
    }
    return result;
  }
}

module.exports = VPNManager;

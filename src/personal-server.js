const { exec, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const https = require('https');

/**
 * KairozunVPN — Персональный VPN-сервер (Beta)
 * 
 * Превращает ваш ПК в WireGuard VPN-сервер для друзей.
 * Весь их трафик проходит через ваш интернет.
 * 
 * Требования:
 * - Проброс порта 51820/UDP на роутере
 * - WireGuard установлен
 * - Запуск от администратора
 */
class PersonalServer {
  constructor() {
    this.configDir = path.join(os.homedir(), '.kairozun-vpn', 'server');
    this.serverDataFile = path.join(this.configDir, 'server-data.json');
    this.clientsFile = path.join(this.configDir, 'clients.json');
    this.serverInterface = 'kairozun-server';
    this.serverPort = 51820;
    this.subnet = '10.13.13';
    this.running = false;
    this.serverData = null;

    this.ensureDir();
    this.loadServerData();
  }

  ensureDir() {
    if (!fs.existsSync(this.configDir)) {
      fs.mkdirSync(this.configDir, { recursive: true });
    }
  }

  loadServerData() {
    try {
      if (fs.existsSync(this.serverDataFile)) {
        this.serverData = JSON.parse(fs.readFileSync(this.serverDataFile, 'utf-8'));
      }
    } catch {
      this.serverData = null;
    }
  }

  saveServerData(data) {
    this.serverData = data;
    fs.writeFileSync(this.serverDataFile, JSON.stringify(data, null, 2), { encoding: 'utf-8' });
  }

  getClients() {
    try {
      if (fs.existsSync(this.clientsFile)) {
        return JSON.parse(fs.readFileSync(this.clientsFile, 'utf-8'));
      }
    } catch {}
    return [];
  }

  saveClients(clients) {
    fs.writeFileSync(this.clientsFile, JSON.stringify(clients, null, 2), { encoding: 'utf-8' });
  }

  /**
   * Инициализирует сервер: генерирует ключи, определяет публичный IP
   */
  async initServer() {
    const keys = this.generateKeysLocal();
    const publicIP = await this.getPublicIP();

    const data = {
      privateKey: keys.privateKey,
      publicKey: keys.publicKey,
      publicIP: publicIP,
      port: this.serverPort,
      subnet: this.subnet,
      createdAt: new Date().toISOString()
    };

    this.saveServerData(data);
    this.saveClients([]);

    return data;
  }

  /**
   * Запускает VPN-сервер
   */
  async startServer() {
    if (!this.serverData) {
      await this.initServer();
    }

    // Обновляем публичный IP при каждом запуске
    try {
      this.serverData.publicIP = await this.getPublicIP();
      this.saveServerData(this.serverData);
    } catch {}

    // Генерируем конфиг с текущими клиентами
    const config = this.buildServerConfig();
    const confPath = path.join(this.configDir, `${this.serverInterface}.conf`);
    fs.writeFileSync(confPath, config, { encoding: 'utf-8' });

    if (os.platform() !== 'win32') {
      throw new Error('Серверный режим поддерживается только на Windows');
    }

    return await this.startServerWindows(confPath);
  }

  startServerWindows(confPath) {
    return new Promise((resolve, reject) => {
      const wgExe = this.findWireGuardExe();
      if (!wgExe) {
        reject(new Error('WireGuard не установлен'));
        return;
      }

      const serviceName = `WireGuardTunnel$${this.serverInterface}`;

      // PS-скрипт для запуска сервера с правами админа + включение IP forwarding + NAT
      const psScript = `
        $ErrorActionPreference = 'Continue'
        $wg = '${wgExe}'
        $iface = '${this.serverInterface}'
        $conf = '${confPath.replace(/\\/g, '\\\\').replace(/'/g, "''")}'
        
        # Удаляем старый туннель если есть
        try { & $wg /uninstalltunnelservice $iface 2>$null } catch {}
        Start-Sleep -Seconds 1
        
        # Устанавливаем туннель
        & $wg /installtunnelservice $conf
        Start-Sleep -Seconds 3
        
        # Включаем IP forwarding
        Set-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters' -Name 'IPEnableRouter' -Value 1 -Type DWord -Force
        
        # Включаем forwarding на всех интерфейсах
        Get-NetAdapter | Where-Object { $_.Status -eq 'Up' } | ForEach-Object {
          Set-NetIPInterface -InterfaceIndex $_.ifIndex -Forwarding Enabled -ErrorAction SilentlyContinue
        }
        
        # Пробуем настроить NAT
        try {
          Remove-NetNat -Name 'KairozunNAT' -Confirm:$false -ErrorAction SilentlyContinue
        } catch {}
        try {
          New-NetNat -Name 'KairozunNAT' -InternalIPInterfaceAddressPrefix '${this.subnet}.0/24' -ErrorAction Stop
        } catch {
          # Если New-NetNat не работает, используем ICS или routing
          # На многих Windows это работает автоматически через IP forwarding
        }
        
        # Проверяем сервис
        $svc = Get-Service -Name "WireGuardTunnel$$$iface" -ErrorAction SilentlyContinue
        if ($svc -and $svc.Status -eq 'Running') {
          Write-Output 'SERVER_OK'
        } else {
          Write-Output 'SERVER_FAIL'
        }
      `.trim();

      const scriptPath = path.join(this.configDir, 'start-server.ps1');
      fs.writeFileSync(scriptPath, psScript, { encoding: 'utf-8' });

      const psCmd = `Start-Process -FilePath 'powershell.exe' -ArgumentList '-ExecutionPolicy','Bypass','-File','${scriptPath.replace(/'/g, "''")}' -Verb RunAs -Wait -WindowStyle Hidden`;

      exec(`powershell -Command "${psCmd}"`, { timeout: 30000 }, (error) => {
        try { fs.unlinkSync(scriptPath); } catch {}

        if (error) {
          reject(new Error('Подтвердите запрос администратора (UAC) для запуска сервера'));
          return;
        }

        // Проверяем
        exec(`sc query "WireGuardTunnel$${this.serverInterface}"`, { timeout: 5000 }, (err, stdout) => {
          if (!err && stdout && stdout.includes('RUNNING')) {
            this.running = true;
            resolve({ running: true, publicIP: this.serverData.publicIP, port: this.serverPort });
          } else {
            reject(new Error('Сервер не запустился'));
          }
        });
      });
    });
  }

  /**
   * Останавливает VPN-сервер
   */
  async stopServer() {
    return new Promise((resolve) => {
      const wgExe = this.findWireGuardExe();
      if (!wgExe) {
        this.running = false;
        resolve();
        return;
      }

      const psScript = `
        $wg = '${wgExe}'
        & $wg /uninstalltunnelservice '${this.serverInterface}'
        
        # Удаляем NAT
        try { Remove-NetNat -Name 'KairozunNAT' -Confirm:$false -ErrorAction SilentlyContinue } catch {}
      `.trim();

      const scriptPath = path.join(this.configDir, 'stop-server.ps1');
      fs.writeFileSync(scriptPath, psScript, { encoding: 'utf-8' });

      const psCmd = `Start-Process -FilePath 'powershell.exe' -ArgumentList '-ExecutionPolicy','Bypass','-File','${scriptPath.replace(/'/g, "''")}' -Verb RunAs -Wait -WindowStyle Hidden`;

      exec(`powershell -Command "${psCmd}"`, { timeout: 15000 }, () => {
        try { fs.unlinkSync(scriptPath); } catch {}
        this.running = false;
        resolve();
      });
    });
  }

  /**
   * Добавляет нового клиента (друга)
   */
  async addClient(clientName) {
    if (!this.serverData) {
      throw new Error('Сервер не инициализирован');
    }

    const clients = this.getClients();
    const clientIndex = clients.length + 2; // +2 т.к. .1 = сервер
    const clientIP = `${this.subnet}.${clientIndex}`;

    if (clientIndex > 254) {
      throw new Error('Максимальное количество клиентов (253) достигнуто');
    }

    const keys = this.generateKeysLocal();

    const client = {
      id: 'client-' + crypto.randomBytes(4).toString('hex'),
      name: clientName || `Друг #${clients.length + 1}`,
      privateKey: keys.privateKey,
      publicKey: keys.publicKey,
      ip: clientIP,
      createdAt: new Date().toISOString(),
      inviteCode: null
    };

    // Генерируем конфиг для клиента
    const clientConfig = this.buildClientConfig(client);

    // Генерируем invite-код
    const inviteCode = this.generateInviteCode(client, clientConfig);
    client.inviteCode = inviteCode;

    clients.push(client);
    this.saveClients(clients);

    // Если сервер запущен, перезапускаем для применения нового пира
    if (this.running) {
      try {
        await this.restartServer();
      } catch {}
    }

    return {
      client,
      config: clientConfig,
      inviteCode
    };
  }

  /**
   * Удаляет клиента
   */
  async removeClient(clientId) {
    const clients = this.getClients();
    const filtered = clients.filter(c => c.id !== clientId);
    this.saveClients(filtered);

    if (this.running) {
      try {
        await this.restartServer();
      } catch {}
    }
  }

  /**
   * Перезапускает сервер с обновлённым конфигом
   */
  async restartServer() {
    await this.stopServer();
    await new Promise(r => setTimeout(r, 1000));
    await this.startServer();
  }

  /**
   * Проверяет статус сервера
   */
  getServerStatus() {
    return new Promise((resolve) => {
      const serviceName = `WireGuardTunnel$${this.serverInterface}`;
      exec(`sc query "${serviceName}"`, { timeout: 5000 }, (error, stdout) => {
        if (!error && stdout && stdout.includes('RUNNING')) {
          this.running = true;
          resolve({
            running: true,
            publicIP: this.serverData ? this.serverData.publicIP : null,
            port: this.serverPort,
            clients: this.getClients().length
          });
        } else {
          this.running = false;
          resolve({ running: false, clients: this.getClients().length });
        }
      });
    });
  }

  /**
   * Возвращает инфо о сервере
   */
  getServerInfo() {
    return {
      initialized: this.serverData !== null,
      publicIP: this.serverData ? this.serverData.publicIP : null,
      publicKey: this.serverData ? this.serverData.publicKey : null,
      port: this.serverPort,
      subnet: this.subnet + '.0/24',
      clients: this.getClients()
    };
  }

  // === Конфигурации ===

  buildServerConfig() {
    const clients = this.getClients();

    let config = `[Interface]
PrivateKey = ${this.serverData.privateKey}
Address = ${this.subnet}.1/24
ListenPort = ${this.serverPort}
DNS = 1.1.1.1, 1.0.0.1
`;

    for (const client of clients) {
      config += `
[Peer]
# ${client.name}
PublicKey = ${client.publicKey}
AllowedIPs = ${client.ip}/32
`;
    }

    return config;
  }

  buildClientConfig(client) {
    return `[Interface]
PrivateKey = ${client.privateKey}
Address = ${client.ip}/32
DNS = 1.1.1.1, 1.0.0.1
MTU = 1280

[Peer]
PublicKey = ${this.serverData.publicKey}
AllowedIPs = 0.0.0.0/0
Endpoint = ${this.serverData.publicIP}:${this.serverPort}
PersistentKeepalive = 25
`;
  }

  /**
   * Генерирует invite-код (base64 JSON с данными для подключения)
   */
  generateInviteCode(client, configRaw) {
    const data = {
      v: 1,
      type: 'kairozun-invite',
      name: client.name,
      config: configRaw,
      server: {
        publicKey: this.serverData.publicKey,
        ip: this.serverData.publicIP,
        port: this.serverPort
      },
      client: {
        privateKey: client.privateKey,
        publicKey: client.publicKey,
        ip: client.ip
      }
    };
    return Buffer.from(JSON.stringify(data)).toString('base64');
  }

  /**
   * Парсит invite-код и создаёт конфиг
   */
  static parseInviteCode(code) {
    try {
      const json = JSON.parse(Buffer.from(code, 'base64').toString('utf-8'));
      if (json.type !== 'kairozun-invite' || !json.config) {
        throw new Error('Неверный формат кода');
      }
      return json;
    } catch (e) {
      throw new Error('Невалидный код приглашения: ' + e.message);
    }
  }

  // === Утилиты ===

  async getPublicIP() {
    return new Promise((resolve, reject) => {
      const req = https.get({
        hostname: 'api.ipify.org',
        path: '/?format=json',
        timeout: 8000,
        headers: { 'User-Agent': 'KairozunVPN/1.0' }
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            resolve(json.ip);
          } catch {
            reject(new Error('Не удалось определить IP'));
          }
        });
      });
      req.on('error', (e) => reject(e));
      req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
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
}

module.exports = PersonalServer;

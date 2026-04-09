const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');

/**
 * KairozunVPN — Персональный VPN-сервер (Beta)
 *
 * Tailscale Exit Node — один клик, полная автоматизация.
 * API ключ хранится в конфиге — пользователь не трогает ничего вручную.
 */
class PersonalServer {
  constructor() {
    this.configDir = path.join(os.homedir(), '.kairozun-vpn', 'server');
    this.serverDataFile = path.join(this.configDir, 'server-data.json');
    this.running = false;
    this.serverData = null;
    this.tailscaleExe = null;

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
        const fromDisk = JSON.parse(fs.readFileSync(this.serverDataFile, 'utf-8'));
        // Мержим: данные с диска имеют приоритет, но не теряем то что в памяти
        if (this.serverData) {
          this.serverData = { ...this.serverData, ...fromDisk };
        } else {
          this.serverData = fromDisk;
        }
        console.log('[Server] Конфиг загружен:', Object.keys(this.serverData).join(', '));
      }
    } catch {
      if (!this.serverData) this.serverData = null;
    }
  }

  saveServerData(data) {
    // Мержим с существующими данными, чтобы не потерять ключи
    if (this.serverData && data !== this.serverData) {
      this.serverData = { ...this.serverData, ...data };
    } else {
      this.serverData = data;
    }
    fs.writeFileSync(this.serverDataFile, JSON.stringify(this.serverData, null, 2), { encoding: 'utf-8' });
  }

  // Обновить отдельные поля, не затирая остальные
  updateServerData(fields) {
    // Всегда перезагружаем с диска перед записью, чтобы не потерять ключи
    this.loadServerData();
    if (!this.serverData) this.serverData = {};
    Object.assign(this.serverData, fields);
    fs.writeFileSync(this.serverDataFile, JSON.stringify(this.serverData, null, 2), { encoding: 'utf-8' });
  }

  // === Tailscale: поиск ===

  findTailscale() {
    if (this.tailscaleExe && fs.existsSync(this.tailscaleExe)) {
      return this.tailscaleExe;
    }
    const paths = [
      'C:\\Program Files\\Tailscale\\tailscale.exe',
      'C:\\Program Files (x86)\\Tailscale\\tailscale.exe',
      path.join(os.homedir(), 'AppData', 'Local', 'Tailscale', 'tailscale.exe'),
      path.join(process.env.ProgramFiles || '', 'Tailscale', 'tailscale.exe'),
      path.join(process.env.ProgramW6432 || '', 'Tailscale', 'tailscale.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'Tailscale', 'tailscale.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Tailscale', 'tailscale.exe')
    ];
    for (const p of paths) {
      if (p && fs.existsSync(p)) {
        this.tailscaleExe = p;
        return p;
      }
    }
    return null;
  }

  // Поиск через where.exe (fallback для нестандартных путей)
  findTailscaleViaWhere() {
    return new Promise((resolve) => {
      exec('where tailscale.exe 2>nul', { timeout: 5000 }, (error, stdout) => {
        if (!error && stdout && stdout.trim()) {
          const found = stdout.trim().split('\n')[0].trim();
          if (fs.existsSync(found)) {
            this.tailscaleExe = found;
            console.log('[Tailscale] Найден через where:', found);
            resolve(found);
            return;
          }
        }
        resolve(null);
      });
    });
  }

  isTailscaleInstalled() {
    return this.findTailscale() !== null;
  }

  // === Установка ===

  async installTailscale() {
    console.log('[Install] Начинаю установку Tailscale...');

    // Способ 1: winget (работает через Microsoft CDN, обход блокировок)
    try {
      console.log('[Install] Пробую winget...');
      await this.installViaWinget();
      await this.waitForTailscale(20);
      if (this.findTailscale() || await this.findTailscaleViaWhere()) {
        console.log('[Install] Установлен через winget');
        return { installed: true };
      }
    } catch (e) {
      console.log('[Install] winget не сработал:', e.message);
    }

    // Способ 2: MSI с нескольких зеркал
    try {
      console.log('[Install] Пробую MSI...');
      await this.installViaMSI();
      await this.waitForTailscale(20);
      if (this.findTailscale() || await this.findTailscaleViaWhere()) {
        console.log('[Install] Установлен через MSI');
        return { installed: true };
      }
    } catch (e) {
      console.log('[Install] MSI не сработал:', e.message);
    }

    // Способ 3: chocolatey
    try {
      console.log('[Install] Пробую chocolatey...');
      await this.installViaChoco();
      await this.waitForTailscale(15);
      if (this.findTailscale() || await this.findTailscaleViaWhere()) {
        console.log('[Install] Установлен через chocolatey');
        return { installed: true };
      }
    } catch (e) {
      console.log('[Install] choco не сработал:', e.message);
    }

    throw new Error('Не удалось установить Tailscale. Установите вручную: https://tailscale.com/download');
  }

  installViaWinget() {
    return new Promise((resolve, reject) => {
      const psCmd = `Start-Process -FilePath 'powershell.exe' -ArgumentList '-Command','winget install Tailscale.Tailscale --silent --accept-package-agreements --accept-source-agreements' -Verb RunAs -Wait -WindowStyle Hidden`;
      exec(`powershell -Command "${psCmd}"`, { timeout: 180000 }, (error) => {
        if (error) { reject(error); return; }
        resolve();
      });
    });
  }

  installViaMSI() {
    return new Promise((resolve, reject) => {
      const msiPath = path.join(os.tmpdir(), 'tailscale-setup.msi');
      const urls = [
        'https://pkgs.tailscale.com/stable/tailscale-setup-latest-amd64.msi',
        'https://pkgs.tailscale.com/unstable/tailscale-setup-latest-amd64.msi'
      ];
      const psScript = `
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        $$urls = @(${urls.map(u => `'${u}'`).join(',')})
        $$ok = $$false
        foreach ($$u in $$urls) {
          try {
            Invoke-WebRequest -Uri $$u -OutFile '${msiPath.replace(/'/g, "''")}' -UseBasicParsing -TimeoutSec 60
            if (Test-Path '${msiPath.replace(/'/g, "''")}') { $$ok = $$true; break }
          } catch {}
        }
        if (-not $$ok) { throw 'Download failed' }
        Start-Process -FilePath 'msiexec.exe' -ArgumentList '/i','${msiPath.replace(/'/g, "''")}','/quiet','/norestart' -Wait
        Remove-Item '${msiPath.replace(/'/g, "''")}' -Force -ErrorAction SilentlyContinue
      `.trim();

      const scriptPath = path.join(this.configDir, 'install-ts.ps1');
      fs.writeFileSync(scriptPath, psScript, { encoding: 'utf-8' });

      const psCmd = `Start-Process -FilePath 'powershell.exe' -ArgumentList '-ExecutionPolicy','Bypass','-File','${scriptPath.replace(/'/g, "''")}' -Verb RunAs -Wait -WindowStyle Hidden`;

      exec(`powershell -Command "${psCmd}"`, { timeout: 300000 }, (error) => {
        try { fs.unlinkSync(scriptPath); } catch {}
        if (error) {
          reject(new Error('Ошибка скачивания/установки MSI: ' + error.message));
          return;
        }
        resolve();
      });
    });
  }

  installViaChoco() {
    return new Promise((resolve, reject) => {
      const psCmd = `Start-Process -FilePath 'powershell.exe' -ArgumentList '-Command','choco install tailscale -y --force' -Verb RunAs -Wait -WindowStyle Hidden`;
      exec(`powershell -Command "${psCmd}"`, { timeout: 180000 }, (error) => {
        if (error) { reject(error); return; }
        resolve();
      });
    });
  }

  waitForTailscale(maxAttempts = 15) {
    return new Promise((resolve) => {
      let attempts = 0;
      const check = () => {
        attempts++;
        this.tailscaleExe = null; // сброс кэша
        if (this.findTailscale()) {
          console.log(`[Install] tailscale.exe найден после ${attempts} попыток`);
          resolve(true);
          return;
        }
        if (attempts >= maxAttempts) {
          console.log(`[Install] tailscale.exe не найден после ${attempts} попыток`);
          resolve(false);
          return;
        }
        setTimeout(check, 2000);
      };
      setTimeout(check, 3000); // первая проверка через 3с
    });
  }

  // === Главная кнопка: Настроить сервер ===

  async setupServer() {
    console.log('[Server] setupServer() начало');

    // Шаг 1: Установить Tailscale
    if (!this.isTailscaleInstalled()) {
      console.log('[Server] Tailscale не найден, устанавливаю...');
      await this.installTailscale();
    }

    // Быстрая проверка: может уже всё работает?
    console.log('[Server] Проверяю статус...');
    let status = await this.getTailscaleStatus();

    if (status && status.BackendState === 'Running') {
      const ip = (status.Self?.TailscaleIPs || [])[0] || null;
      const hostname = status.Self?.HostName || null;
      const isExitNode = status.Self?.ExitNodeOption === true;

      console.log(`[Server] Уже Running! IP=${ip}, exitNode=${isExitNode}, hasAuthKey=${!!this.serverData?.authKey}, hasApiToken=${!!this.serverData?.apiToken}`);

      // Обновить IP/hostname не затирая ключи
      this.updateServerData({ tailscaleIP: ip, hostname: hostname });

      // Если уже полностью настроен — сразу готово
      if (isExitNode && this.serverData.authKey) {
        console.log('[Server] Всё уже настроено, возвращаю ready');
        return { step: 'ready', running: true, tailscaleIP: ip };
      }

      // Есть API ключ — автонастройка (только то, чего не хватает)
      if (this.serverData.apiToken) {
        console.log('[Server] Запускаю автонастройку через API...');
        // Сначала включим exit node через tailscale set (быстрее чем up)
        if (!isExitNode) {
          try {
            await this.runTailscaleCmd('set --advertise-exit-node');
            console.log('[Server] set --advertise-exit-node OK');
          } catch (e) {
            console.log('[Server] set --advertise-exit-node ошибка:', e.message);
          }
        }
        return await this.autoConfigureWithApi(ip);
      }

      // Включить exit node без API
      if (!isExitNode) {
        try {
          await this.runTailscaleCmd('set --advertise-exit-node');
        } catch {}
      }

      return { step: 'ready', running: true, tailscaleIP: ip };
    }

    // Tailscale не Running — запускаем
    console.log('[Server] Tailscale не Running, запускаю up...');
    try {
      await this.runTailscaleCmd('up --advertise-exit-node --accept-dns=false');
    } catch (e) {
      console.log('[Server] tailscale up ошибка:', e.message);
    }

    await new Promise(r => setTimeout(r, 2000));
    status = await this.getTailscaleStatus();
    console.log(`[Server] Статус после up: ${status?.BackendState}`);

    if (!status || status.BackendState === 'NeedsLogin') {
      return { step: 'login' };
    }

    if (status.BackendState === 'Running') {
      const ip = (status.Self?.TailscaleIPs || [])[0] || null;
      const hostname = status.Self?.HostName || null;

      this.updateServerData({ tailscaleIP: ip, hostname: hostname });

      if (this.serverData.apiToken) {
        return await this.autoConfigureWithApi(ip);
      }

      return { step: 'ready', running: true, tailscaleIP: ip };
    }

    return { step: 'error', message: `Статус: ${status?.BackendState || 'unknown'}` };
  }

  // === Полная автонастройка через API ===

  async autoConfigureWithApi(ip) {
    try {
      // 1. Одобрить exit node
      console.log('[Server] API: одобряю exit node...');
      await this.approveExitNodeViaApi();
      console.log('[Server] API: exit node одобрен');
    } catch (e) {
      console.log('[Server] Exit node approve:', e.message);
    }

    try {
      // 2. Сгенерировать auth key для друзей (если ещё нет)
      if (!this.serverData.authKey) {
        console.log('[Server] API: генерирую auth key...');
        const authKey = await this.generateAuthKeyViaApi();
        this.updateServerData({ authKey: authKey });
        console.log('[Server] API: auth key сохранён');
      } else {
        console.log('[Server] Auth key уже есть, пропускаю');
      }
    } catch (e) {
      console.log('[Server] Auth key generation:', e.message);
    }

    console.log('[Server] autoConfigureWithApi завершена → ready');
    return { step: 'ready', running: true, tailscaleIP: ip };
  }

  // === Tailscale API ===

  tailscaleApi(method, endpoint, body) {
    return new Promise((resolve, reject) => {
      const token = this.serverData?.apiToken;
      if (!token) {
        reject(new Error('API ключ не установлен'));
        return;
      }

      const postData = body ? JSON.stringify(body) : null;
      const options = {
        hostname: 'api.tailscale.com',
        path: `/api/v2${endpoint}`,
        method: method,
        timeout: 15000,
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'User-Agent': 'KairozunVPN/1.0'
        }
      };
      if (postData) {
        options.headers['Content-Length'] = Buffer.byteLength(postData);
      }

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          if (res.statusCode >= 400) {
            reject(new Error(`Tailscale API ${res.statusCode}: ${data.substring(0, 300)}`));
            return;
          }
          try {
            resolve(data ? JSON.parse(data) : {});
          } catch {
            resolve(data);
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
      if (postData) req.write(postData);
      req.end();
    });
  }

  async approveExitNodeViaApi() {
    const result = await this.tailscaleApi('GET', '/tailnet/-/devices');
    const devices = result.devices || [];

    const status = await this.getTailscaleStatus();
    const myHostname = (status?.Self?.HostName || '').toLowerCase();
    if (!myHostname) throw new Error('Hostname не определён');

    const myDevice = devices.find(d =>
      (d.hostname || '').toLowerCase() === myHostname ||
      (d.name || '').toLowerCase().startsWith(myHostname + '.')
    );

    if (!myDevice) throw new Error('Устройство не найдено в Tailscale');

    await this.tailscaleApi('POST', `/device/${myDevice.id}/routes`, {
      routes: ['0.0.0.0/0', '::/0']
    });

    return { approved: true };
  }

  async generateAuthKeyViaApi() {
    const result = await this.tailscaleApi('POST', '/tailnet/-/keys', {
      capabilities: {
        devices: {
          create: {
            reusable: true,
            ephemeral: false,
            preauthorized: true,
            tags: []
          }
        }
      },
      expirySeconds: 7776000 // 90 дней
    });

    if (!result.key) throw new Error('Не удалось создать auth key');
    return result.key;
  }

  // === Сохранить auth key вручную (запасной вариант) ===

  setAuthKey(key) {
    if (!key || !key.startsWith('tskey-auth-')) {
      throw new Error('Ключ должен начинаться с tskey-auth-...');
    }

    if (!/^tskey-auth-[a-zA-Z0-9_-]+$/.test(key)) {
      throw new Error('Невалидный формат ключа');
    }

    if (!this.serverData) this.serverData = {};
    this.serverData.authKey = key;
    this.saveServerData(this.serverData);

    return { success: true };
  }

  // === Управление сервером ===

  async startServer() {
    const exe = this.findTailscale();
    if (!exe) throw new Error('Tailscale не установлен');

    await this.runTailscaleCmd('set --advertise-exit-node');
    console.log('[Server] Exit node запущен');
    await new Promise(r => setTimeout(r, 1000));

    const status = await this.getTailscaleStatus();
    if (status?.BackendState === 'Running') {
      this.running = true;
      const ip = (status.Self?.TailscaleIPs || [])[0];
      return { running: true, tailscaleIP: ip };
    }

    if (status?.BackendState === 'NeedsLogin') {
      return { running: false, needsLogin: true };
    }

    throw new Error('Не удалось запустить');
  }

  async stopServer() {
    const exe = this.findTailscale();
    if (!exe) { this.running = false; return; }
    try {
      await this.runTailscaleCmd('set --advertise-exit-node=false');
      console.log('[Server] Exit node остановлен');
    } catch (e) {
      console.log('[Server] Ошибка остановки:', e.message);
    }
    this.running = false;
  }

  // === Статус ===

  async getServerStatus() {
    const installed = this.isTailscaleInstalled();
    if (!installed) {
      return { running: false, tailscaleInstalled: false, configured: false, peers: 0, peerList: [] };
    }

    const status = await this.getTailscaleStatus();
    if (!status) {
      return {
        running: false, tailscaleInstalled: true, loggedIn: false,
        configured: false, peers: 0, peerList: []
      };
    }

    const isRunning = status.BackendState === 'Running';
    const self = status.Self || {};
    const isExitNode = self.ExitNodeOption === true;

    let peers = 0;
    const peerList = [];
    if (status.Peer) {
      for (const [, p] of Object.entries(status.Peer)) {
        if (p.Online) {
          peers++;
          peerList.push({
            name: p.HostName || p.DNSName || 'Неизвестный',
            ip: (p.TailscaleIPs || [])[0] || '—',
            os: p.OS || '—',
            online: true,
            exitNodePeer: p.ExitNode === true
          });
        }
      }
    }

    this.running = isRunning && isExitNode;

    return {
      running: this.running,
      tailscaleInstalled: true,
      loggedIn: isRunning,
      backendState: status.BackendState,
      tailscaleIP: (self.TailscaleIPs || [])[0] || null,
      hostname: self.HostName || null,
      isExitNode: isExitNode,
      peers: peers,
      peerList: peerList,
      configured: !!(this.serverData?.authKey && isExitNode),
      hasAuthKey: !!(this.serverData?.authKey)
    };
  }

  getServerInfo() {
    return {
      initialized: this.serverData !== null,
      tailscaleInstalled: this.isTailscaleInstalled(),
      tailscaleIP: this.serverData?.tailscaleIP || null,
      hostname: this.serverData?.hostname || null,
      configured: !!(this.serverData?.authKey)
    };
  }

  // === Invite-коды ===

  generateInviteCode(friendName) {
    // Перезагружаем данные с диска на случай обновления
    this.loadServerData();
    if (!this.serverData?.authKey) {
      throw new Error('Сервер не настроен. Нажмите «Настроить».');
    }

    const data = {
      v: 2,
      type: 'kairozun-invite',
      name: friendName || 'Друг',
      ts: {
        authKey: this.serverData.authKey,
        exitNode: this.serverData.tailscaleIP,
        hostname: this.serverData.hostname
      }
    };

    return Buffer.from(JSON.stringify(data)).toString('base64');
  }

  static parseInviteCode(code) {
    try {
      const json = JSON.parse(Buffer.from(code, 'base64').toString('utf-8'));
      if (json.type !== 'kairozun-invite') throw new Error('Неверный формат');
      return json;
    } catch (e) {
      throw new Error('Невалидный код: ' + e.message);
    }
  }

  // === Для друга: подключение через invite-код ===

  async connectAsFriend(inviteData) {
    if (!this.isTailscaleInstalled()) {
      console.log('[Friend] Tailscale не установлен, устанавливаю...');
      await this.installTailscale();
    }

    // Проверяем что Tailscale реально найден (включая where.exe fallback)
    if (!this.isTailscaleInstalled()) {
      await this.findTailscaleViaWhere();
    }
    if (!this.isTailscaleInstalled()) {
      throw new Error('Не удалось установить Tailscale. Установите вручную: https://tailscale.com/download');
    }

    console.log('[Friend] Tailscale найден:', this.tailscaleExe);

    if (!inviteData.ts || !inviteData.ts.authKey) {
      throw new Error('Код не содержит ключ авторизации');
    }

    const authKey = inviteData.ts.authKey;
    const exitNode = inviteData.ts.exitNode;

    // Валидация от инъекций
    if (!/^tskey-auth-[a-zA-Z0-9_-]+$/.test(authKey)) {
      throw new Error('Невалидный auth key');
    }
    if (exitNode && !/^[\d.]+$/.test(exitNode)) {
      throw new Error('Невалидный exit node');
    }

    // Проверяем текущий статус Tailscale
    let status = await this.getTailscaleStatus();
    console.log('[Friend] Статус Tailscale:', status?.BackendState || 'null');

    // Если NoState или Stopped — запускаем сервис
    if (!status || status.BackendState === 'NoState' || status.BackendState === 'Stopped') {
      console.log('[Friend] Запускаю сервис Tailscale...');
      try {
        await new Promise((resolve, reject) => {
          exec('powershell -Command "Start-Service Tailscale -ErrorAction SilentlyContinue; net start Tailscale 2>$null"',
            { timeout: 15000 }, (err) => { resolve(); });
        });
        await new Promise(r => setTimeout(r, 5000));
        status = await this.getTailscaleStatus();
        console.log('[Friend] Статус после запуска сервиса:', status?.BackendState || 'null');
      } catch {}
    }

    const isRunning = status && status.BackendState === 'Running';

    if (!isRunning) {
      // Авторизуемся с ключом
      console.log('[Friend] Авторизуюсь с auth key...');
      try {
        await this.runTailscaleCmd(`up --auth-key=${authKey} --accept-routes --reset`);
      } catch (e) {
        console.log('[Friend] up --reset failed:', e.message);
        try {
          await this.runTailscaleCmd(`up --auth-key=${authKey} --accept-routes`);
        } catch (e2) {
          console.log('[Friend] up failed:', e2.message);
          throw new Error('Не удалось авторизоваться в Tailscale: ' + e2.message);
        }
      }
      await new Promise(r => setTimeout(r, 5000));

      // Проверяем что подключились
      status = await this.getTailscaleStatus();
      if (!status || status.BackendState !== 'Running') {
        throw new Error('Tailscale не подключился. Статус: ' + (status?.BackendState || 'NoState'));
      }
    }

    if (exitNode) {
      console.log('[Friend] Устанавливаю exit node:', exitNode);
      await this.runTailscaleCmd(`set --exit-node=${exitNode}`);
      try {
        await this.runTailscaleCmd(`set --accept-routes`);
      } catch {}
    }

    console.log('[Friend] Подключено!');
    return { connected: true, exitNode };
  }

  async disconnectFriend() {
    try { await this.runTailscaleCmd('set --exit-node='); } catch {}
  }

  openAdminConsole(page) {
    const urls = {
      machines: 'https://login.tailscale.com/admin/machines',
      keys: 'https://login.tailscale.com/admin/settings/keys',
      default: 'https://login.tailscale.com/admin/machines'
    };
    exec(`start "" "${urls[page] || urls.default}"`);
  }

  // === Утилиты ===

  getTailscaleStatus() {
    const exe = this.findTailscale();
    if (!exe) return Promise.resolve(null);

    return new Promise((resolve) => {
      exec(`"${exe}" status --json`, { timeout: 10000 }, (error, stdout) => {
        if (error || !stdout) { resolve(null); return; }
        try { resolve(JSON.parse(stdout)); } catch { resolve(null); }
      });
    });
  }

  runTailscaleCmd(args) {
    const exe = this.findTailscale();
    if (!exe) throw new Error('Tailscale не найден');

    return new Promise((resolve, reject) => {
      exec(`"${exe}" ${args}`, { timeout: 30000 }, (error, stdout, stderr) => {
        if (error) {
          const msg = stderr || error.message || '';
          if (msg.includes('already') || msg.includes('Success') || msg.includes('NeedsLogin')) {
            resolve(stdout || msg);
            return;
          }
          reject(new Error(msg));
          return;
        }
        resolve(stdout || '');
      });
    });
  }
}

module.exports = PersonalServer;

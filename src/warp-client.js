const https = require('https');
const crypto = require('crypto');

/**
 * Cloudflare WARP Client
 * Регистрируется в бесплатном Cloudflare WARP и получает WireGuard-конфигурацию.
 * Это полноценный бесплатный VPN — шифрует трафик и меняет IP.
 */
class WarpClient {
  constructor() {
    this.apiBase = 'api.cloudflareclient.com';
    this.apiVersion = 'v0a2158';
  }

  /**
   * Регистрация нового устройства в WARP.
   * Возвращает полную WireGuard-конфигурацию, готовую к подключению.
   */
  async register(privateKey, publicKey) {
    const installId = this.generateInstallId();
    const body = JSON.stringify({
      key: publicKey,
      install_id: installId,
      fcm_token: installId + ':APA91b' + this.generateInstallId(),
      tos: new Date().toISOString(),
      type: 'Android',
      model: 'PC',
      locale: 'ru_RU'
    });

    const response = await this.request('POST', `/${this.apiVersion}/reg`, body);

    if (!response || !response.config) {
      throw new Error('Не удалось зарегистрироваться в Cloudflare WARP');
    }

    return {
      id: response.id,
      token: response.token,
      accountId: response.account ? response.account.id : null,
      config: this.buildConfig(privateKey, response)
    };
  }

  /**
   * Получает информацию об аккаунте WARP
   */
  async getAccountInfo(regId, token) {
    try {
      const response = await this.request('GET', `/${this.apiVersion}/reg/${regId}`, null, token);
      return response;
    } catch {
      return null;
    }
  }

  /**
   * Строит WireGuard-конфигурацию из ответа WARP API
   */
  buildConfig(privateKey, warpResponse) {
    const cfg = warpResponse.config;
    const peer = cfg.peers[0];

    // Адреса интерфейса
    const v4 = cfg.interface.addresses.v4;
    const v6 = cfg.interface.addresses.v6;

    // Endpoint — Cloudflare anycast
    const endpoint = peer.endpoint.host;

    return {
      raw: [
        '[Interface]',
        `PrivateKey = ${privateKey}`,
        `Address = ${v4}/32`,
        'DNS = 1.1.1.1, 1.0.0.1',
        `MTU = 1280`,
        '',
        '[Peer]',
        `PublicKey = ${peer.public_key}`,
        'AllowedIPs = 0.0.0.0/0',
        `Endpoint = ${endpoint}`,
        'PersistentKeepalive = 25',
        ''
      ].join('\n'),
      parsed: {
        Interface: {
          PrivateKey: privateKey,
          Address: `${v4}/32`,
          DNS: '1.1.1.1, 1.0.0.1',
          MTU: '1280'
        },
        Peer: {
          PublicKey: peer.public_key,
          AllowedIPs: '0.0.0.0/0',
          Endpoint: endpoint,
          PersistentKeepalive: '25'
        }
      },
      endpoint: endpoint,
      address: v4,
      addressV6: v6,
      peerPublicKey: peer.public_key,
      regId: warpResponse.id,
      token: warpResponse.token
    };
  }

  /**
   * Получает список доступных endpoint'ов Cloudflare для смены IP
   */
  getEndpoints() {
    // Только проверенные рабочие endpoints Cloudflare WARP
    return [
      { host: 'engage.cloudflareclient.com:2408', label: 'Авто (ближайший)', location: 'AUTO', country: 'Ваш регион', flag: '🌐' },
      { host: '162.159.193.1:2408', label: 'Европа #1', location: 'EU1', country: 'Cloudflare EU', flag: 'EU' },
      { host: '162.159.192.1:2408', label: 'Европа #2', location: 'EU2', country: 'Cloudflare EU', flag: 'EU' },
      { host: '162.159.193.1:500', label: 'Европа #3 (порт 500)', location: 'EU3', country: 'Cloudflare EU', flag: 'EU' },
      { host: '162.159.192.1:500', label: 'Европа #4 (порт 500)', location: 'EU4', country: 'Cloudflare EU', flag: 'EU' },
    ];
  }

  /**
   * HTTP-запрос к Cloudflare WARP API
   */
  request(method, path, body, authToken) {
    return new Promise((resolve, reject) => {
      const headers = {
        'Content-Type': 'application/json',
        'User-Agent': 'okhttp/3.12.1',
        'CF-Client-Version': 'a-6.28-2533'
      };

      if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
      }

      if (body) {
        headers['Content-Length'] = Buffer.byteLength(body);
      }

      const options = {
        hostname: this.apiBase,
        port: 443,
        path: path,
        method: method,
        headers: headers,
        timeout: 15000
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve(parsed);
            } else {
              reject(new Error(`WARP API error ${res.statusCode}: ${JSON.stringify(parsed)}`));
            }
          } catch {
            reject(new Error(`Невалидный ответ от WARP API: ${data.substring(0, 200)}`));
          }
        });
      });

      req.on('error', (err) => {
        reject(new Error(`Ошибка соединения с WARP API: ${err.message}`));
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Таймаут соединения с WARP API'));
      });

      if (body) {
        req.write(body);
      }
      req.end();
    });
  }

  /**
   * Проверяет текущий внешний IP
   */
  async checkIP() {
    const services = [
      { host: 'api.ipify.org', path: '/?format=json', field: 'ip' },
      { host: 'ipinfo.io', path: '/json', field: 'ip' },
      { host: 'ifconfig.me', path: '/all.json', field: 'ip_addr' },
    ];

    for (const svc of services) {
      try {
        const result = await this.httpGet(svc.host, svc.path);
        const json = JSON.parse(result);
        return {
          ip: json[svc.field] || json.ip,
          country: json.country || json.country_code || null,
          city: json.city || null,
          org: json.org || json.asn || null
        };
      } catch {
        continue;
      }
    }
    return { ip: 'Неизвестен', country: null, city: null, org: null };
  }

  /**
   * Простой HTTP GET
   */
  httpGet(host, path) {
    return new Promise((resolve, reject) => {
      const req = https.get({ hostname: host, path: path, timeout: 8000, headers: { 'User-Agent': 'KairozunVPN/1.0' } }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => resolve(data));
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    });
  }

  /**
   * Тест скорости (простой download-тест)
   */
  async speedTest() {
    // Скачиваем 10MB для более точного замера
    return new Promise((resolve) => {
      const startTime = Date.now();
      let totalBytes = 0;

      const req = https.get('https://speed.cloudflare.com/__down?bytes=10000000', { timeout: 20000 }, (res) => {
        res.on('data', (chunk) => {
          totalBytes += chunk.length;
        });
        res.on('end', () => {
          const elapsed = (Date.now() - startTime) / 1000;
          const speedMbps = ((totalBytes * 8) / (elapsed * 1000000)).toFixed(1);
          resolve({
            speedMbps: parseFloat(speedMbps),
            bytes: totalBytes,
            elapsed: elapsed.toFixed(2)
          });
        });
      });

      req.on('error', () => resolve({ speedMbps: 0, bytes: 0, elapsed: 0 }));
      req.on('timeout', () => { req.destroy(); resolve({ speedMbps: 0, bytes: 0, elapsed: 0 }); });
    });
  }

  generateInstallId() {
    return crypto.randomBytes(11).toString('hex');
  }
}

module.exports = WarpClient;

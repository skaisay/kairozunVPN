// KairozunVPN — Renderer Process

class KairozunApp {
  constructor() {
    this.isConnected = false;
    this.isConnecting = false;
    this.selectedServer = null;
    this.servers = [];
    this.connectionTimer = null;
    this.connectionStart = null;
    this.trafficInterval = null;
    this.ipCheckInterval = null;
    this.ipVisible = false;
    this.realIP = '';
    this.lastTrafficSent = 0;
    this.lastTrafficReceived = 0;
    this.lastTrafficTime = 0;

    this.init();
  }

  async init() {
    this.bindEvents();
    this.checkIP();

    // Проверяем, настроен ли WARP
    const warpCheck = await window.kairozunAPI.warpIsSetup();
    if (warpCheck.success && warpCheck.data) {
      // WARP уже настроен — грузим серверы
      await this.loadServers();
    } else {
      // Первый запуск: показать модальное окно
      this.showModal('modal-setup');
    }

    this.startStatusPolling();
    this.loadSettings();
  }

  bindEvents() {
    // Управление окном
    document.getElementById('btn-minimize').addEventListener('click', () => {
      window.kairozunAPI.minimizeWindow();
    });
    document.getElementById('btn-close').addEventListener('click', () => {
      window.kairozunAPI.closeWindow();
    });

    // Подключение
    document.getElementById('btn-connect').addEventListener('click', () => {
      this.toggleConnection();
    });

    // Импорт конфигурации
    document.getElementById('btn-import').addEventListener('click', () => {
      this.importConfig();
    });

    // Быстрые действия
    document.getElementById('btn-change-ip').addEventListener('click', () => {
      this.changeIP();
    });
    document.getElementById('btn-speed-test').addEventListener('click', () => {
      this.showModal('modal-speed');
    });
    document.getElementById('btn-refresh-ip').addEventListener('click', () => {
      this.checkIP();
    });

    // Глазик для IP
    document.getElementById('btn-toggle-ip').addEventListener('click', () => {
      this.toggleIPVisibility();
    });

    // Настройки
    document.getElementById('btn-settings').addEventListener('click', () => {
      this.showModal('modal-settings');
    });

    // Генератор ключей
    document.getElementById('btn-keygen').addEventListener('click', () => {
      this.showModal('modal-keygen');
    });
    document.getElementById('btn-generate-keys').addEventListener('click', () => {
      this.generateKeys();
    });

    // Авто-настройка WARP
    document.getElementById('btn-auto-setup').addEventListener('click', () => {
      this.autoSetupWarp();
    });

    // Тест скорости
    document.getElementById('btn-run-speed').addEventListener('click', () => {
      this.runSpeedTest();
    });

    // Сброс WARP
    const btnReset = document.getElementById('btn-reset-warp');
    if (btnReset) {
      btnReset.addEventListener('click', () => {
        this.resetWarp();
      });
    }

    // === Beta: Персональный сервер (Tailscale) ===
    document.getElementById('btn-server-mode').addEventListener('click', () => {
      this.showServerModal();
    });
    document.getElementById('btn-server-setup').addEventListener('click', () => {
      this.setupServer();
    });
    document.getElementById('btn-server-toggle').addEventListener('click', () => {
      this.toggleServer();
    });
    document.getElementById('btn-add-friend').addEventListener('click', () => {
      this.generateInvite();
    });
    document.getElementById('btn-import-invite').addEventListener('click', () => {
      this.importInviteCode();
    });
    document.getElementById('btn-copy-invite').addEventListener('click', () => {
      const code = document.getElementById('invite-code-display').value;
      if (code) {
        navigator.clipboard.writeText(code).then(() => {
          const btn = document.getElementById('btn-copy-invite');
          btn.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 8l3 3 7-7"/></svg> Скопировано!';
          setTimeout(() => {
            btn.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="5" y="5" width="9" height="9" rx="1"/><path d="M11 5V3a1 1 0 00-1-1H3a1 1 0 00-1 1v7a1 1 0 001 1h2"/></svg> Скопировать код';
          }, 2000);
          this.notify('Код скопирован! Отправьте его другу.', 'success');
        });
      }
    });

    // Kill Switch toggle
    const ksToggle = document.getElementById('setting-killswitch');
    if (ksToggle) {
      ksToggle.addEventListener('change', () => this.saveCurrentSettings());
    }

    // DNS input
    const dnsInput = document.getElementById('setting-dns');
    if (dnsInput) {
      dnsInput.addEventListener('change', () => this.saveCurrentSettings());
    }

    // Закрытие модальных окон
    document.querySelectorAll('.modal-close').forEach(btn => {
      btn.addEventListener('click', () => {
        const modalId = btn.getAttribute('data-modal');
        this.hideModal(modalId);
      });
    });

    document.querySelectorAll('.modal-overlay').forEach(overlay => {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
          overlay.style.display = 'none';
        }
      });
    });

    // Копирование
    document.querySelectorAll('.copy-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const inputId = btn.getAttribute('data-copy');
        const input = document.getElementById(inputId);
        if (input && input.value) {
          navigator.clipboard.writeText(input.value).then(() => {
            this.notify('Скопировано в буфер обмена', 'success');
          });
        }
      });
    });
  }

  // === WARP авто-настройка ===

  async autoSetupWarp() {
    const btn = document.getElementById('btn-auto-setup');
    const progress = document.getElementById('setup-progress');
    const fill = document.getElementById('progress-fill');
    const text = document.getElementById('progress-text');

    btn.style.display = 'none';
    progress.style.display = 'block';

    // Анимация прогресса
    const steps = [
      { pct: 15, msg: 'Генерация ключей WireGuard...' },
      { pct: 40, msg: 'Регистрация в Cloudflare WARP...' },
      { pct: 70, msg: 'Создание конфигурации...' },
      { pct: 90, msg: 'Сохранение серверов...' },
    ];

    let stepIndex = 0;
    const stepTimer = setInterval(() => {
      if (stepIndex < steps.length) {
        fill.style.width = steps[stepIndex].pct + '%';
        text.textContent = steps[stepIndex].msg;
        stepIndex++;
      }
    }, 800);

    const result = await window.kairozunAPI.warpSetup();

    clearInterval(stepTimer);

    if (result.success) {
      fill.style.width = '100%';
      text.textContent = 'Готово! Серверы настроены.';

      this.servers = result.data;
      if (this.servers.length > 0) {
        this.selectedServer = this.servers[0].id;
      }
      this.renderServers();

      setTimeout(() => {
        this.hideModal('modal-setup');
        this.notify('WARP настроен! Выберите сервер и подключитесь.', 'success');
      }, 1000);
    } else {
      fill.style.width = '0%';
      text.textContent = 'Ошибка: ' + (result.error || 'Неизвестная ошибка');
      btn.style.display = 'flex';
      this.notify(result.error || 'Ошибка настройки WARP', 'error');
    }
  }

  // === Смена IP ===

  async changeIP() {
    if (this.isConnecting) return;

    const wasConnected = this.isConnected;
    if (wasConnected) {
      this.setConnecting(true);
      document.getElementById('status-text').textContent = 'Смена IP...';
      document.getElementById('status-detail').textContent = 'Перерегистрация в WARP';
    }

    this.notify('Смена IP...', 'info');

    const result = await window.kairozunAPI.warpRefresh();
    if (result.success) {
      this.servers = result.data;
      if (this.servers.length > 0) {
        this.selectedServer = this.servers[0].id;
      }
      this.renderServers();
      this.notify('IP изменён! Новые серверы готовы.', 'success');

      if (wasConnected) {
        this.setConnecting(false);
        this.setConnected(false);
        // Автоматически реконнект
        await this.connect();
      }

      this.checkIP();
    } else {
      if (wasConnected) {
        this.setConnecting(false);
      }
      this.notify(result.error || 'Ошибка смены IP', 'error');
    }
  }

  // === Сброс WARP ===

  async resetWarp() {
    if (this.isConnected) {
      await this.disconnect();
    }
    this.hideModal('modal-settings');
    this.servers = [];
    this.selectedServer = null;
    this.renderServers();
    this.showModal('modal-setup');

    // Сброс UI модалки
    const btn = document.getElementById('btn-auto-setup');
    const progress = document.getElementById('setup-progress');
    btn.style.display = 'flex';
    progress.style.display = 'none';
  }

  // === Проверка IP ===

  async checkIP() {
    const ipDisplay = document.getElementById('current-ip-display');
    const locationDisplay = document.getElementById('ip-location');

    ipDisplay.textContent = 'Определение...';
    locationDisplay.textContent = '---';

    const result = await window.kairozunAPI.checkIP();
    if (result.success && result.data) {
      this.realIP = result.data.ip || 'Неизвестен';
      const parts = [];
      if (result.data.country) parts.push(result.data.country);
      if (result.data.city) parts.push(result.data.city);
      if (result.data.org) parts.push(result.data.org);
      locationDisplay.textContent = parts.join(' · ') || '---';
      // По умолчанию скрыт
      if (this.ipVisible) {
        ipDisplay.textContent = this.realIP;
      } else {
        ipDisplay.textContent = this.maskIP(this.realIP);
      }
    } else {
      this.realIP = 'Недоступен';
      ipDisplay.textContent = 'Недоступен';
    }
  }

  maskIP(ip) {
    if (!ip || ip === 'Неизвестен' || ip === 'Недоступен') return ip;
    // 123.45.67.89 → •••.••.••.••
    return ip.replace(/\d/g, '•');
  }

  toggleIPVisibility() {
    this.ipVisible = !this.ipVisible;
    const ipDisplay = document.getElementById('current-ip-display');
    const eyeSlash = document.getElementById('eye-slash');
    if (this.ipVisible) {
      ipDisplay.textContent = this.realIP;
      eyeSlash.style.display = 'none';
    } else {
      ipDisplay.textContent = this.maskIP(this.realIP);
      eyeSlash.style.display = 'block';
    }
  }

  // === Тест скорости ===

  async runSpeedTest() {
    const gauge = document.querySelector('.speed-gauge');
    const valueEl = document.getElementById('speed-result');
    const detailsEl = document.getElementById('speed-details');
    const btn = document.getElementById('btn-run-speed');

    gauge.classList.add('testing');
    valueEl.textContent = '...';
    detailsEl.textContent = 'Тестирование...';
    btn.disabled = true;
    btn.querySelector('span').textContent = 'Тестирование...';

    const result = await window.kairozunAPI.speedTest();

    gauge.classList.remove('testing');
    btn.disabled = false;
    btn.querySelector('span').textContent = 'Запустить тест';

    if (result.success && result.data) {
      valueEl.textContent = result.data.speedMbps || '0';
      detailsEl.textContent = `${result.data.bytes ? (result.data.bytes / 1024).toFixed(0) : 0} КБ за ${result.data.elapsed || 0} сек`;
      document.getElementById('speed-display').textContent = result.data.speedMbps + ' Мбит/с';
    } else {
      valueEl.textContent = '--';
      detailsEl.textContent = 'Ошибка теста';
    }
  }

  // === Настройки ===

  async loadSettings() {
    const result = await window.kairozunAPI.getSettings();
    if (result.success && result.data) {
      const ks = document.getElementById('setting-killswitch');
      const dns = document.getElementById('setting-dns');
      if (ks) ks.checked = result.data.killswitch || false;
      if (dns) dns.value = result.data.dns || '1.1.1.1, 1.0.0.1';
    }
  }

  async saveCurrentSettings() {
    const ks = document.getElementById('setting-killswitch');
    const dns = document.getElementById('setting-dns');
    await window.kairozunAPI.saveSettings({
      killswitch: ks ? ks.checked : false,
      dns: dns ? dns.value : '1.1.1.1, 1.0.0.1'
    });
  }

  // === Серверы ===

  async loadServers() {
    const result = await window.kairozunAPI.getServers();
    if (result.success) {
      this.servers = result.data;
      if (this.servers.length > 0 && !this.selectedServer) {
        this.selectedServer = this.servers[0].id;
      }
      this.renderServers();
    }
  }

  renderServers() {
    const list = document.getElementById('servers-list');

    if (this.servers.length === 0) {
      list.innerHTML = `
        <div class="empty-servers">
          <svg viewBox="0 0 48 48" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.4">
            <rect x="6" y="8" width="36" height="10" rx="2"/>
            <rect x="6" y="22" width="36" height="10" rx="2"/>
            <rect x="6" y="36" width="36" height="10" rx="2" stroke-dasharray="4 2"/>
            <circle cx="12" cy="13" r="2" fill="currentColor"/>
            <circle cx="12" cy="27" r="2" fill="currentColor"/>
          </svg>
          <span>Нет серверов</span>
          <span class="empty-hint">Нажмите «Настроить автоматически» для бесплатного VPN</span>
        </div>
      `;
      return;
    }

    list.innerHTML = this.servers.map(server => `
      <div class="server-item ${this.selectedServer === server.id ? 'active' : ''}" data-server-id="${this.escapeHtml(server.id)}">
        <div class="server-flag">${this.escapeHtml(server.flag || 'VPN')}</div>
        <div class="server-info">
          <div class="server-name">${this.escapeHtml(server.name)}</div>
          <div class="server-endpoint">${this.escapeHtml(server.country || server.endpoint || 'Не указан')} · ${this.escapeHtml(server.endpoint || '')}</div>
        </div>
        <div class="server-actions">
          <button class="server-action-btn delete" data-delete="${this.escapeHtml(server.id)}" title="Удалить">
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M2 4h12M5 4V3a1 1 0 011-1h4a1 1 0 011 1v1M6 7v5M10 7v5"/>
              <path d="M3 4l1 9a1 1 0 001 1h6a1 1 0 001-1l1-9"/>
            </svg>
          </button>
        </div>
      </div>
    `).join('');

    // Обработчики кликов
    list.querySelectorAll('.server-item').forEach(item => {
      item.addEventListener('click', (e) => {
        if (e.target.closest('.server-action-btn')) return;
        const serverId = item.getAttribute('data-server-id');
        this.selectServer(serverId);
      });
    });

    list.querySelectorAll('.server-action-btn.delete').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const serverId = btn.getAttribute('data-delete');
        this.removeServer(serverId);
      });
    });
  }

  selectServer(serverId) {
    this.selectedServer = serverId;
    this.renderServers();
  }

  async removeServer(serverId) {
    const result = await window.kairozunAPI.removeServer(serverId);
    if (result.success) {
      this.servers = this.servers.filter(s => s.id !== serverId);
      if (this.selectedServer === serverId) {
        this.selectedServer = this.servers.length > 0 ? this.servers[0].id : null;
      }
      this.renderServers();
      this.notify('Сервер удален', 'info');
    } else {
      this.notify(result.error || 'Ошибка удаления', 'error');
    }
  }

  // === Подключение ===

  async toggleConnection() {
    if (this.isConnecting) return;

    if (this.isConnected) {
      await this.disconnect();
    } else {
      await this.connect();
    }
  }

  async connect() {
    if (!this.selectedServer) {
      this.notify('Выберите сервер для подключения', 'error');
      return;
    }

    const server = this.servers.find(s => s.id === this.selectedServer);
    if (!server) {
      this.notify('Сервер не найден', 'error');
      return;
    }

    // Tailscale-сервер подключается через exit-node, а не WireGuard
    if (server.id === 'tailscale-personal') {
      this.setConnecting(true);
      const result = await window.kairozunAPI.serverStart();
      if (result.success) {
        this.setConnected(true);
        this.notify('Подключено через Tailscale Exit Node', 'success');
        setTimeout(() => this.checkIP(), 4000);
      } else {
        this.setConnecting(false);
        this.setConnected(false);
        this.notify(result.error || 'Ошибка подключения к Tailscale', 'error');
      }
      return;
    }

    if (!server.config) {
      this.notify('Конфигурация сервера отсутствует', 'error');
      return;
    }

    this.setConnecting(true);

    const result = await window.kairozunAPI.connect(server.config);
    if (result.success) {
      this.setConnected(true);
      this.notify('VPN подключен — проверяю IP...', 'success');
      // Проверяем IP через 4 секунды (дать время туннелю маршрутизироваться)
      setTimeout(async () => {
        await this.checkIP();
        // Дополнительная проверка: изменился ли IP
        if (this.realIP && this.realIP !== 'Неизвестен' && this.realIP !== 'Недоступен') {
          document.getElementById('status-detail').textContent = `Ваш новый IP: ${this.ipVisible ? this.realIP : this.maskIP(this.realIP)}`;
        }
      }, 4000);
    } else {
      this.setConnecting(false);
      this.setConnected(false);
      this.notify(result.error || 'Ошибка подключения', 'error');
    }
  }

  async disconnect() {
    this.setConnecting(true);

    const result = await window.kairozunAPI.disconnect();
    if (result.success) {
      this.setConnected(false);
      this.notify('VPN отключен', 'info');
      // Обновить IP через 3 секунды (дать время маршрутам обновиться)
      setTimeout(() => this.checkIP(), 3000);
    } else {
      this.setConnecting(false);
      this.notify(result.error || 'Ошибка отключения', 'error');
    }
  }

  setConnecting(connecting) {
    this.isConnecting = connecting;
    const ring = document.getElementById('status-ring');
    const btn = document.getElementById('btn-connect');
    const indicator = document.getElementById('bottom-indicator');

    if (connecting) {
      ring.classList.add('connecting');
      ring.classList.remove('connected');
      btn.classList.add('connecting');
      btn.querySelector('span').textContent = 'Подключение...';
      indicator.classList.add('connecting');
      indicator.classList.remove('connected');
      document.getElementById('status-text').textContent = 'Подключение...';
      document.getElementById('status-detail').textContent = 'Пожалуйста, подождите';
      document.getElementById('bottom-status-text').textContent = 'Подключение...';
    } else {
      ring.classList.remove('connecting');
      btn.classList.remove('connecting');
      indicator.classList.remove('connecting');
    }
  }

  setConnected(connected) {
    this.isConnected = connected;
    this.isConnecting = false;

    const ring = document.getElementById('status-ring');
    const btn = document.getElementById('btn-connect');
    const indicator = document.getElementById('bottom-indicator');
    const trafficSection = document.getElementById('traffic-section');
    const statusIcon = document.getElementById('status-icon');

    ring.classList.remove('connecting');
    btn.classList.remove('connecting');
    indicator.classList.remove('connecting');

    const checkPath = statusIcon.querySelector('.check-path');
    const dotPath = statusIcon.querySelector('.dot-path');

    if (connected) {
      ring.classList.add('connected');
      btn.classList.add('connected');
      btn.querySelector('svg').innerHTML = '<rect x="6" y="6" width="12" height="12" rx="2"/>';
      btn.querySelector('span').textContent = 'Отключиться';
      indicator.classList.add('connected');
      trafficSection.style.display = 'block';
      document.getElementById('status-text').textContent = 'Защищено';
      document.getElementById('status-detail').textContent = 'Ваше соединение защищено';
      document.getElementById('bottom-status-text').textContent = 'Защита активна';
      if (checkPath) checkPath.style.display = 'block';
      if (dotPath) dotPath.style.display = 'none';
      this.startConnectionTimer();
      this.startTrafficPolling();
    } else {
      ring.classList.remove('connected');
      btn.classList.remove('connected');
      btn.querySelector('svg').innerHTML = '<polygon points="5 3 19 12 5 21 5 3"/>';
      btn.querySelector('span').textContent = 'Подключиться';
      indicator.classList.remove('connected');
      trafficSection.style.display = 'none';
      document.getElementById('status-text').textContent = 'Отключено';
      document.getElementById('status-detail').textContent = 'Нажмите для подключения';
      document.getElementById('bottom-status-text').textContent = 'Защита отключена';
      if (checkPath) checkPath.style.display = 'none';
      if (dotPath) dotPath.style.display = 'block';
      this.stopConnectionTimer();
      this.stopTrafficPolling();
    }
  }

  // === Таймер подключения ===

  startConnectionTimer() {
    this.connectionStart = Date.now();
    this.connectionTimer = setInterval(() => {
      const elapsed = Date.now() - this.connectionStart;
      const hours = Math.floor(elapsed / 3600000).toString().padStart(2, '0');
      const minutes = Math.floor((elapsed % 3600000) / 60000).toString().padStart(2, '0');
      const seconds = Math.floor((elapsed % 60000) / 1000).toString().padStart(2, '0');
      document.getElementById('connection-time').textContent = `${hours}:${minutes}:${seconds}`;
    }, 1000);
  }

  stopConnectionTimer() {
    if (this.connectionTimer) {
      clearInterval(this.connectionTimer);
      this.connectionTimer = null;
    }
    document.getElementById('connection-time').textContent = '00:00:00';
  }

  // === Трафик ===

  startTrafficPolling() {
    this.lastTrafficSent = 0;
    this.lastTrafficReceived = 0;
    this.lastTrafficTime = Date.now();

    this.trafficInterval = setInterval(async () => {
      const result = await window.kairozunAPI.getTraffic();
      if (result.success) {
        const now = Date.now();
        const sent = result.data.sent || 0;
        const received = result.data.received || 0;

        document.getElementById('traffic-up').textContent = this.formatBytes(sent);
        document.getElementById('traffic-down').textContent = this.formatBytes(received);

        // Рассчитываем скорость из разницы трафика
        if (this.lastTrafficTime > 0 && (this.lastTrafficSent > 0 || this.lastTrafficReceived > 0)) {
          const elapsed = (now - this.lastTrafficTime) / 1000; // секунды
          if (elapsed > 0) {
            const deltaDown = received - this.lastTrafficReceived;
            const deltaUp = sent - this.lastTrafficSent;
            const totalDelta = Math.max(deltaDown + deltaUp, 0);
            const speedMbps = ((totalDelta * 8) / (elapsed * 1000000)).toFixed(1);
            document.getElementById('speed-display').textContent = speedMbps + ' Мбит/с';
          }
        }

        this.lastTrafficSent = sent;
        this.lastTrafficReceived = received;
        this.lastTrafficTime = now;
      }
    }, 2000);
  }

  stopTrafficPolling() {
    if (this.trafficInterval) {
      clearInterval(this.trafficInterval);
      this.trafficInterval = null;
    }
    document.getElementById('traffic-up').textContent = '0 B';
    document.getElementById('traffic-down').textContent = '0 B';
  }

  // === Статус ===

  startStatusPolling() {
    setInterval(async () => {
      const result = await window.kairozunAPI.getStatus();
      if (result.success) {
        const wasConnected = this.isConnected;
        if (result.data.connected && !wasConnected && !this.isConnecting) {
          this.setConnected(true);
        } else if (!result.data.connected && wasConnected && !this.isConnecting) {
          this.setConnected(false);
          this.notify('VPN соединение потеряно', 'error');
        }
      }
    }, 5000);
  }

  // === Импорт конфигурации ===

  async importConfig() {
    const result = await window.kairozunAPI.importConfig();
    if (result.success) {
      this.servers.push(result.data);
      this.selectedServer = result.data.id;
      this.renderServers();
      this.notify('Конфигурация импортирована', 'success');
    } else if (result.error !== 'Отменено') {
      this.notify(result.error || 'Ошибка импорта', 'error');
    }
  }

  // === Генератор ключей ===

  async generateKeys() {
    const result = await window.kairozunAPI.generateKeys();
    if (result.success) {
      document.getElementById('keygen-private').value = result.data.privateKey;
      document.getElementById('keygen-public').value = result.data.publicKey;
      this.notify('Ключи сгенерированы', 'success');
    } else {
      this.notify(result.error || 'Ошибка генерации ключей', 'error');
    }
  }

  // === Beta: Персональный VPN-сервер ===

  async showServerModal() {
    this.showModal('modal-server');
    await this.refreshServerStatus();
    this.startServerPolling();
  }

  stopServerPolling() {
    if (this.serverPollTimer) {
      clearInterval(this.serverPollTimer);
      this.serverPollTimer = null;
    }
  }

  startServerPolling() {
    this.stopServerPolling();
    this.serverPollTimer = setInterval(async () => {
      // Только если модалка открыта
      const modal = document.getElementById('modal-server');
      if (modal.style.display === 'none' || modal.style.display === '') {
        this.stopServerPolling();
        return;
      }
      await this.refreshServerStatus();
    }, 3000);
  }

  showPhase(phase) {
    ['phase-setup', 'phase-login', 'phase-configuring', 'phase-ready'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
    const target = document.getElementById('phase-' + phase);
    if (target) target.style.display = 'block';
  }

  async refreshServerStatus() {
    const statusResult = await window.kairozunAPI.serverStatus();
    const indicator = document.getElementById('server-indicator');
    const label = document.getElementById('server-status-label');
    const details = document.getElementById('server-details');

    if (!statusResult.success) return;
    const s = statusResult.data;

    // Показываем ready если залогинен (сервер уже был настроен)
    if (s.loggedIn && (s.configured || s.isExitNode || s.hasAuthKey)) {
      this.showPhase('ready');

      const btn = document.getElementById('btn-server-toggle');
      if (s.isExitNode) {
        indicator.classList.add('online');
        label.textContent = 'Exit Node активен';
        details.style.display = 'flex';
        btn.classList.add('running');
        btn.querySelector('span').textContent = 'Остановить Exit Node';
        btn.classList.add('connected');
        // Добавить в основной список если ещё нет
        if (!this.servers.find(sv => sv.id === 'tailscale-personal')) {
          await this.addTailscaleServer();
        }
      } else {
        indicator.classList.remove('online');
        label.textContent = 'Exit Node остановлен';
        details.style.display = 'none';
        btn.classList.remove('running');
        btn.classList.remove('connected');
        btn.querySelector('span').textContent = 'Запустить Exit Node';
      }

      // Обновить консоль
      this.updateServerConsole(s);
    } else if (!s.tailscaleInstalled || !s.loggedIn) {
      this.showPhase('setup');
      indicator.classList.remove('online');
      label.textContent = s.tailscaleInstalled ? 'Требуется вход' : 'Не настроен';
      details.style.display = 'none';
    } else {
      this.showPhase('setup');
      indicator.classList.remove('online');
      label.textContent = 'Требуется настройка';
      details.style.display = 'none';
    }

    document.getElementById('server-public-ip').textContent = s.tailscaleIP || '—';
    document.getElementById('server-client-count').textContent = s.peers || 0;
  }

  updateServerConsole(s) {
    const conStatus = document.getElementById('con-status');
    const conExitNode = document.getElementById('con-exit-node');
    const conIP = document.getElementById('con-ip');
    const conPeers = document.getElementById('con-peers');
    const conPeersList = document.getElementById('con-peers-list');
    const liveDot = document.getElementById('console-live-dot');

    if (!conStatus) return;

    // Статус
    if (s.isExitNode && s.loggedIn) {
      conStatus.textContent = 'Активен';
      conStatus.className = 'console-value online';
      liveDot.className = 'console-live-dot active';
    } else if (s.loggedIn) {
      conStatus.textContent = 'Остановлен';
      conStatus.className = 'console-value offline';
      liveDot.className = 'console-live-dot';
    } else {
      conStatus.textContent = 'Отключён';
      conStatus.className = 'console-value offline';
      liveDot.className = 'console-live-dot';
    }

    conExitNode.textContent = s.isExitNode ? 'Включён' : 'Выключен';
    conExitNode.className = s.isExitNode ? 'console-value online' : 'console-value offline';
    conIP.textContent = s.tailscaleIP || '—';
    conPeers.textContent = s.peers || 0;

    // Список пиров
    if (s.peerList && s.peerList.length > 0) {
      conPeersList.innerHTML = s.peerList.map(p => `
        <div class="console-peer">
          <div class="console-peer-dot"></div>
          <span class="console-peer-name">${this.escapeHtml(p.name)}</span>
          <span class="console-peer-ip">${this.escapeHtml(p.ip)} · ${this.escapeHtml(p.os)}</span>
        </div>
      `).join('');
    } else {
      conPeersList.innerHTML = '<div class="console-row dim">Нет подключённых устройств</div>';
    }
  }

  serverLog(msg) {
    const log = document.getElementById('console-log');
    if (!log) return;
    const time = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const entry = document.createElement('div');
    entry.className = 'console-log-entry';
    entry.innerHTML = `<span class="log-time">${time}</span>${this.escapeHtml(msg)}`;
    log.appendChild(entry);
    log.scrollTop = log.scrollHeight;
    // Ограничить до 20 записей
    while (log.children.length > 20) {
      log.removeChild(log.firstChild);
    }
  }

  async setupServer() {
    const btn = document.getElementById('btn-server-setup');
    const hint = document.getElementById('setup-hint');
    btn.disabled = true;
    btn.innerHTML = '<div class="loading-spinner spinner-lg"></div><span>Настраиваю...</span>';
    hint.textContent = 'Подождите, всё делается автоматически...';

    const result = await window.kairozunAPI.serverSetup();

    if (!result.success) {
      btn.disabled = false;
      btn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg><span>🚀 Настроить сервер</span>';
      hint.textContent = 'Один клик — всё автоматически';
      this.notify(result.error || 'Ошибка', 'error');
      return;
    }

    if (result.data.step === 'login') {
      this.showPhase('login');
      this.notify('Войдите в Tailscale в браузере', 'info');
      this.startLoginPolling();
      return;
    }

    if (result.data.step === 'ready') {
      this.showPhase('ready');
      this.notify('Сервер готов! Создавайте коды для друзей.', 'success');
      await this.refreshServerStatus();
      return;
    }

    btn.disabled = false;
    btn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg><span>🚀 Настроить сервер</span>';
    this.notify(result.data.message || 'Неизвестная ошибка', 'error');
  }

  startLoginPolling() {
    if (this.loginPollTimer) clearInterval(this.loginPollTimer);
    this.loginPollTimer = setInterval(async () => {
      const status = await window.kairozunAPI.serverStatus();
      if (status.success && status.data.loggedIn) {
        clearInterval(this.loginPollTimer);
        this.loginPollTimer = null;

        // Показываем "настраиваю..."
        this.showPhase('configuring');

        // Запускаем полную автонастройку
        const setupResult = await window.kairozunAPI.serverSetup();
        if (setupResult.success && setupResult.data.step === 'ready') {
          this.showPhase('ready');
          this.notify('Сервер полностью настроен!', 'success');
        } else {
          this.showPhase('ready');
          this.notify('Сервер настроен.', 'success');
        }
        await this.refreshServerStatus();
      }
    }, 3000);
  }

  async toggleServer() {
    const btn = document.getElementById('btn-server-toggle');
    const isRunning = btn.classList.contains('running');

    btn.disabled = true;
    btn.querySelector('span').textContent = isRunning ? 'Остановка...' : 'Запуск...';
    this.serverLog(isRunning ? 'Остановка Exit Node...' : 'Запуск Exit Node...');

    if (isRunning) {
      const result = await window.kairozunAPI.serverStop();
      if (result.success) {
        this.notify('Exit Node остановлен', 'info');
        this.serverLog('Exit Node остановлен');
        this.removeTailscaleServer();
      } else {
        this.notify(result.error || 'Ошибка', 'error');
        this.serverLog('Ошибка: ' + (result.error || 'неизвестно'));
      }
    } else {
      const result = await window.kairozunAPI.serverStart();
      if (result.success) {
        this.notify('Exit Node запущен!', 'success');
        this.serverLog('Exit Node запущен');
        await this.addTailscaleServer();
      } else {
        this.notify(result.error || 'Ошибка', 'error');
        this.serverLog('Ошибка: ' + (result.error || 'неизвестно'));
      }
    }

    btn.disabled = false;
    // Небольшая задержка чтобы Tailscale обновил статус
    await new Promise(r => setTimeout(r, 1500));
    await this.refreshServerStatus();
  }

  // Добавить Tailscale-сервер в основной список
  async addTailscaleServer() {
    const info = await window.kairozunAPI.serverInfo();
    if (!info.success) return;
    const ip = info.data.tailscaleIP;
    if (!ip) return;

    // Удалить старый если есть
    this.servers = this.servers.filter(s => s.id !== 'tailscale-personal');

    this.servers.unshift({
      id: 'tailscale-personal',
      name: 'Мой сервер (Tailscale)',
      flag: '🖥️',
      country: 'Норвегия',
      endpoint: ip
    });
    this.selectedServer = 'tailscale-personal';
    this.renderServers();
  }

  // Убрать Tailscale-сервер из основного списка
  removeTailscaleServer() {
    this.servers = this.servers.filter(s => s.id !== 'tailscale-personal');
    if (this.selectedServer === 'tailscale-personal') {
      this.selectedServer = this.servers.length > 0 ? this.servers[0].id : null;
    }
    this.renderServers();
  }

  async generateInvite() {
    const input = document.getElementById('friend-name-input');
    const name = input.value.trim() || null;

    const result = await window.kairozunAPI.serverGenerateInvite(name);
    if (result.success) {
      input.value = '';
      document.getElementById('invite-code-display').value = result.data.inviteCode;
      document.getElementById('invite-code-box').textContent = result.data.inviteCode;
      this.showModal('modal-invite');
      this.notify('Код создан! Отправьте другу.', 'success');
    } else {
      this.notify(result.error || 'Ошибка', 'error');
    }
  }

  async importInviteCode() {
    const input = document.getElementById('invite-code-input');
    const code = input.value.trim();
    if (!code) {
      this.notify('Вставьте код приглашения', 'error');
      return;
    }

    const btn = document.getElementById('btn-import-invite');
    btn.textContent = 'Подключение...';
    btn.disabled = true;

    const result = await window.kairozunAPI.serverImportInvite(code);
    if (result.success) {
      input.value = '';
      this.hideModal('modal-server');
      this.notify('Подключено! Весь трафик идёт через VPN друга.', 'success');
    } else {
      this.notify(result.error || 'Неверный код', 'error');
    }

    btn.textContent = 'Подключить';
    btn.disabled = false;
  }

  // === Модальные окна ===

  showModal(id) {
    document.getElementById(id).style.display = 'flex';
  }

  hideModal(id) {
    document.getElementById(id).style.display = 'none';
    if (id === 'modal-server') {
      this.stopServerPolling();
    }
  }

  // === Уведомления ===

  notify(message, type = 'info') {
    const container = document.getElementById('notifications');
    const el = document.createElement('div');
    el.className = `notification ${type}`;

    let icon = '';
    if (type === 'success') {
      icon = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="#10b981" stroke-width="2"><path d="M3 8l3 3 7-7"/></svg>';
    } else if (type === 'error') {
      icon = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="#ef4444" stroke-width="2"><circle cx="8" cy="8" r="6"/><path d="M8 5v3M8 10v1"/></svg>';
    } else {
      icon = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="#6366f1" stroke-width="2"><circle cx="8" cy="8" r="6"/><path d="M8 7v4M8 5v0.5"/></svg>';
    }

    el.innerHTML = icon + this.escapeHtml(message);
    container.appendChild(el);

    setTimeout(() => {
      el.classList.add('fade-out');
      setTimeout(() => el.remove(), 300);
    }, 3000);
  }

  // === Утилиты ===

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
  }

  formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    const value = (bytes / Math.pow(1024, i)).toFixed(1);
    return `${value} ${units[i]}`;
  }
}

// Запуск приложения
document.addEventListener('DOMContentLoaded', () => {
  new KairozunApp();
});

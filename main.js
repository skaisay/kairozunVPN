const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, dialog } = require('electron');
const path = require('path');
const VPNManager = require('./src/vpn-manager');
const PersonalServer = require('./src/personal-server');

let mainWindow;
let tray;
let vpnManager;
let personalServer;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 520,
    height: 750,
    minWidth: 460,
    minHeight: 650,
    frame: false,
    transparent: true,
    resizable: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    },
    icon: path.join(__dirname, 'assets', 'icon.png'),
    show: false
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('close', (event) => {
    event.preventDefault();
    mainWindow.hide();
  });
}

function createTray() {
  const iconPath = path.join(__dirname, 'assets', 'tray-icon.png');
  let trayIcon;
  try {
    trayIcon = nativeImage.createFromPath(iconPath);
    if (trayIcon.isEmpty()) {
      trayIcon = nativeImage.createEmpty();
    }
  } catch {
    trayIcon = nativeImage.createEmpty();
  }

  tray = new Tray(trayIcon);

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Открыть KairozunVPN',
      click: () => mainWindow.show()
    },
    { type: 'separator' },
    {
      label: 'Выход',
      click: () => {
        if (vpnManager) {
          vpnManager.disconnect().finally(() => {
            mainWindow.destroy();
            app.quit();
          });
        } else {
          mainWindow.destroy();
          app.quit();
        }
      }
    }
  ]);

  tray.setToolTip('KairozunVPN');
  tray.setContextMenu(contextMenu);
  tray.on('double-click', () => mainWindow.show());
}

app.whenReady().then(() => {
  vpnManager = new VPNManager();
  personalServer = new PersonalServer();
  createWindow();
  createTray();

  // IPC: Управление окном
  ipcMain.on('window-minimize', () => mainWindow.minimize());
  ipcMain.on('window-close', () => mainWindow.hide());

  // IPC: VPN подключение
  ipcMain.handle('vpn-connect', async (event, config) => {
    try {
      const result = await vpnManager.connect(config);
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('vpn-disconnect', async () => {
    try {
      await vpnManager.disconnect();
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('vpn-status', async () => {
    try {
      const status = await vpnManager.getStatus();
      return { success: true, data: status };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('vpn-get-servers', async () => {
    try {
      const servers = vpnManager.getServers();
      return { success: true, data: servers };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('vpn-import-config', async () => {
    try {
      const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Импорт конфигурации WireGuard',
        filters: [{ name: 'WireGuard Config', extensions: ['conf'] }],
        properties: ['openFile']
      });

      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, error: 'Отменено' };
      }

      const configPath = result.filePaths[0];
      const server = await vpnManager.importConfig(configPath);
      return { success: true, data: server };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('vpn-generate-keys', async () => {
    try {
      const keys = await vpnManager.generateKeys();
      return { success: true, data: keys };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('vpn-get-traffic', async () => {
    try {
      const traffic = await vpnManager.getTraffic();
      return { success: true, data: traffic };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('vpn-remove-server', async (event, serverId) => {
    try {
      vpnManager.removeServer(serverId);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // IPC: WARP (бесплатный VPN)
  ipcMain.handle('warp-setup', async () => {
    try {
      const servers = await vpnManager.setupWarp();
      return { success: true, data: servers };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('warp-refresh', async () => {
    try {
      const servers = await vpnManager.refreshWarp();
      return { success: true, data: servers };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('warp-is-setup', async () => {
    return { success: true, data: vpnManager.isWarpSetup() };
  });

  // IPC: IP и скорость
  ipcMain.handle('check-ip', async () => {
    try {
      const ipInfo = await vpnManager.checkIP();
      return { success: true, data: ipInfo };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('speed-test', async () => {
    try {
      const speed = await vpnManager.speedTest();
      return { success: true, data: speed };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // IPC: Настройки
  ipcMain.handle('get-settings', async () => {
    try {
      const settings = vpnManager.getSettings();
      return { success: true, data: settings };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('save-settings', async (event, settings) => {
    try {
      vpnManager.saveSettings(settings);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // IPC: Персональный сервер (Beta) — Tailscale
  ipcMain.handle('server-setup', async () => {
    try {
      const result = await personalServer.setupServer();
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('server-install-tailscale', async () => {
    try {
      const result = await personalServer.installTailscale();
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('server-set-auth-key', async (event, key) => {
    try {
      const result = personalServer.setAuthKey(key);
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('server-start', async () => {
    try {
      const result = await personalServer.startServer();
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('server-stop', async () => {
    try {
      await personalServer.stopServer();
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('server-status', async () => {
    try {
      const status = await personalServer.getServerStatus();
      return { success: true, data: status };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('server-info', async () => {
    try {
      const info = personalServer.getServerInfo();
      return { success: true, data: info };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('server-generate-invite', async (event, friendName) => {
    try {
      const inviteCode = personalServer.generateInviteCode(friendName);
      return { success: true, data: { inviteCode } };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('server-open-admin', async (event, page) => {
    try {
      personalServer.openAdminConsole(page);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('server-import-invite', async (event, inviteCode) => {
    try {
      const PersonalServerClass = require('./src/personal-server');
      const invite = PersonalServerClass.parseInviteCode(inviteCode);
      const result = await personalServer.connectAsFriend(invite);
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

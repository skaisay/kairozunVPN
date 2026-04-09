const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('kairozunAPI', {
  // Управление окном
  minimizeWindow: () => ipcRenderer.send('window-minimize'),
  closeWindow: () => ipcRenderer.send('window-close'),

  // VPN операции
  connect: (config) => ipcRenderer.invoke('vpn-connect', config),
  disconnect: () => ipcRenderer.invoke('vpn-disconnect'),
  getStatus: () => ipcRenderer.invoke('vpn-status'),
  getServers: () => ipcRenderer.invoke('vpn-get-servers'),
  importConfig: () => ipcRenderer.invoke('vpn-import-config'),
  generateKeys: () => ipcRenderer.invoke('vpn-generate-keys'),
  getTraffic: () => ipcRenderer.invoke('vpn-get-traffic'),
  removeServer: (serverId) => ipcRenderer.invoke('vpn-remove-server', serverId),

  // WARP (бесплатный VPN)
  warpSetup: () => ipcRenderer.invoke('warp-setup'),
  warpRefresh: () => ipcRenderer.invoke('warp-refresh'),
  warpIsSetup: () => ipcRenderer.invoke('warp-is-setup'),

  // IP и скорость
  checkIP: () => ipcRenderer.invoke('check-ip'),
  speedTest: () => ipcRenderer.invoke('speed-test'),

  // Настройки
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),

  // Персональный сервер (Beta)
  serverInit: () => ipcRenderer.invoke('server-init'),
  serverStart: () => ipcRenderer.invoke('server-start'),
  serverStop: () => ipcRenderer.invoke('server-stop'),
  serverStatus: () => ipcRenderer.invoke('server-status'),
  serverInfo: () => ipcRenderer.invoke('server-info'),
  serverAddClient: (name) => ipcRenderer.invoke('server-add-client', name),
  serverRemoveClient: (id) => ipcRenderer.invoke('server-remove-client', id),
  serverImportInvite: (code) => ipcRenderer.invoke('server-import-invite', code)
});

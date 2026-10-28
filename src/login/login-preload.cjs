const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('__notifyHost', (channel, payload) => {
  ipcRenderer.send(channel, payload);
});

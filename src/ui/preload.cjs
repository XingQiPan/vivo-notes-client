const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  login: () => ipcRenderer.invoke('login'),
  logout: () => ipcRenderer.invoke('logout'),
  isLogin: () => ipcRenderer.invoke('isLogin'),
  listNotes: (opts) => ipcRenderer.invoke('notes:list', opts),
  getNote: (guid) => ipcRenderer.invoke('notes:get', guid),
  saveNote: (n) => ipcRenderer.invoke('notes:save', n),
  syncNow: () => ipcRenderer.invoke('sync:now'),
  syncState: () => ipcRenderer.invoke('sync:state'),
});

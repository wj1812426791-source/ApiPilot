'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('apiFlags', {
  selftest: process.argv.includes('--selftest'),
  dev: process.argv.includes('--dev')
});

contextBridge.exposeInMainWorld('api', {
  selftestDone: (payload) => ipcRenderer.send('selftest:done', payload),
  send: (config) => ipcRenderer.invoke('http:send', config),
  loadStore: () => ipcRenderer.invoke('store:load'),
  saveStore: (data) => ipcRenderer.invoke('store:save', data),
  openDialog: (opts) => ipcRenderer.invoke('dialog:open', opts),
  saveDialog: (opts) => ipcRenderer.invoke('dialog:save', opts),
  appInfo: () => ipcRenderer.invoke('app:info'),
  openPath: (p) => ipcRenderer.invoke('app:openPath', p),
  clearCookies: (host) => ipcRenderer.invoke('cookie:clear', host),
  listCookies: () => ipcRenderer.invoke('cookie:list'),
  windowControl: (action) => ipcRenderer.send('window:control', action)
});

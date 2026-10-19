'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('apiFlags', {
  selftest: process.argv.includes('--selftest'),
  dev: process.argv.includes('--dev')
});

contextBridge.exposeInMainWorld('api', {
  selftestDone: (payload) => ipcRenderer.send('selftest:done', payload),
  send: (config) => ipcRenderer.invoke('http:send', config),
  cancel: (reqId) => ipcRenderer.invoke('http:cancel', reqId),
  loadStore: () => ipcRenderer.invoke('store:load'),
  saveStore: (data) => ipcRenderer.invoke('store:save', data),
  // 退出前同步落盘（防止防抖窗口内的改动丢失）
  saveStoreSync: (data) => ipcRenderer.sendSync('store:save-sync', data),
  openDialog: (opts) => ipcRenderer.invoke('dialog:open', opts),
  saveDialog: (opts) => ipcRenderer.invoke('dialog:save', opts),
  appInfo: () => ipcRenderer.invoke('app:info'),
  openPath: (p) => ipcRenderer.invoke('app:openPath', p),
  clearCookies: (host) => ipcRenderer.invoke('cookie:clear', host),
  listCookies: () => ipcRenderer.invoke('cookie:list'),
  windowControl: (action) => ipcRenderer.send('window:control', action)
});

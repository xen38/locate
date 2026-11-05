const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('locateAPI', {
  // Config
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (updates) => ipcRenderer.invoke('config:set', updates),

  // Harnesses
  addHarness: (dirPath) => ipcRenderer.invoke('harness:add', dirPath),
  removeHarness: (dirPath) => ipcRenderer.invoke('harness:remove', dirPath),
  listHarnesses: () => ipcRenderer.invoke('harness:list'),
  autodetectHarnesses: () => ipcRenderer.invoke('harness:autodetect'),
  openFolderDialog: () => ipcRenderer.invoke('dialog:openFolder'),

  // Sessions
  listSessions: (dirPath) => ipcRenderer.invoke('session:list', dirPath),
  listAllSessions: () => ipcRenderer.invoke('session:listAll'),
  readSession: (filePath) => ipcRenderer.invoke('session:read', filePath),
  searchSessions: (query, options) => ipcRenderer.invoke('session:search', query, options)
})

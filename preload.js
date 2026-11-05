const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('locateAPI', {
  // Config
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (updates) => ipcRenderer.invoke('config:set', updates),

  // Harnesses / sources
  addHarness: (dirPath, harness) => ipcRenderer.invoke('harness:add', dirPath, harness),
  removeHarness: (dirPath) => ipcRenderer.invoke('harness:remove', dirPath),
  listHarnesses: () => ipcRenderer.invoke('harness:list'),
  autodetectHarnesses: () => ipcRenderer.invoke('harness:autodetect'),
  openFolderDialog: () => ipcRenderer.invoke('dialog:openFolder'),

  // Source indexing
  indexSource: (sourceId) => ipcRenderer.invoke('source:index', sourceId),
  indexAllSources: (options) => ipcRenderer.invoke('source:indexAll', options),
  incrementalIndex: (options) => ipcRenderer.invoke('source:incrementalIndex', options),

  // Sessions
  listSessions: (sourcePath) => ipcRenderer.invoke('session:list', sourcePath),
  listAllSessions: () => ipcRenderer.invoke('session:listAll'),
  readSession: (sessionId) => ipcRenderer.invoke('session:read', sessionId),
  searchSessions: (query, options) => ipcRenderer.invoke('session:search', query, options),
  getContext: (sessionId, messageIndex, before, after) =>
    ipcRenderer.invoke('session:getContext', sessionId, messageIndex, before, after),
})

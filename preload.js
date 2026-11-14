const { contextBridge, ipcRenderer } = require('electron')

const synAPI = {
  // Config
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (updates) => ipcRenderer.invoke('config:set', updates),

  // Harnesses / sources
  addHarness: (dirPath, harness) => ipcRenderer.invoke('harness:add', dirPath, harness),
  removeHarness: (dirPath) => ipcRenderer.invoke('harness:remove', dirPath),
  listHarnesses: () => ipcRenderer.invoke('harness:list'),
  getHarnessSettings: () => ipcRenderer.invoke('harness:settings:get'),
  setHarnessSetting: (name, enabled) => ipcRenderer.invoke('harness:settings:set', name, enabled),
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
  deleteSession: (sessionId) => ipcRenderer.invoke('session:delete', sessionId),
  deleteSessionFile: (sessionId) => ipcRenderer.invoke('session:deleteFile', sessionId),
  searchSessions: (query, options) => ipcRenderer.invoke('session:search', query, options),
  getContext: (sessionId, messageIndex, before, after) =>
    ipcRenderer.invoke('session:getContext', sessionId, messageIndex, before, after),

  // Brainmaxxing (Memory Vault)
  brainIndex: () => ipcRenderer.invoke('brain:index'),
  brainRead: (relativePath) => ipcRenderer.invoke('brain:read', relativePath),
  brainWrite: (relativePath, content) => ipcRenderer.invoke('brain:write', relativePath, content),
  brainList: () => ipcRenderer.invoke('brain:list'),
  brainReflect: (sessionId) => ipcRenderer.invoke('brain:reflect', sessionId),
  brainMeditate: (sessionId) => ipcRenderer.invoke('brain:meditate', sessionId),
  brainRuminate: (sessionId) => ipcRenderer.invoke('brain:ruminate', sessionId),
  brainPlan: (sessionId) => ipcRenderer.invoke('brain:plan', sessionId),
  brainReview: (sessionId) => ipcRenderer.invoke('brain:review', sessionId),
}

// Expose as synAPI, with locateAPI alias for backward compatibility.
contextBridge.exposeInMainWorld('synAPI', synAPI)
contextBridge.exposeInMainWorld('locateAPI', synAPI)

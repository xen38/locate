# Terminal API

The renderer exposes `synAPI` (with `locateAPI` alias for backward compatibility) via Electron preload (`preload.js`). Methods map to IPC handlers in `main.js`:

- getConfig / setConfig
- addHarness / removeHarness / listHarnesses / getHarnessSettings / setHarnessSetting / autodetectHarnesses / openFolderDialog
- indexSource / indexAllSources / incrementalIndex
- listSessions / listAllSessions / readSession / deleteSession / deleteSessionFile
- searchSessions / getContext

Phase 2 adds terminal command execution (executeCommand, searchLocate, readBrain, writeBrain, listBrain).

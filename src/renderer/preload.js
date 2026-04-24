const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getDrives:   ()        => ipcRenderer.invoke('scan:drives'),
  startScan:   (drives)  => ipcRenderer.invoke('scan:start', drives),
  cancelScan:  ()        => ipcRenderer.send('scan:cancel'),
  deleteFiles: (paths)   => ipcRenderer.invoke('files:delete', paths),
  revealFile:  (p)       => ipcRenderer.invoke('shell:showItem', p),
  saveExport:     (payload) => ipcRenderer.invoke('export:save', payload),
  writeClipboard: (text)    => ipcRenderer.invoke('clipboard:write', text),
  onProgress:  (cb)      => ipcRenderer.on('scan:progress', (_e, batch) => cb(batch)),
  offProgress: ()        => ipcRenderer.removeAllListeners('scan:progress'),
});

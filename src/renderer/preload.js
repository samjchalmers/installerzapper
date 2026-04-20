const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getDrives:   ()        => ipcRenderer.invoke('scan:drives'),
  startScan:   (drives)  => ipcRenderer.invoke('scan:start', drives),
  cancelScan:  ()        => ipcRenderer.send('scan:cancel'),
  deleteFiles: (paths)   => ipcRenderer.invoke('files:delete', paths),
  revealFile:  (p)       => ipcRenderer.invoke('shell:showItem', p),
  onProgress:  (cb)      => ipcRenderer.on('scan:progress', (_e, batch) => cb(batch)),
  offProgress: ()        => ipcRenderer.removeAllListeners('scan:progress'),
});

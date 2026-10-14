const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('usage', {
  summary: (options) => ipcRenderer.invoke('usage:summary', options),
})

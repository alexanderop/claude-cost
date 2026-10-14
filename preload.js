const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('usage', {
  summary: () => ipcRenderer.invoke('usage:summary'),
})

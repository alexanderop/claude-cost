const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('node:path')
const { summarize, fetchPrices } = require('./usage.js')

let prices = null

ipcMain.handle('usage:summary', async () => {
  prices ??= await fetchPrices()
  return summarize({ prices })
})

app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 460,
    height: 680,
    title: 'Claude Cost',
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  })
  win.loadFile('index.html')
})

app.on('window-all-closed', () => app.quit())

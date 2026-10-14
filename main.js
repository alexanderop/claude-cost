const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('node:path')
const { scan, aggregate, fetchPrices } = require('./usage.js')

let prices = null
// Scanning takes seconds; re-pricing scanned records takes well under one.
let sources = null

ipcMain.handle('usage:summary', async (_event, { profile = 'anthropic', rescan = false } = {}) => {
  prices ??= await fetchPrices()
  if (!sources || rescan) sources = await scan()
  return aggregate(sources, prices, profile)
})

app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 1100,
    height: 900,
    backgroundColor: '#0f0f10',
    title: 'Agent Cost',
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  })
  win.loadFile('index.html')
})

app.on('window-all-closed', () => app.quit())

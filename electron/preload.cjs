const { contextBridge } = require('electron')

// Minimal, safe bridge. Expand only if the UI needs native capabilities later.
contextBridge.exposeInMainWorld('dtf', {
  platform: process.platform,
})


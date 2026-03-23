const path = require('path')
const { app, BrowserWindow, shell } = require('electron')

const isDev = !!process.env.VITE_DEV_SERVER_URL

function createMainWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 720,
    show: false,
    backgroundColor: '#0f1513',
    autoHideMenuBar: true,
    title: 'Digital Twin Forestale',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  })

  // Professional feel: no default application menu.
  win.removeMenu()
  win.setMenuBarVisibility(false)

  win.once('ready-to-show', () => win.show())

  if (isDev) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL)
    // win.webContents.openDevTools({ mode: 'detach' })
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }

  // Open external links in the system browser (avoid navigating away from the app).
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  return win
}

app.setAppUserModelId('com.forestcompany.digitaltwinforest')

app.whenReady().then(() => {
  createMainWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

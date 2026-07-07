const { app, BrowserWindow, shell } = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

let serverHandle;
let mainWindow;

async function createWindow() {
  const dataDir = app.getPath("userData");
  process.env.CLAUDIO_DATA_DIR = dataDir;
  process.env.CLAUDIO_API_PORT = process.env.CLAUDIO_API_PORT || "4217";

  const serverModule = await import(
    pathToFileURL(path.join(__dirname, "../server/index.js")).href
  );
  serverHandle = await serverModule.startServer({
    dataDir,
    port: Number(process.env.CLAUDIO_API_PORT)
  });

  mainWindow = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 920,
    minHeight: 680,
    backgroundColor: "#050506",
    title: "Claudio",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  const devUrl = process.env.CLAUDIO_WEB_URL;
  if (devUrl) {
    await mainWindow.loadURL(devUrl);
  } else {
    await mainWindow.loadURL(
      pathToFileURL(path.join(__dirname, "../../dist/index.html")).href
    );
  }
}

app.whenReady().then(createWindow);

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on("before-quit", () => {
  if (serverHandle) serverHandle.close();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

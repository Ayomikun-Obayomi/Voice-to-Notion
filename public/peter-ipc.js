// Connects the app window to Peter's planning + Notion code, and handles peter:// links
// (used when Notion sign-in finishes in the browser).
//
// Usage in electron-main.js:
//   const peterIpc = require('./peter-ipc');
//   peterIpc.registerProtocol();               // at the top, before app is ready
//   app.whenReady().then(() => { createWindow(); peterIpc.init(() => mainWindow); });
const { app, ipcMain, shell } = require('electron');
const path = require('path');
const notion = require('./peter-notion');
const sessions = require('./peter-sessions');
const speech = require('./peter-speech');
const { WORKER_URL } = require('./peter-constants');

let getWindow = () => null;
let pendingUrl = null;

function friendlyError(err) {
  const msg = err?.message || String(err);
  if (msg === 'NOTION_NOT_CONNECTED') return { code: 'NOTION_NOT_CONNECTED', message: 'Connect Notion first.' };
  if (msg === 'NO_PETER_PAGE') {
    return {
      code: 'NO_PETER_PAGE',
      message: "Peter can't find its page in Notion. Reconnect Notion and allow access to the Peter page.",
    };
  }
  return { code: 'ERROR', message: msg };
}

// Wraps every handler so errors reach the window as { ok:false, error } instead of crashing.
function handle(channel, fn) {
  ipcMain.handle(channel, async (_event, ...args) => {
    try {
      return { ok: true, data: await fn(...args) };
    } catch (err) {
      console.error(`[peter] ${channel} failed:`, err);
      return { ok: false, error: friendlyError(err) };
    }
  });
}

function handleDeepLink(url) {
  if (!url || !url.startsWith('peter://')) return;
  const win = getWindow();
  if (!win) {
    pendingUrl = url;
    return;
  }
  const parsed = new URL(url);
  if (parsed.host === 'notion-connected') {
    notion.saveConnection({
      token: parsed.searchParams.get('token'),
      template: parsed.searchParams.get('template'),
      workspace: parsed.searchParams.get('workspace'),
    });
    win.webContents.send('peter:notion-connected', { workspace: parsed.searchParams.get('workspace') });
  } else if (parsed.host === 'notion-error') {
    win.webContents.send('peter:notion-error', { reason: parsed.searchParams.get('reason') });
  }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

// Call once at startup, before app 'ready'.
function registerProtocol() {
  if (process.defaultApp && process.argv.length >= 2) {
    // Dev mode (npm start): register with the path to this project.
    app.setAsDefaultProtocolClient('peter', process.execPath, [path.resolve(process.argv[1])]);
  } else {
    app.setAsDefaultProtocolClient('peter');
  }
  app.on('open-url', (event, url) => {
    event.preventDefault();
    handleDeepLink(url);
  });
}

function init(windowGetter) {
  getWindow = windowGetter;

  handle('peter:notion-status', async () => ({ connected: notion.isConnected() }));
  handle('peter:notion-connect', async () => {
    await shell.openExternal(`${WORKER_URL}/notion/login`);
    return true;
  });
  handle('peter:notion-disconnect', async () => {
    notion.disconnect();
    return true;
  });

  handle('peter:session-start', (mode) => sessions.start(mode));
  handle('peter:session-plan', (context, transcript) => sessions.plan(context, transcript));
  handle('peter:session-save', (context, reviewed) => sessions.save(context, reviewed));

  handle('peter:today-tasks', () => sessions.todayTasks());
  handle('peter:set-done', (pageId, done) => notion.setDone(pageId, done));

  handle('peter:speech-start', async () => {
    speech.start((event) => getWindow()?.webContents.send('peter:speech', event));
    return true;
  });
  handle('peter:speech-stop', async () => {
    speech.stop();
    return true;
  });
  app.on('before-quit', () => speech.stop());

  if (pendingUrl) {
    const url = pendingUrl;
    pendingUrl = null;
    handleDeepLink(url);
  }
}

module.exports = { registerProtocol, init, handleDeepLink };

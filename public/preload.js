// Gives the React app a safe `window.peter` API. No Node access leaks into the page.
const { contextBridge, ipcRenderer } = require('electron');

const call = (channel, ...args) => ipcRenderer.invoke(channel, ...args);

function on(channel, callback) {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('peter', {
  // Notion connection
  notionStatus: () => call('peter:notion-status'),
  connectNotion: () => call('peter:notion-connect'),
  disconnectNotion: () => call('peter:notion-disconnect'),
  onNotionConnected: (cb) => on('peter:notion-connected', cb),
  onNotionError: (cb) => on('peter:notion-error', cb),

  // Day / Week sessions
  startSession: (mode) => call('peter:session-start', mode),
  planSession: (context, transcript) => call('peter:session-plan', context, transcript),
  saveSession: (context, reviewed) => call('peter:session-save', context, reviewed),

  // Widget
  todayTasks: () => call('peter:today-tasks'),
  setDone: (pageId, done) => call('peter:set-done', pageId, done),

  // Speech (Apple's recognizer via the peter-speech helper)
  startSpeech: () => call('peter:speech-start'),
  stopSpeech: () => call('peter:speech-stop'),
  onSpeech: (cb) => on('peter:speech', cb),
});

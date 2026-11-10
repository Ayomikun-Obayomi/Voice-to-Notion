// Runs the peter-speech helper (native/peter-speech, Apple's speech recognizer) and forwards what
// it hears to the app window as 'peter:speech' events. Electron can't use the browser's speech API
// (it needs Google's servers), so this replaces it.
const { app } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

let child = null;

function helperPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'peter-speech')
    : path.join(__dirname, '../native/bin/peter-speech');
}

function start(send) {
  if (child) return;
  const bin = helperPath();
  if (!fs.existsSync(bin)) {
    send({ type: 'error', code: 'helper-missing', message: 'Run "npm run build:speech" to build the speech helper.' });
    return;
  }

  const proc = spawn(bin, ['en-US'], { stdio: ['pipe', 'pipe', 'inherit'] });
  child = proc;
  let buffer = '';
  let sawError = false;

  proc.stdout.on('data', (chunk) => {
    if (child !== proc) return;
    buffer += chunk.toString();
    let newline;
    while ((newline = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      try {
        const event = JSON.parse(line);
        if (event.type === 'error') sawError = true;
        send(event);
      } catch {
        console.warn('[peter] speech helper said:', line);
      }
    }
  });

  proc.on('error', (err) => {
    sawError = true;
    send({ type: 'error', code: 'helper-failed', message: err.message });
  });

  proc.on('exit', (code, signal) => {
    // Ignore helpers we stopped on purpose.
    if (child !== proc) return;
    child = null;
    if (!sawError && !signal && code !== 0) {
      send({ type: 'error', code: 'helper-failed', message: `Speech helper stopped (exit ${code}).` });
    }
    send({ type: 'end' });
  });
}

function stop() {
  const proc = child;
  child = null;
  if (!proc) return;
  proc.stdin.end();
  setTimeout(() => proc.kill(), 1000);
}

module.exports = { start, stop };

// Runs the peter-speech helper (native/peter-speech, Apple's speech recognizer) and forwards what
// it hears to the app window as 'peter:speech' events. Electron can't use the browser's speech API
// (it needs Google's servers), so this replaces it.
const { app } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// The macOS speech service sometimes drops its connection (error 1107). If the helper gives up
// on it, restart it quietly a few times before telling the user.
const RESTARTABLE = ['recognizer-failed', 'helper-failed'];
const MAX_RESTARTS_PER_MINUTE = 3;

let child = null;
let wanted = false;
let restarts = [];

function helperPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'peter-speech')
    : path.join(__dirname, '../native/bin/peter-speech');
}

function canRestart() {
  const now = Date.now();
  restarts = restarts.filter((t) => now - t < 60000);
  if (restarts.length >= MAX_RESTARTS_PER_MINUTE) return false;
  restarts.push(now);
  return true;
}

function start(send) {
  if (child) return;
  wanted = true;
  const bin = helperPath();
  if (!fs.existsSync(bin)) {
    send({ type: 'error', code: 'helper-missing', message: 'Run "npm run build:speech" to build the speech helper.' });
    return;
  }

  const proc = spawn(bin, ['en-US'], { stdio: ['pipe', 'pipe', 'inherit'] });
  child = proc;
  let buffer = '';
  let lastError = null;

  const giveUpOrRestart = () => {
    if (wanted && RESTARTABLE.includes(lastError.code) && canRestart()) {
      console.warn('[peter] restarting speech helper after:', lastError.message);
      setTimeout(() => {
        if (wanted && !child) start(send);
      }, 2000);
      return;
    }
    send(lastError);
    send({ type: 'end' });
  };

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
        // Errors are reported (or retried) when the helper exits.
        if (event.type === 'error') lastError = event;
        else send(event);
      } catch {
        console.warn('[peter] speech helper said:', line);
      }
    }
  });

  proc.on('error', (err) => {
    lastError = { type: 'error', code: 'helper-failed', message: err.message };
    // If it never started there's no 'exit' event to finish up.
    if (!proc.pid && child === proc) {
      child = null;
      giveUpOrRestart();
    }
  });

  proc.on('exit', (code, signal) => {
    // Ignore helpers we stopped on purpose.
    if (child !== proc) return;
    child = null;
    if (!lastError && !signal && code !== 0) {
      lastError = { type: 'error', code: 'helper-failed', message: `Speech helper stopped (exit ${code}).` };
    }
    if (lastError) giveUpOrRestart();
    else send({ type: 'end' });
  });
}

function stop() {
  wanted = false;
  const proc = child;
  child = null;
  if (!proc) return;
  proc.stdin.end();
  setTimeout(() => proc.kill(), 1000);
}

module.exports = { start, stop };

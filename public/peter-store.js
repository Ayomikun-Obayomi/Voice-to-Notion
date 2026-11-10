// Small local store for Peter's settings. The Notion token is encrypted with the macOS Keychain
// via Electron's safeStorage, so it never sits on disk as plain text.
const { app, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');

const file = () => path.join(app.getPath('userData'), 'peter-store.json');

function readAll() {
  try {
    return JSON.parse(fs.readFileSync(file(), 'utf8'));
  } catch {
    return {};
  }
}

function writeAll(data) {
  fs.writeFileSync(file(), JSON.stringify(data, null, 2));
}

function get(key) {
  return readAll()[key];
}

function set(key, value) {
  const data = readAll();
  if (value === undefined || value === null) delete data[key];
  else data[key] = value;
  writeAll(data);
}

function setSecret(key, value) {
  if (!value) return set(key, null);
  const encrypted = safeStorage.isEncryptionAvailable()
    ? 'enc:' + safeStorage.encryptString(value).toString('base64')
    : 'raw:' + value;
  set(key, encrypted);
}

function getSecret(key) {
  const stored = get(key);
  if (!stored) return null;
  if (stored.startsWith('enc:')) {
    return safeStorage.decryptString(Buffer.from(stored.slice(4), 'base64'));
  }
  return stored.slice(4);
}

module.exports = { get, set, getSecret, setSecret };

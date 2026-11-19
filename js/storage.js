/**
 * localStorage wrapper that never throws.
 * If storage is missing, throws, or getItem does not persist, an in-memory
 * fallback is used for the rest of the session.
 */
const memory = new Map();
let persistent = true;
const PROBE_KEY = "e621-browser:probe";

function markUnavailable() {
  persistent = false;
}

function probe() {
  try {
    const token = String(Date.now());
    localStorage.setItem(PROBE_KEY, token);
    const ok = localStorage.getItem(PROBE_KEY) === token;
    localStorage.removeItem(PROBE_KEY);
    if (!ok) markUnavailable();
  } catch {
    markUnavailable();
  }
}

probe();

export function isStoragePersistent() {
  return persistent;
}

export function getItem(key) {
  if (memory.has(key)) return memory.get(key);
  try {
    const value = localStorage.getItem(key);
    if (value == null) return null;
    memory.set(key, value);
    return value;
  } catch {
    markUnavailable();
    return null;
  }
}

export function setItem(key, value) {
  const text = String(value);
  memory.set(key, text);
  try {
    localStorage.setItem(key, text);
    if (localStorage.getItem(key) !== text) markUnavailable();
  } catch {
    markUnavailable();
  }
}

export function removeItem(key) {
  memory.delete(key);
  try {
    localStorage.removeItem(key);
  } catch {
    markUnavailable();
  }
}

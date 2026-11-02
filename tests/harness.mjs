// Simule les services Apps Script et charge le vrai code du backend.
import vm from 'node:vm';
import { createHash, randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';

export const CLIENT_ID = 'test-client.apps.googleusercontent.com';
const now = () => Math.floor(Date.now() / 1000);

export function claimsFor(email, extra = {}) {
  return { aud: CLIENT_ID, iss: 'https://accounts.google.com', sub: 'sub-' + email, email, email_verified: 'true', exp: String(now() + 3600), name: email.split('@')[0], ...extra };
}

export function createBackend({ props = {} } = {}) {
  const store = { ORBIA_GOOGLE_CLIENT_ID: CLIENT_ID, ORBIA_BOOTSTRAP_ADMIN: 'admin@example.test', ...props };
  const cacheStore = new Map();
  const tokens = new Map();
  const state = { tokenCalls: 0, lockFree: true, tokeninfoStatus: null, logs: [] };
  const properties = {
    getProperty: (k) => (k in store ? store[k] : null),
    setProperty: (k, v) => { store[k] = String(v); },
    setProperties: (o) => { for (const k in o) store[k] = String(o[k]); },
    getProperties: () => ({ ...store })
  };
  const sandbox = {
    console: { log: (m) => state.logs.push(m), error: (m) => state.logs.push(m) },
    PropertiesService: { getScriptProperties: () => properties },
    CacheService: { getScriptCache: () => ({ get: (k) => cacheStore.get(k) ?? null, put: (k, v) => cacheStore.set(k, v) }) },
    LockService: { getScriptLock: () => ({ tryLock: () => state.lockFree, releaseLock() {} }) },
    Utilities: {
      getUuid: randomUUID,
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      computeDigest: (_, v) => [...createHash('sha256').update(v).digest()],
      base64EncodeWebSafe: (b) => Buffer.from(b).toString('base64url')
    },
    UrlFetchApp: {
      fetch(url) {
        state.tokenCalls++;
        const token = decodeURIComponent(url.split('id_token=')[1]);
        const claims = tokens.get(token);
        const code = state.tokeninfoStatus ?? (claims ? 200 : 400);
        return { getResponseCode: () => code, getContentText: () => JSON.stringify(claims ?? { error: 'invalid_token' }) };
      }
    },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: (text) => ({ text, setMimeType() { return this; } })
    }
  };
  const ctx = vm.createContext(sandbox);
  const dir = new URL('../backend/', import.meta.url);
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.gs')).sort()) {
    vm.runInContext(readFileSync(new URL(f, dir), 'utf8'), ctx, { filename: f });
  }
  vm.runInContext('const __n = Date.now; Date.now = () => __n() + (globalThis.__skewMs || 0);', ctx);
  let seq = 0;
  const issue = (claims) => { const t = `test-token-${++seq}-`.padEnd(40, 'x'); tokens.set(t, claims); return t; };
  const post = (body) => JSON.parse(sandbox.doPost({ postData: { contents: typeof body === 'string' ? body : JSON.stringify(body) } }).text);
  const call = (email, action, payload) => post({ idToken: issue(claimsFor(email)), action, payload });
  return { store, state, issue, post, call, sandbox, tokens };
}

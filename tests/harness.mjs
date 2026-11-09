// Simule les services Apps Script et charge le vrai code du backend.
import vm from 'node:vm';
import { createHash, randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';

export const CLIENT_ID = 'test-client.apps.googleusercontent.com';
export const SERVER = 'https://script.google.com/macros/s/AKfycbTESTserverIdentifier0123/exec';
export const nonceFor = (url) => createHash('sha256').update(url).digest('hex');
const now = () => Math.floor(Date.now() / 1000);

export function claimsFor(email, extra = {}) {
  return { aud: CLIENT_ID, iss: 'https://accounts.google.com', sub: 'sub-' + email, email, email_verified: 'true', exp: String(now() + 3600), nonce: nonceFor(SERVER), name: email.split('@')[0], ...extra };
}

export function createBackend({ props = {} } = {}) {
  const store = { ORBIA_GOOGLE_CLIENT_ID: CLIENT_ID, ORBIA_BOOTSTRAP_ADMIN: 'admin@example.test', ORBIA_PUBLIC_URL: SERVER, ...props };
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
      computeDigest: (_, v) => [...createHash('sha256').update(typeof v === 'string' ? v : Buffer.from(v)).digest()],
      base64Decode: (t) => [...Buffer.from(t, 'base64')],
      base64Encode: (b) => Buffer.from(b).toString('base64'),
      newBlob: (bytes, mime, name) => ({ bytes, mime, name }),
      base64EncodeWebSafe: (b) => Buffer.from(b).toString('base64url'),
      formatDate: (d) => d.toISOString().slice(0, 7)
    },
    UrlFetchApp: {
      fetch(url, options) {
        if (url.startsWith('https://api.anthropic.com/')) {
          state.aiCalls = (state.aiCalls || 0) + 1;
          state.aiRequest = { url, options };
          return { getResponseCode: () => state.aiStatus ?? 200, getContentText: () => JSON.stringify({ content: [{ type: 'text', text: state.aiText }] }) };
        }
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
  // Drive et Sheets en mémoire
  let ids = 0;
  const newId = (k) => `${k}-${++ids}`;
  const drive = { folders: new Map(), files: new Map(), books: new Map(), triggers: [], failNext: null };
  const maybeFail = (op) => { if (drive.failNext === op) { drive.failNext = null; throw new Error('Panne simulée: ' + op); } };
  const iterator = (list) => { let i = 0; return { hasNext: () => i < list.length, next: () => list[i++] }; };
  const makeFile = (name, parent, mime, bookId) => {
    const file = { id: bookId || newId('file'), name, parent, mime, access: 'PRIVATE',
      setTrashed(v) { this.trashed = v; },
      getBlob() { return { getDataAsString: () => this.content, getBytes: () => this.bytes, getContentType: () => this.mime }; },
      getId() { return this.id; }, getName() { return this.name; }, getUrl() { return 'https://drive.test/' + this.id; }, getSharingAccess() { return this.access; },
      moveTo(folder) { this.parent = folder.id; },
      makeCopy(n, folder) { const nb = newId('book'); drive.books.set(nb, makeBook(nb, structuredClone(drive.books.get(this.id).tabs))); const c = makeFile(n, folder.id, 'sheet', nb); return c; } };
    drive.files.set(file.id, file);
    return file;
  };
  const makeFolder = (name, parent) => {
    const folder = { id: newId('folder'), name, parent, access: 'PRIVATE',
      setTrashed(v) { this.trashed = v; },
      getId() { return this.id; }, getUrl() { return 'https://drive.test/' + this.id; }, getSharingAccess() { return this.access; },
      createFolder(n) { maybeFail('createFolder:' + n); return makeFolder(n, this.id); },
      getFoldersByName(n) { return iterator([...drive.folders.values()].filter((f) => f.parent === this.id && f.name === n)); },
      createFile(n, content, mime) { if (typeof n === 'object') { const f = makeFile(n.name, this.id, n.mime); f.bytes = n.bytes; return f; } const f = makeFile(n, this.id, mime); f.content = content; return f; },
      getFiles() { return iterator([...drive.files.values()].filter((f) => f.parent === this.id)); },
      getFilesByType(type) { return iterator([...drive.files.values()].filter((f) => f.parent === this.id && f.mime === type)); } };
    drive.folders.set(folder.id, folder);
    return folder;
  };
  const makeSheet = (tabs, name) => ({
    get grid() { return tabs[name]; },
    getName: () => name,
    setName(n) { tabs[n] = tabs[name]; delete tabs[name]; name = n; },
    getLastColumn() { return Math.max(0, ...this.grid.map((r) => r.length)); },
    getLastRow() { return this.grid.length; },
    setFrozenRows() {},
    appendRow(row) { this.grid.push(row); },
    getRange(r, c, nr, nc) { const g = () => this.grid; return {
      getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => g()[r - 1 + i]?.[c - 1 + j] ?? '')),
      setValues: (vals) => vals.forEach((row, i) => row.forEach((v, j) => {
        // Comme Sheets : l'apostrophe force le texte, sinon formule ou date sont interprétées.
        let cell = v;
        if (typeof v === 'string') {
          if (v.startsWith("'")) cell = v.slice(1);
          else if (v.startsWith('=')) cell = { formula: v };
          else if (/^\d{4}-\d{2}-\d{2}$/.test(v)) cell = new Date(v);
        }
        (g()[r - 1 + i] ??= [])[c - 1 + j] = cell;
      })),
      clearContent: () => { g().length = r - 1; } }; }
  });
  const makeBook = (id, tabs) => ({ id, tabs,
    getId: () => id,
    getSheets: () => Object.keys(tabs).map((n) => makeSheet(tabs, n)),
    getSheetByName: (n) => (tabs[n] ? makeSheet(tabs, n) : null),
    insertSheet(n) { maybeFail('insertSheet:' + n); tabs[n] = []; return makeSheet(tabs, n); } });
  sandbox.MimeType = { GOOGLE_SHEETS: 'sheet' };
  sandbox.DriveApp = {
    Access: { PRIVATE: 'PRIVATE', ANYONE: 'ANYONE' },
    createFolder: (n) => makeFolder(n, 'drive-root'),
    getRootFolder: () => ({}),
    getFolderById: (id) => drive.folders.get(id),
    getFileById: (id) => drive.files.get(id)
  };
  sandbox.SpreadsheetApp = {
    create(name) { const id = newId('book'); const b = makeBook(id, { 'Feuille 1': [] }); drive.books.set(id, b); makeFile(name, 'drive-root', 'sheet', id); return b; },
    openById: (id) => drive.books.get(id),
    getActiveSpreadsheet: () => null
  };
  const builder = (handler) => { const chain = { timeBased: () => chain, everyDays: () => chain, everyHours: () => chain, onMonthDay: () => chain, atHour: () => chain, create() { drive.triggers.push(handler); } }; return chain; };
  sandbox.Session = { getEffectiveUser: () => ({ getEmail: () => state.owner || '' }) };
  sandbox.ScriptApp = {
    getService: () => ({ getUrl: () => state.serviceUrl || '' }),
    getProjectTriggers: () => drive.triggers.map((h) => ({ getHandlerFunction: () => h })),
    newTrigger: builder
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
  return { store, state, issue, post, call, sandbox, tokens, drive };
}

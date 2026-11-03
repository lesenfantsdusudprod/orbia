/**
 * Import bancaire. Aucun format n'est supposé : l'administrateur confirme le rôle
 * de chaque colonne. Toutes les lignes sont validées avant la première écriture,
 * et les montants sont calculés en centimes entiers, sans nombre à virgule.
 */
const BANK_FIELDS = Object.freeze(['date', 'valueDate', 'label', 'amount', 'debit', 'credit', 'currency', 'account', 'sourceId', 'balance']);

function hexDigest_(text) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8)
    .map((byte) => ('0' + (byte & 255).toString(16)).slice(-2)).join('');
}

function detectDelimiter_(text) {
  const line = text.split(/\r?\n/, 1)[0];
  const counts = [';', ',', '\t'].map((d) => ({ d, n: line.split(d).length - 1 }));
  counts.sort((a, b) => b.n - a.n);
  if (!counts[0].n) throw ERR.validation('Ce fichier ne ressemble pas à un CSV : aucun séparateur de colonnes trouvé.');
  return counts[0].d;
}

/** Gère guillemets, retours à la ligne dans un champ, BOM et fins de ligne Windows. */
function parseCsv_(raw) {
  const text = String(raw).replace(/^﻿/, '');
  if (!text.trim()) throw ERR.validation('Ce fichier est vide.');
  const delimiter = detectDelimiter_(text);
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell === '') quoted = true;
    else if (c === delimiter) { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (quoted) throw ERR.validation('Ce fichier est mal formé : un guillemet n’est pas refermé.');
  if (cell || row.length) { row.push(cell.replace(/\r$/, '')); rows.push(row); }
  const filled = rows.filter((r) => r.some((c) => c.trim()));
  if (filled.length < 2) throw ERR.validation('Ce fichier ne contient aucune opération.');
  if (filled.length - 1 > LIMITS.MAX_CSV_ROWS) throw ERR.validation('Ce fichier dépasse ' + LIMITS.MAX_CSV_ROWS + ' lignes. Importez une période plus courte.');
  const headers = filled[0].map((h) => h.trim());
  if (new Set(headers).size !== headers.length || headers.some((h) => !h)) {
    throw ERR.validation('La première ligne doit contenir des titres de colonnes uniques.');
  }
  return { headers, rows: filled.slice(1) };
}

/** Renvoie des centimes entiers, ou null si le texte est ambigu ou invalide. */
function parseCents_(raw) {
  let text = String(raw).replace(/[\s  €]|EUR/g, '').replace(/[−–]/g, '-');
  if (/^\(.*\)$/.test(text)) text = '-' + text.slice(1, -1);
  const match = /^([+-]?)([\d.,']+)$/.test(text) ? text.match(/^([+-]?)([\d.,']+)$/) : null;
  if (!match) return null;
  const body = match[2].replace(/'/g, '');
  const lastSeparator = Math.max(body.lastIndexOf(','), body.lastIndexOf('.'));
  let whole = body;
  let decimals = '';
  if (lastSeparator >= 0) {
    decimals = body.slice(lastSeparator + 1);
    whole = body.slice(0, lastSeparator);
    if (decimals.length === 3 || decimals.length > 2) return null;
    if (/[.,]/.test(whole)) {
      const groups = whole.split(/[.,]/);
      if (groups.slice(1).some((g) => g.length !== 3)) return null;
      whole = groups.join('');
    }
  }
  if (!/^\d+$/.test(whole || '0') || !/^\d*$/.test(decimals)) return null;
  const cents = Number(whole || '0') * 100 + Number((decimals + '00').slice(0, 2));
  if (!Number.isSafeInteger(cents)) return null;
  return match[1] === '-' ? -cents : cents;
}

/** Accepte AAAA-MM-JJ et JJ/MM/AAAA, jamais le format américain. */
function parseIsoDate_(raw) {
  const text = String(raw).trim();
  let match = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/);
  let iso = match ? match[1] + '-' + match[2] + '-' + match[3] : null;
  if (!iso) {
    match = text.match(/^(\d{2})[\/.-](\d{2})[\/.-](\d{4})(?:[T ].*)?$/);
    if (match) iso = match[3] + '-' + match[2] + '-' + match[1];
  }
  if (!iso) return null;
  const parsed = new Date(iso + 'T00:00:00Z');
  return !isNaN(parsed) && parsed.toISOString().slice(0, 10) === iso ? iso : null;
}

function suggestMapping_(headers) {
  const plain = (h) => h.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const rules = {
    valueDate: /valeur|value|settled|settlement/,
    date: /date|emitted/,
    label: /libelle|label|contrepartie|counterparty|intitule|description/,
    amount: /montant|amount/,
    debit: /debit/,
    credit: /credit/,
    currency: /devise|currency/,
    account: /compte|account|iban/,
    sourceId: /transaction.?id|^id$|identifiant/,
    balance: /solde|balance/
  };
  const used = {};
  const mapping = {};
  Object.keys(rules).forEach((field) => {
    const found = headers.find((h) => !used[h] && rules[field].test(plain(h)));
    if (found) { mapping[field] = found; used[found] = true; }
  });
  return mapping;
}

function cleanMapping_(input, headers) {
  const data = asPlainObject_(input);
  const mapping = {};
  BANK_FIELDS.forEach((field) => {
    if (data[field] === undefined || data[field] === '' || data[field] === null) return;
    if (headers.indexOf(data[field]) < 0) throw ERR.validation('Colonne inconnue : ' + sanitizeLogText_(data[field]).slice(0, 60) + '.');
    mapping[field] = data[field];
  });
  if (!mapping.date || !mapping.label) throw ERR.validation('Indiquez au moins la date et le libellé.');
  if (!mapping.amount && !(mapping.debit && mapping.credit)) throw ERR.validation('Indiquez le montant, ou les colonnes débit et crédit.');
  return mapping;
}

function normalizeRow_(cells, index, mapping) {
  const get = (field) => (mapping[field] && index[mapping[field]] !== undefined ? String(cells[index[mapping[field]]] === undefined ? '' : cells[index[mapping[field]]]).trim() : '');
  const operationDate = parseIsoDate_(get('date'));
  if (!operationDate) return { error: 'date illisible « ' + get('date').slice(0, 30) + ' »' };
  const valueDate = mapping.valueDate && get('valueDate') ? parseIsoDate_(get('valueDate')) : '';
  if (valueDate === null) return { error: 'date de valeur illisible' };
  const rawLabel = get('label');
  if (!rawLabel) return { error: 'libellé vide' };

  let amountCents;
  if (mapping.amount) {
    amountCents = parseCents_(get('amount'));
  } else {
    const debit = get('debit') ? parseCents_(get('debit')) : 0;
    const credit = get('credit') ? parseCents_(get('credit')) : 0;
    amountCents = debit === null || credit === null || (get('debit') && get('credit')) ? null : credit - Math.abs(debit);
  }
  if (amountCents === null || amountCents === undefined) return { error: 'montant illisible' };

  const balanceCents = get('balance') ? parseCents_(get('balance')) : '';
  if (balanceCents === null) return { error: 'solde illisible' };
  const currency = (get('currency') || 'EUR').toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) return { error: 'devise illisible' };
  return { operationDate, valueDate, rawLabel, amountCents, currency, account: get('account'), sourceId: get('sourceId'), balanceCents };
}

/**
 * Sans identifiant bancaire, l'empreinte inclut le rang de la ligne parmi ses
 * identiques du fichier : deux vrais paiements égaux restent deux opérations,
 * et réimporter un export qui chevauche le précédent n'ajoute rien.
 */
function withStableIds_(rows) {
  const seen = {};
  return rows.map((row) => {
    if (row.sourceId) return Object.assign({ id: 'tx_' + hexDigest_('src|' + row.account + '|' + row.sourceId).slice(0, 32) }, row);
    const base = [row.operationDate, row.amountCents, row.rawLabel, row.currency, row.account].join('|');
    seen[base] = (seen[base] || 0) + 1;
    return Object.assign({ id: 'tx_' + hexDigest_(base + '|' + seen[base]).slice(0, 32) }, row);
  });
}

function analyzeCsv_(content, mappingInput) {
  if (typeof content !== 'string' || content.length > LIMITS.MAX_CSV_CHARS) throw ERR.validation('Ce fichier est trop volumineux.');
  const { headers, rows } = parseCsv_(content);
  const mapping = cleanMapping_(mappingInput, headers);
  const index = {};
  headers.forEach((h, i) => { index[h] = i; });
  const valid = [];
  const errors = [];
  let errorCount = 0;
  rows.forEach((cells, i) => {
    const line = i + 2;
    if (cells.length !== headers.length) {
      errorCount++;
      if (errors.length < LIMITS.CSV_ERRORS_LISTED) errors.push('Ligne ' + line + ' : ' + cells.length + ' colonnes au lieu de ' + headers.length + '.');
      return;
    }
    const row = normalizeRow_(cells, index, mapping);
    if (row.error) {
      errorCount++;
      if (errors.length < LIMITS.CSV_ERRORS_LISTED) errors.push('Ligne ' + line + ' : ' + row.error + '.');
    } else {
      valid.push(row);
    }
  });
  return { headers, mapping, rows: withStableIds_(valid), errors, errorCount, total: rows.length };
}

function bankSheet_(name) {
  const spreadsheet = SpreadsheetApp.openById(requireStorage_());
  ensureTab_(spreadsheet, name, SCHEMA[name]);
  return spreadsheet.getSheetByName(name);
}

function readTable_(sheet, columns) {
  const last = sheet.getLastRow();
  if (last < 2) return [];
  return sheet.getRange(2, 1, last - 1, columns.length).getValues().map((row) => {
    const item = {};
    columns.forEach((c, i) => { item[c] = row[i]; });
    return item;
  });
}

function missingMonths_(months) {
  const sorted = Object.keys(months).sort();
  if (sorted.length < 2) return [];
  const missing = [];
  let [year, month] = sorted[0].split('-').map(Number);
  const end = sorted[sorted.length - 1];
  for (;;) {
    const key = year + '-' + ('0' + month).slice(-2);
    if (key > end) return missing;
    if (!months[key]) missing.push(key);
    month++;
    if (month > 12) { month = 1; year++; }
  }
}

function saveMapping_(headers, mapping) {
  const props = storageProps_();
  const all = JSON.parse(props.getProperty(PROP.BANK_MAPPINGS) || '{}');
  all[hexDigest_(headers.join('|'))] = mapping;
  props.setProperty(PROP.BANK_MAPPINGS, JSON.stringify(all));
}

function savedMapping_(headers) {
  const all = JSON.parse(storageProps_().getProperty(PROP.BANK_MAPPINGS) || '{}');
  return all[hexDigest_(headers.join('|'))] || null;
}

const BankService = {
  /** Sans `mapping` : colonnes et suggestion. Avec : rapport complet. N'écrit rien. */
  preview(data) {
    requireStorage_();
    if (typeof data.content !== 'string' || data.content.length > LIMITS.MAX_CSV_CHARS) throw ERR.validation('Ce fichier est trop volumineux.');
    const { headers, rows } = parseCsv_(data.content);
    const base = {
      headers,
      sample: rows.slice(0, 5),
      rowCount: rows.length,
      suggested: savedMapping_(headers) || suggestMapping_(headers),
      alreadyImported: this.findImport_(hexDigest_(data.content)) !== null
    };
    if (!data.mapping) return base;

    const analysis = analyzeCsv_(data.content, data.mapping);
    const existing = this.existingIds_();
    const dates = analysis.rows.map((r) => r.operationDate).sort();
    return Object.assign(base, {
      report: {
        total: analysis.total,
        valid: analysis.rows.length,
        errorCount: analysis.errorCount,
        errors: analysis.errors,
        newCount: analysis.rows.filter((r) => !existing[r.id]).length,
        firstDate: dates[0] || '',
        lastDate: dates[dates.length - 1] || '',
        preview: analysis.rows.slice(0, 5).map((r) => ({ date: r.operationDate, label: r.rawLabel, amountCents: r.amountCents, currency: r.currency }))
      }
    });
  },

  existingIds_() {
    const known = {};
    readTable_(bankSheet_('BankTransactions'), ['id']).forEach((r) => { known[r.id] = true; });
    return known;
  },

  findImport_(hash) {
    return readTable_(bankSheet_('BankImports'), SCHEMA.BankImports).find((r) => r.hash === hash && r.status === 'termine') || null;
  },

  /**
   * Tout ou rien à la validation. Si une panne coupe l'écriture, l'import reste
   * « en_cours » : le relancer complète ce qui manque grâce aux identifiants stables.
   */
  import_(data, actor) {
    requireStorage_();
    const fileName = cleanString_(data.fileName, 'Nom de fichier', 200) || 'import.csv';
    const analysis = analyzeCsv_(data.content, data.mapping);
    if (analysis.errorCount) {
      const err = ERR.validation('Import annulé, rien n’a été modifié : ' + analysis.errorCount + ' ligne(s) en erreur. ' + analysis.errors[0]);
      throw err;
    }
    const hash = hexDigest_(data.content);
    if (this.findImport_(hash)) {
      return { fileName, added: 0, skipped: analysis.rows.length, alreadyImported: true };
    }

    const importId = 'imp_' + hash.slice(0, 16);
    const imports = bankSheet_('BankImports');
    const writeImport = (status) => imports.getRange(imports.getLastRow() + 1, 1, 1, SCHEMA.BankImports.length)
      .setValues([[importId, fileName, hash, new Date().toISOString(), status, analysis.rows.length, actor].map(safeCell_)]);
    writeImport('en_cours');

    const existing = this.existingIds_();
    const fresh = analysis.rows.filter((r) => !existing[r.id]);
    if (fresh.length) {
      const sheet = bankSheet_('BankTransactions');
      const start = sheet.getLastRow() + 1;
      const values = fresh.map((r) => [r.id, r.sourceId, r.operationDate, r.valueDate, r.rawLabel, r.amountCents, r.currency, r.account, 'non_rapproche', importId, r.balanceCents].map(safeCell_));
      sheet.getRange(start, 1, values.length, SCHEMA.BankTransactions.length).setValues(values);
    }
    writeImport('termine');
    saveMapping_(analysis.headers, analysis.mapping);
    return { fileName, added: fresh.length, skipped: analysis.rows.length - fresh.length, alreadyImported: false };
  },

  transactions_() {
    return readTable_(bankSheet_('BankTransactions'), SCHEMA.BankTransactions);
  },

  list(data) {
    if (!storageProps_().getProperty(PROP.SPREADSHEET_ID)) return { ready: false, items: [], total: 0, imports: [] };
    const limit = Math.min(Math.max(Number(data.limit) || 50, 1), 200);
    const offset = Math.max(Number(data.offset) || 0, 0);
    const all = this.transactions_().sort((a, b) => (a.operationDate < b.operationDate ? 1 : a.operationDate > b.operationDate ? -1 : 0));
    const imports = readTable_(bankSheet_('BankImports'), SCHEMA.BankImports).filter((r) => r.status === 'termine').reverse().slice(0, 10)
      .map((r) => ({ fileName: r.fileName, importedAt: r.importedAt, rowCount: r.rowCount, importedBy: r.importedBy }));
    return {
      ready: true,
      total: all.length,
      items: all.slice(offset, offset + limit).map((t) => ({ id: t.id, date: t.operationDate, label: t.rawLabel, amountCents: t.amountCents, currency: t.currency, status: t.status })),
      imports
    };
  },

  /** Le solde vient du dernier relevé : il n'est jamais présenté comme du temps réel. */
  summary() {
    const empty = { ready: false, count: 0, balanceCents: null, balanceDate: '', lastImportAt: '', monthInCents: 0, monthOutCents: 0, unmatched: 0, missingMonths: [] };
    if (!storageProps_().getProperty(PROP.SPREADSHEET_ID)) return empty;
    const all = this.transactions_();
    const month = Utilities.formatDate(new Date(), 'Europe/Paris', 'yyyy-MM');
    const months = {};
    const out = Object.assign({}, empty, { ready: true, count: all.length });
    let latest = '';
    all.forEach((t) => {
      const key = String(t.operationDate).slice(0, 7);
      months[key] = true;
      if (key === month) {
        if (t.amountCents >= 0) out.monthInCents += t.amountCents; else out.monthOutCents += -t.amountCents;
      }
      if (t.status === 'non_rapproche') out.unmatched++;
      if (typeof t.balanceCents === 'number' && t.operationDate >= latest) {
        latest = t.operationDate;
        out.balanceCents = t.balanceCents;
        out.balanceDate = t.operationDate;
      }
    });
    out.missingMonths = missingMonths_(months);
    const imports = readTable_(bankSheet_('BankImports'), SCHEMA.BankImports);
    if (imports.length) out.lastImportAt = imports[imports.length - 1].importedAt;
    return out;
  },

  /** Importe les CSV déposés dans Imports_CSV dont les colonnes sont déjà connues. */
  scanFolder_() {
    requireStorage_();
    const ids = JSON.parse(storageProps_().getProperty(PROP.FOLDER_IDS) || '{}');
    const inbox = DriveApp.getFolderById(ids['01_Banque_Qonto/Imports_CSV']);
    const archive = DriveApp.getFolderById(ids['01_Banque_Qonto/Archives_imports']);
    const result = { imported: 0, added: 0, waiting: [] };
    const files = inbox.getFiles();
    while (files.hasNext()) {
      const file = files.next();
      if (!/\.csv$/i.test(file.getName())) continue;
      try {
        const content = file.getBlob().getDataAsString('UTF-8');
        const mapping = savedMapping_(parseCsv_(content).headers);
        if (!mapping) throw ERR.validation('Colonnes inconnues : importez ce fichier une fois à la main.');
        const report = withLock_(() => this.import_({ fileName: file.getName(), content, mapping }, 'dossier Drive'), LIMITS.STORAGE_LOCK_WAIT_MS);
        file.moveTo(archive);
        result.imported++;
        result.added += report.added;
        LogRepository.append({ level: 'audit', code: 'BANK_IMPORT', action: 'dossier Drive', message: file.getName() + ' : ' + report.added + ' opération(s) ajoutée(s).' });
      } catch (err) {
        result.waiting.push(file.getName());
        const key = 'csv_' + file.getId();
        const cache = CacheService.getScriptCache();
        if (!cache.get(key)) {
          cache.put(key, '1', LIMITS.CSV_ALERT_WINDOW_SECONDS);
          LogRepository.append({ level: 'warn', code: 'BANK_IMPORT_WAITING', action: 'dossier Drive', message: file.getName() + ' : ' + (err && err.message) });
        }
      }
    }
    return result;
  }
};

function orbiaScanBankFolder() {
  try {
    if (storageProps_().getProperty(PROP.SPREADSHEET_ID)) BankService.scanFolder_();
  } catch (err) {
    LogRepository.append({ level: 'error', code: 'BANK_SCAN_FAILED', action: 'planifié', message: 'Lecture du dossier impossible : ' + (err && err.message) });
  }
}

/**
 * Espace Drive et classeur. Toutes les étapes sont rejouables : après une panne,
 * relancer reprend là où l'on s'était arrêté, sans recréer ni écraser.
 * Orbia n'ouvre que ce qu'il a créé, via les identifiants gardés côté serveur.
 */
function storageProps_() {
  return PropertiesService.getScriptProperties();
}

function requireStorage_() {
  const id = storageProps_().getProperty(PROP.SPREADSHEET_ID);
  if (!id) throw new OrbiaError('STORAGE_MISSING', 'L’espace Orbia n’est pas encore créé.');
  return id;
}

/** Ajoute ce qui manque sans jamais toucher aux lignes existantes. */
function ensureTab_(spreadsheet, name, columns) {
  let sheet = spreadsheet.getSheetByName(name);
  if (!sheet) sheet = spreadsheet.insertSheet(name);
  const width = sheet.getLastColumn();
  const existing = width ? sheet.getRange(1, 1, 1, width).getValues()[0].map(String) : [];
  existing.forEach((title, index) => {
    if (title !== columns[index]) {
      throw new OrbiaError('SCHEMA_CONFLICT', 'L’onglet ' + name + ' a été modifié à la main : colonne « ' + title + ' » inattendue.');
    }
  });
  if (existing.length < columns.length) {
    const missing = columns.slice(existing.length);
    sheet.getRange(1, existing.length + 1, 1, missing.length).setValues([missing]);
    sheet.setFrozenRows(1);
  }
}

/**
 * Force le texte dans Sheets : sans apostrophe, « =... » deviendrait une formule
 * et « 2026-01-31 » une date. Toute donnée venue de l'extérieur passe par ici.
 */
function safeCell_(value) {
  return typeof value === 'string' && value !== '' ? "'" + value : value;
}

function replaceRows_(sheet, rows, width) {
  const last = sheet.getLastRow();
  if (last > 1) sheet.getRange(2, 1, last - 1, width).clearContent();
  if (rows.length) sheet.getRange(2, 1, rows.length, width).setValues(rows.map((row) => row.map(safeCell_)));
}

const StorageService = {
  initialize_() {
    const props = storageProps_();
    let rootId = props.getProperty(PROP.ROOT_FOLDER_ID);
    if (!rootId) {
      rootId = DriveApp.createFolder(ROOT_FOLDER_NAME).getId();
      props.setProperty(PROP.ROOT_FOLDER_ID, rootId);
    }
    const root = DriveApp.getFolderById(rootId);
    this.ensureFolders_(root);

    let spreadsheetId = props.getProperty(PROP.SPREADSHEET_ID);
    if (!spreadsheetId) {
      const created = SpreadsheetApp.create(SPREADSHEET_NAME);
      spreadsheetId = created.getId();
      created.getSheets()[0].setName('Settings');
      props.setProperty(PROP.SPREADSHEET_ID, spreadsheetId);
      DriveApp.getFileById(spreadsheetId).moveTo(root);
    }
    const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
    Object.keys(SCHEMA).forEach((name) => ensureTab_(spreadsheet, name, SCHEMA[name]));
    this.ensureTriggers_();
    return this.status();
  },

  ensureFolders_(root) {
    const props = storageProps_();
    const ids = JSON.parse(props.getProperty(PROP.FOLDER_IDS) || '{}');
    FOLDER_TREE.forEach((path) => {
      if (ids[path]) return;
      const parts = path.split('/');
      const name = parts.pop();
      const parent = parts.length ? DriveApp.getFolderById(ids[parts.join('/')]) : root;
      const found = parent.getFoldersByName(name);
      ids[path] = (found.hasNext() ? found.next() : parent.createFolder(name)).getId();
      props.setProperty(PROP.FOLDER_IDS, JSON.stringify(ids));
    });
  },

  ensureTriggers_() {
    const handlers = ScriptApp.getProjectTriggers().map((t) => t.getHandlerFunction());
    if (handlers.indexOf('orbiaDailyBackup') < 0) {
      ScriptApp.newTrigger('orbiaDailyBackup').timeBased().everyDays(1).atHour(3).create();
    }
    if (handlers.indexOf('orbiaMonthlyRestoreTest') < 0) {
      ScriptApp.newTrigger('orbiaMonthlyRestoreTest').timeBased().onMonthDay(1).atHour(4).create();
    }
    if (handlers.indexOf('orbiaScanBankFolder') < 0) {
      ScriptApp.newTrigger('orbiaScanBankFolder').timeBased().everyHours(1).create();
    }
  },

  /** Copie lisible des réglages. La source reste côté serveur : voir docs/DEPLOIEMENT.md. */
  mirror_() {
    const spreadsheet = SpreadsheetApp.openById(requireStorage_());
    const users = UserRepository.all().map((u) => SCHEMA.Users.map((c) => (u[c] === undefined ? '' : u[c])));
    replaceRows_(spreadsheet.getSheetByName('Users'), users, SCHEMA.Users.length);
    const now = new Date().toISOString();
    const company = CompanyRepository.get();
    const settings = [['schemaVersion', SCHEMA_VERSION, now]].concat(Object.keys(company).map((k) => [k, company[k], now]));
    replaceRows_(spreadsheet.getSheetByName('Settings'), settings, SCHEMA.Settings.length);
  },

  status() {
    const props = storageProps_();
    const spreadsheetId = props.getProperty(PROP.SPREADSHEET_ID);
    const rootId = props.getProperty(PROP.ROOT_FOLDER_ID);
    if (!spreadsheetId || !rootId) return { ready: false, partial: Boolean(rootId) };

    const root = DriveApp.getFolderById(rootId);
    const file = DriveApp.getFileById(spreadsheetId);
    const handlers = ScriptApp.getProjectTriggers().map((t) => t.getHandlerFunction());
    return {
      ready: true,
      schemaVersion: SCHEMA_VERSION,
      folderUrl: root.getUrl(),
      spreadsheetUrl: file.getUrl(),
      isPrivate: root.getSharingAccess() === DriveApp.Access.PRIVATE && file.getSharingAccess() === DriveApp.Access.PRIVATE,
      automaticBackups: handlers.indexOf('orbiaDailyBackup') >= 0,
      monthlyRestoreTest: handlers.indexOf('orbiaMonthlyRestoreTest') >= 0,
      bankFolderScan: handlers.indexOf('orbiaScanBankFolder') >= 0,
      lastBackup: JSON.parse(props.getProperty(PROP.LAST_BACKUP) || 'null'),
      lastRestoreTest: JSON.parse(props.getProperty(PROP.LAST_RESTORE_TEST) || 'null'),
      backups: BackupService.list()
    };
  }
};

/** Le miroir ne doit jamais faire échouer l'action qui vient de réussir. */
function mirrorSafely_() {
  try {
    if (storageProps_().getProperty(PROP.SPREADSHEET_ID)) StorageService.mirror_();
  } catch (err) {
    console.error('Copie des réglages impossible : ' + sanitizeLogText_(err && err.message));
  }
}

function appendAuditRow_(entry) {
  try {
    const id = storageProps_().getProperty(PROP.SPREADSHEET_ID);
    if (!id) return;
    const sheet = SpreadsheetApp.openById(id).getSheetByName('AuditLog');
    // appendRow reste atomique ; un espace neutralise toute formule éventuelle.
    if (sheet) sheet.appendRow(SCHEMA.AuditLog.map((c) => String(entry[c] === undefined ? '' : entry[c]).replace(/^[=+\-@]/, ' $&')));
  } catch (err) {
    console.error('Journal d’audit indisponible');
  }
}

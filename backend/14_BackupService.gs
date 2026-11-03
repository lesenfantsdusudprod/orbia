/**
 * Sauvegardes : une copie du classeur et un export JSON des réglages serveur.
 * Une restauration ne détruit rien : Orbia bascule sur une copie de la sauvegarde
 * et l'ancien classeur reste dans Drive.
 */
function backupFolder_() {
  const ids = JSON.parse(storageProps_().getProperty(PROP.FOLDER_IDS) || '{}');
  if (!ids[BACKUP_FOLDER]) throw new OrbiaError('STORAGE_MISSING', 'L’espace Orbia n’est pas encore créé.');
  return DriveApp.getFolderById(ids[BACKUP_FOLDER]);
}

const BACKUP_PREFIX = 'Orbia_sauvegarde_';

const BackupService = {
  create_() {
    const source = DriveApp.getFileById(requireStorage_());
    const folder = backupFolder_();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const name = BACKUP_PREFIX + stamp;
    const copy = source.makeCopy(name, folder);
    folder.createFile(name + '.json', JSON.stringify({
      exportedAt: new Date().toISOString(),
      version: ORBIA_VERSION,
      schemaVersion: SCHEMA_VERSION,
      users: UserRepository.all(),
      company: CompanyRepository.get()
    }, null, 2), 'application/json');
    const info = { id: copy.getId(), name, at: new Date().toISOString() };
    storageProps_().setProperty(PROP.LAST_BACKUP, JSON.stringify(info));
    return info;
  },

  /** Du plus récent au plus ancien. */
  list() {
    const found = [];
    const files = backupFolder_().getFilesByType(MimeType.GOOGLE_SHEETS);
    while (files.hasNext()) {
      const file = files.next();
      if (file.getName().indexOf(BACKUP_PREFIX) === 0) found.push({ id: file.getId(), name: file.getName() });
    }
    return found.sort((a, b) => (a.name < b.name ? 1 : -1)).slice(0, LIMITS.BACKUPS_LISTED);
  },

  /** Ouvre la sauvegarde et vérifie sa structure. Ne modifie rien. */
  inspect_(id) {
    const copy = SpreadsheetApp.openById(id);
    const missing = Object.keys(SCHEMA).filter((name) => {
      const sheet = copy.getSheetByName(name);
      if (!sheet || sheet.getLastColumn() < 1) return true;
      const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
      // Une sauvegarde plus ancienne peut avoir moins de colonnes : elles seront ajoutées ensuite.
      return headers.length === 0 || SCHEMA[name].slice(0, headers.length).join() !== headers.join();
    });
    return { readable: missing.length === 0, missing };
  },

  testLatest_() {
    const [latest] = this.list();
    if (!latest) throw ERR.validation('Créez d’abord une sauvegarde.');
    const result = this.inspect_(latest.id);
    const report = {
      ok: result.readable,
      at: new Date().toISOString(),
      backup: latest.name,
      message: result.readable
        ? 'Sauvegarde lisible et complète : ' + latest.name + '.'
        : 'Sauvegarde incomplète (' + latest.name + ') : ' + result.missing.join(', ') + '.'
    };
    storageProps_().setProperty(PROP.LAST_RESTORE_TEST, JSON.stringify(report));
    return report;
  },

  restore_(backupId) {
    const backup = this.list().find((b) => b.id === backupId);
    if (!backup) throw ERR.validation('Cette sauvegarde est introuvable.');
    if (!this.inspect_(backup.id).readable) throw ERR.validation('Cette sauvegarde est incomplète : restauration annulée.');
    this.create_();
    const root = DriveApp.getFolderById(storageProps_().getProperty(PROP.ROOT_FOLDER_ID));
    const name = SPREADSHEET_NAME + ' (restauré depuis ' + backup.name.replace(BACKUP_PREFIX, '') + ')';
    const restored = DriveApp.getFileById(backup.id).makeCopy(name, root);
    storageProps_().setProperty(PROP.SPREADSHEET_ID, restored.getId());
    return { from: backup.name };
  }
};

/** Tâche planifiée quotidienne : une erreur doit se voir dans le journal. */
function orbiaDailyBackup() {
  try {
    const backup = withLock_(() => BackupService.create_(), LIMITS.STORAGE_LOCK_WAIT_MS);
    LogRepository.append({ level: 'audit', code: 'BACKUP_CREATED', action: 'planifié', message: 'Sauvegarde quotidienne : ' + backup.name + '.' });
  } catch (err) {
    LogRepository.append({ level: 'error', code: 'BACKUP_FAILED', action: 'planifié', message: 'Sauvegarde quotidienne impossible : ' + (err && err.message) });
  }
}

function orbiaMonthlyRestoreTest() {
  try {
    const report = withLock_(() => BackupService.testLatest_(), LIMITS.STORAGE_LOCK_WAIT_MS);
    LogRepository.append({ level: report.ok ? 'audit' : 'error', code: 'RESTORE_TEST', action: 'planifié', message: report.message });
  } catch (err) {
    LogRepository.append({ level: 'error', code: 'RESTORE_TEST', action: 'planifié', message: 'Test de restauration impossible : ' + (err && err.message) });
  }
}

/**
 * Schéma du classeur. Pour une évolution : ajouter des colonnes À LA FIN, puis
 * incrémenter SCHEMA_VERSION. Une colonne existante n'est jamais renommée.
 */
const SCHEMA_VERSION = 2;

const SCHEMA = Object.freeze({
  Settings: ['key', 'value', 'updatedAt'],
  Users: ['email', 'role', 'active', 'addedAt', 'addedBy'],
  BankImports: ['id', 'fileName', 'hash', 'importedAt', 'status', 'rowCount', 'importedBy'],
  BankTransactions: ['id', 'sourceId', 'operationDate', 'valueDate', 'rawLabel', 'amountCents', 'currency', 'account', 'status', 'importId', 'balanceCents'],
  Documents: ['id', 'driveFileId', 'sha256', 'type', 'supplier', 'date', 'invoiceNumber', 'netCents', 'vatCents', 'grossCents', 'ocrStatus', 'validationStatus'],
  DocumentVATLines: ['documentId', 'netCents', 'rate', 'vatCents', 'treatment', 'chargeability', 'deductibility', 'justification'],
  Matches: ['id', 'transactionId', 'documentId', 'amountCents', 'method', 'score', 'validatedBy'],
  Projects: ['id', 'name', 'status', 'budgetCents', 'startDate', 'endDate', 'active'],
  Allocations: ['id', 'sourceId', 'projectId', 'amountCents', 'percent', 'rule', 'validation'],
  ChartOfAccounts: ['account', 'label', 'type', 'version', 'active'],
  JournalEntries: ['id', 'journal', 'date', 'documentRef', 'label', 'status', 'author', 'createdAt', 'period'],
  JournalLines: ['entryId', 'account', 'debitCents', 'creditCents', 'documentRef', 'projectId'],
  VATPeriods: ['period', 'status', 'figures', 'checks', 'validatedAt', 'filingProof'],
  Expenses: ['id', 'beneficiary', 'reason', 'date', 'status', 'documents'],
  Trips: ['id', 'vehicleId', 'driver', 'route', 'purpose', 'distanceKm', 'distanceProof', 'projectId', 'scaleYear', 'reimbursementCents'],
  Vehicles: ['id', 'owner', 'category', 'energy', 'fiscalPower', 'usageDates', 'insuranceChecked'],
  AuditLog: ['at', 'level', 'source', 'code', 'action', 'actor', 'message', 'correlationId'],
  Jobs: ['job', 'source', 'idempotencyKey', 'status', 'error', 'attempts']
});

/** Arborescence : chaque entrée est relative au dossier racine privé. */
const FOLDER_TREE = Object.freeze([
  '01_Banque_Qonto', '01_Banque_Qonto/Imports_CSV', '01_Banque_Qonto/Releves_PDF', '01_Banque_Qonto/Archives_imports',
  '02_Factures_fournisseurs', '02_Factures_fournisseurs/2026', '02_Factures_fournisseurs/2027',
  '03_Factures_clients', '04_Notes_de_frais', '05_Contrats_et_decomptes',
  '06_Comptabilite', '06_Comptabilite/Exports_FEC', '06_Comptabilite/Journaux_balances', '06_Comptabilite/Clotures', '06_Comptabilite/Declarations_TVA',
  '07_Sauvegardes'
]);

const ROOT_FOLDER_NAME = 'Orbia';
const SPREADSHEET_NAME = 'Orbia - Données';
const BACKUP_FOLDER = '07_Sauvegardes';

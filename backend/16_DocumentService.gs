/**
 * Documents : l'original est gardé tel quel dans Drive, privé. Les informations sont
 * saisies ou corrigées à part, et un document validé ne se modifie qu'après réouverture.
 */
const DOC_TYPES = Object.freeze(['facture_recue', 'facture_emise', 'recu', 'avoir', 'contrat', 'decompte', 'note_de_frais']);
const DOC_MIME = Object.freeze({ 'application/pdf': [0x25, 0x50, 0x44, 0x46], 'image/jpeg': [0xFF, 0xD8, 0xFF], 'image/png': [0x89, 0x50, 0x4E, 0x47] });

function docFolder_(type, year) {
  const ids = JSON.parse(storageProps_().getProperty(PROP.FOLDER_IDS) || '{}');
  const base = { facture_emise: '03_Factures_clients', note_de_frais: '04_Notes_de_frais', contrat: '05_Contrats_et_decomptes', decompte: '05_Contrats_et_decomptes' }[type];
  if (base) return DriveApp.getFolderById(ids[base]);
  const parent = DriveApp.getFolderById(ids['02_Factures_fournisseurs']);
  const found = parent.getFoldersByName(year);
  return found.hasNext() ? found.next() : parent.createFolder(year);
}

function docSheet_() {
  return bankSheet_('Documents');
}

function moneyField_(value, label) {
  const text = cleanString_(value, label, 30);
  if (!text) return '';
  const cents = parseCents_(text);
  if (cents === null) throw ERR.validation(label + ' : montant illisible.');
  return cents;
}

/** Ce qui empêche de valider. Vide : le document peut l'être. */
function documentIssues_(doc, all) {
  const issues = [];
  if (!doc.supplier) issues.push('Indiquez le fournisseur ou le client.');
  if (!doc.date) issues.push('Indiquez la date.');
  if (doc.grossCents === '') issues.push('Indiquez le montant TTC.');
  if (doc.netCents !== '' && doc.vatCents !== '' && doc.grossCents !== '' && doc.netCents + doc.vatCents !== doc.grossCents) {
    issues.push('HT + TVA ne correspond pas au TTC.');
  }
  const same = (o) => o.id !== doc.id && doc.invoiceNumber && String(o.invoiceNumber).toLowerCase() === String(doc.invoiceNumber).toLowerCase()
    && String(o.supplier).toLowerCase() === String(doc.supplier).toLowerCase() && o.grossCents === doc.grossCents;
  if (all.some(same)) issues.push('Doublon possible : même fournisseur, numéro et montant.');
  return issues;
}

const DocumentService = {
  all_() {
    return readTable_(docSheet_(), SCHEMA.Documents);
  },

  find_(id) {
    const all = this.all_();
    const index = all.findIndex((d) => d.id === id);
    if (typeof id !== 'string' || index < 0) throw ERR.validation('Ce document est introuvable.');
    return { doc: all[index], row: index + 2, all };
  },

  public_(d) {
    const { driveFileId, sha256, ...rest } = d;
    return rest;
  },

  write_(row, doc) {
    docSheet_().getRange(row, 1, 1, SCHEMA.Documents.length).setValues([SCHEMA.Documents.map((c) => safeCell_(doc[c] === undefined ? '' : doc[c]))]);
  },

  list(data) {
    if (!storageProps_().getProperty(PROP.SPREADSHEET_ID)) return { ready: false, items: [] };
    if (data.id !== undefined) {
      const { doc, all } = this.find_(data.id);
      return { document: this.public_(doc), issues: documentIssues_(doc, all) };
    }
    return { ready: true, items: this.all_().reverse().map((d) => this.public_(d)) };
  },

  file(id) {
    const { doc } = this.find_(id);
    const blob = DriveApp.getFileById(doc.driveFileId).getBlob();
    return { mimeType: doc.mimeType, base64: Utilities.base64Encode(blob.getBytes()) };
  },

  upload_(data, actor) {
    requireStorage_();
    const signature = DOC_MIME[data.mimeType];
    if (!signature || typeof data.base64 !== 'string') throw ERR.validation('Format refusé : PDF, JPG ou PNG uniquement.');
    const bytes = Utilities.base64Decode(data.base64);
    if (!bytes.length || bytes.length > LIMITS.MAX_DOCUMENT_BYTES) throw ERR.validation('Fichier vide ou de plus de 10 Mo.');
    if (signature.some((b, i) => (bytes[i] & 255) !== b)) throw ERR.validation('Le contenu du fichier ne correspond pas à son format.');

    const sha256 = hexBytes_(bytes);
    const all = this.all_();
    const existing = all.find((d) => d.sha256 === sha256);
    if (existing) return { duplicate: true, document: this.public_(existing) };

    const type = DOC_TYPES.indexOf(data.type) >= 0 ? data.type : 'facture_recue';
    const fileName = cleanString_(data.fileName, 'Nom de fichier', 150).replace(/[\/\\]/g, '_') || 'document';
    const id = 'doc_' + sha256.slice(0, 16);
    const now = new Date().toISOString();
    const folder = docFolder_(type, now.slice(0, 4));
    const file = folder.createFile(Utilities.newBlob(bytes, data.mimeType, id + '_' + fileName));
    const doc = { id, driveFileId: file.getId(), sha256, type, supplier: '', date: '', invoiceNumber: '', netCents: '', vatCents: '', grossCents: '', ocrStatus: 'desactive', validationStatus: 'a_verifier', fileName, mimeType: data.mimeType, uploadedBy: actor, uploadedAt: now };
    this.write_(all.length + 2, doc);
    return { duplicate: false, document: this.public_(doc) };
  },

  update_(data) {
    const { doc, row } = this.find_(data.id);
    if (doc.validationStatus === 'valide') throw ERR.validation('Ce document est validé : rouvrez-le pour le modifier.');
    const next = Object.assign({}, doc, {
      type: cleanEnum_(data.type, 'Type', DOC_TYPES),
      supplier: cleanString_(data.supplier, 'Fournisseur', 160),
      date: cleanDate_(data.date, 'Date'),
      invoiceNumber: cleanString_(data.invoiceNumber, 'Numéro', 60),
      netCents: moneyField_(data.net, 'Montant HT'),
      vatCents: moneyField_(data.vat, 'TVA'),
      grossCents: moneyField_(data.gross, 'Montant TTC')
    });
    const changed = ['type', 'supplier', 'date', 'invoiceNumber', 'netCents', 'vatCents', 'grossCents'].filter((c) => String(doc[c]) !== String(next[c]));
    this.write_(row, next);
    return { document: this.public_(next), changes: changed.length ? changed.map((c) => c + ' : ' + doc[c] + ' → ' + next[c]).join(', ') : 'aucun changement' };
  },

  setStatus_(id, status) {
    const { doc, row, all } = this.find_(id);
    if (status === 'valide') {
      const issues = documentIssues_(doc, all);
      if (issues.length) throw ERR.validation(issues.join(' '));
    } else if (doc.validationStatus !== 'valide') {
      throw ERR.validation('Ce document n’est pas validé.');
    }
    const next = Object.assign({}, doc, { validationStatus: status });
    this.write_(row, next);
    return this.public_(next);
  }
};

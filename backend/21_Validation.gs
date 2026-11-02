function asPlainObject_(value) {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) throw ERR.badRequest();
  return value;
}

function cleanString_(value, label, max) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw ERR.validation(label + ' : valeur invalide.');
  const text = value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  if (text.length > max) throw ERR.validation(label + ' : ' + max + ' caractères maximum.');
  return text;
}

function cleanEnum_(value, label, allowed) {
  if (allowed.indexOf(value) < 0) throw ERR.validation(label + ' : valeur non reconnue.');
  return value;
}

function cleanDigits_(value, label, length) {
  const text = cleanString_(value, label, 40).replace(/\s/g, '');
  if (text && !new RegExp('^\\d{' + length + '}$').test(text)) {
    throw ERR.validation(label + ' : ' + length + ' chiffres attendus.');
  }
  return text;
}

function cleanDate_(value, label) {
  const text = cleanString_(value, label, 10);
  if (!text) return '';
  const parsed = new Date(text + 'T00:00:00Z');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || isNaN(parsed) || parsed.toISOString().slice(0, 10) !== text) {
    throw ERR.validation(label + ' : date invalide.');
  }
  return text;
}

function validateCompany_(input) {
  const data = asPlainObject_(input);
  const siren = cleanDigits_(data.siren, 'SIREN', 9);
  const siret = cleanDigits_(data.siret, 'SIRET', 14);
  if (siren && siret && siret.indexOf(siren) !== 0) {
    throw ERR.validation('Le SIRET doit commencer par le SIREN.');
  }
  const fiscalYearStart = cleanDate_(data.fiscalYearStart, 'Début d’exercice');
  const fiscalYearEnd = cleanDate_(data.fiscalYearEnd, 'Fin d’exercice');
  if (fiscalYearStart && fiscalYearEnd && fiscalYearEnd <= fiscalYearStart) {
    throw ERR.validation('La fin de l’exercice doit suivre son début.');
  }
  if (typeof data.projectsEnabled !== 'boolean') throw ERR.validation('Suivi par projet : valeur invalide.');
  return {
    legalName: cleanString_(data.legalName, 'Raison sociale', 160),
    legalForm: cleanString_(data.legalForm, 'Forme juridique', 40),
    siren,
    siret,
    fiscalYearStart,
    fiscalYearEnd,
    currency: cleanEnum_(data.currency, 'Devise', ['EUR']),
    vatRegime: cleanEnum_(data.vatRegime, 'Régime de TVA', ['a_confirmer', 'reel_normal', 'reel_simplifie', 'franchise']),
    vatPeriodicity: cleanEnum_(data.vatPeriodicity, 'Périodicité de TVA', ['a_confirmer', 'mensuelle', 'trimestrielle', 'annuelle']),
    projectsEnabled: data.projectsEnabled
  };
}

function validateUser_(input) {
  const data = asPlainObject_(input);
  const email = normalizeEmail_(cleanString_(data.email, 'E-mail', 254));
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw ERR.validation('E-mail : adresse invalide.');
  if (typeof data.active !== 'boolean') throw ERR.validation('Statut : valeur invalide.');
  return { email, role: cleanEnum_(data.role, 'Rôle', Object.keys(ROLE_PERMISSIONS)), active: data.active };
}

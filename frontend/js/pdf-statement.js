/**
 * Relevé PDF → CSV, entièrement dans le navigateur : le fichier ne quitte pas l'appareil.
 * Le CSV obtenu suit ensuite le chemin normal (colonnes, contrôle, revue, import).
 * Un PDF n'est pas une donnée structurée : tout doute arrête la lecture.
 */
const DATE_START = /^(\d{2})[/.-](\d{2})(?:[/.-](\d{2,4}))?(?=\s|$)/;
const NUMBER = String.raw`\d{1,3}(?:[   .,]\d{3})*[.,]\d{2}|\d+[.,]\d{2}`;
const AMOUNT_END = new RegExp(String.raw`([+\-−]\s?)?(${NUMBER})\s*(?:€|EUR)?\s*([+\-−])?$`);
const SUMMARY = (label) => new RegExp(String.raw`${label}\s*([+\-−])?\s*(${NUMBER})\s*(?:€|EUR)?`, 'i');
const NOISE = /^(solde|total|page\s|qonto|iban|bic|olinda|siret|rcs|capital|date\b)/i;

function toRows(items) {
  const rows = [];
  items.slice().sort((a, b) => a.page - b.page || b.y - a.y || a.x - b.x).forEach((item) => {
    if (!item.text.trim()) return;
    const row = rows.find((r) => r.page === item.page && Math.abs(r.y - item.y) <= 2);
    if (row) row.items.push(item); else rows.push({ page: item.page, y: item.y, items: [item] });
  });
  rows.forEach((r) => {
    r.items.sort((a, b) => a.x - b.x);
    r.text = r.items.map((i) => i.text.trim()).join(' ').replace(/\s+/g, ' ').trim();
  });
  return rows;
}

function centsOf(text) {
  return Number(text.replace(/\D/g, ''));
}

/** Sans signe, seul l'alignement sous « Débit » ou « Crédit » donne le sens. */
function signFromColumns(row, columns) {
  if (!columns) return 0;
  const last = row.items[row.items.length - 1];
  const distance = (x) => Math.abs(last.x - x);
  return distance(columns.debit) < distance(columns.credit) ? -1 : 1;
}

export function parseStatement(items) {
  const rows = toRows(items);
  const whole = rows.map((r) => r.text).join('\n');
  const yearMatch = whole.match(/\bdu\s+\d{2}\/\d{2}\/(20\d{2})\b/i) || whole.match(/\b(20\d{2})\b/);
  let columns = null;
  const ops = [];
  let current = null;
  let previous = null;

  rows.forEach((row) => {
    const gap = previous && previous.page === row.page ? previous.y - row.y : Infinity;
    previous = row;
    const debit = row.items.find((i) => /^d[ée]bit/i.test(i.text.trim()));
    const credit = row.items.find((i) => /^cr[ée]dit/i.test(i.text.trim()));
    if (debit && credit) { columns = { debit: debit.x, credit: credit.x }; current = null; return; }

    const date = row.text.match(DATE_START);
    const amount = row.text.match(AMOUNT_END);
    if (date && amount) {
      const year = date[3] ? (date[3].length === 2 ? `20${date[3]}` : date[3]) : yearMatch && yearMatch[1];
      if (!year) throw new Error('Année introuvable dans ce relevé.');
      let label = row.text.slice(date[0].length, amount.index).trim();
      label = label.replace(/^\d{2}[/.-]\d{2}(?:[/.-]\d{2,4})?\s*/, '').trim();
      if (/^(solde|total)/i.test(label)) { current = null; return; }
      const signText = amount[1] || amount[3] || '';
      const sign = signText ? (signText.trim() === '+' ? 1 : -1) : signFromColumns(row, columns);
      if (!sign) throw new Error(`Sens de l’opération impossible à déterminer : ${label}.`);
      current = { date: `${year}-${date[2]}-${date[1]}`, label, cents: sign * centsOf(amount[2]) };
      ops.push(current);
      return;
    }
    // Le pied de page est plus loin : seule une ligne proche prolonge le libellé.
    if (current && !amount && gap <= 16 && !NOISE.test(row.text)) current.label = `${current.label} ${row.text}`.trim();
    else current = null;
  });

  if (!ops.length) throw new Error('Aucune opération reconnue dans ce PDF. Utilisez l’export CSV de Qonto.');
  if (ops.some((o) => !o.label)) throw new Error('Une opération sans libellé a été trouvée : ce PDF n’est pas lisible avec certitude.');
  return ops;
}

const euros = (cents) => {
  const abs = Math.abs(cents);
  return `${cents < 0 ? '-' : ''}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, '0')}`;
};

/** Lit les totaux imprimés sur le relevé, quand il y en a. */
export function statementTotals(items) {
  const rows = toRows(items).map((r) => r.text);
  const pick = (re) => {
    const line = rows.map((t) => t.match(re)).filter(Boolean).pop();
    if (!line) return null;
    return (/[-−]/.test(line[1] || '') ? -1 : 1) * centsOf(line[2]);
  };
  const entries = pick(SUMMARY('Entrées'));
  const exits = pick(SUMMARY('Sorties'));
  const closing = pick(SUMMARY(String.raw`Solde au \d{2}/\d{2}`));
  return { inCents: entries, outCents: exits === null ? null : Math.abs(exits), closingCents: closing };
}

export function toCsv(ops, closingCents = null) {
  const quote = (t) => `"${t.replace(/"/g, '""')}"`;
  const lastIndex = ops.reduce((best, o, i) => (o.date >= ops[best].date ? i : best), 0);
  const lines = ops.map((o, i) => `${o.date};${quote(o.label)};${euros(o.cents)};${i === lastIndex && closingCents !== null ? euros(closingCents) : ''}`);
  return `Date;Libellé;Montant;Solde\n${lines.join('\n')}\n`;
}

/** Si le relevé imprime ses totaux, ils doivent correspondre au centime près. */
export function summarize(items) {
  const ops = parseStatement(items);
  const inCents = ops.filter((o) => o.cents > 0).reduce((s, o) => s + o.cents, 0);
  const outCents = ops.filter((o) => o.cents < 0).reduce((s, o) => s - o.cents, 0);
  const printed = statementTotals(items);
  const checked = printed.inCents !== null && printed.outCents !== null;
  if (checked && (printed.inCents !== inCents || printed.outCents !== outCents)) {
    throw new Error('Les totaux lus ne correspondent pas à ceux du relevé : rien n’a été importé. Utilisez l’export CSV de Qonto.');
  }
  return { csv: toCsv(ops, printed.closingCents), count: ops.length, inCents, outCents, checked };
}

export async function readStatement(file) {
  const pdfjs = await import('../vendor/pdfjs/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer(), isEvalSupported: false }).promise;
  const items = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    content.items.forEach((i) => { if (i.str) items.push({ page: n, text: i.str, x: i.transform[4], y: i.transform[5] }); });
  }
  return summarize(items);
}

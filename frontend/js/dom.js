/** Construit le DOM sans innerHTML : toute donnée est insérée comme texte. */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (key === 'class') el.className = value;
    else if (key === 'value') el.value = value;
    else if (key === 'selected') { el.selected = Boolean(value); el.defaultSelected = Boolean(value); }
    else if (key === 'checked' || key === 'disabled' || key === 'readOnly' || key === 'required') el[key] = Boolean(value);
    else el.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child === undefined || child === null || child === false) continue;
    el.append(child);
  }
  return el;
}

const SVG = 'http://www.w3.org/2000/svg';
const ICONS = {
  home: ['M4 11l8-7 8 7', 'M6 9.5V20h12V9.5'],
  docs: ['M7 3h7l4 4v14H7z', 'M14 3v4h4', 'M10 13h5', 'M10 17h5'],
  bank: ['M3 10l9-6 9 6', 'M5 10v8', 'M10 10v8', 'M14 10v8', 'M19 10v8', 'M3 20h18'],
  trip: ['M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z', 'M12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z'],
  more: ['M4 7h16', 'M4 12h16', 'M4 17h16'],
  projects: ['M3 7h7l2 2h9v10H3z'],
  ledger: ['M6 3h13v18H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z', 'M9 8h7', 'M9 12h7'],
  vat: ['M6 18L18 6', 'M8 9a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z', 'M16 18a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z'],
  close: ['M5 11h14v10H5z', 'M8 11V8a4 4 0 0 1 8 0v3'],
  settings: ['M4 7h10', 'M18 7h2', 'M4 17h2', 'M10 17h10', 'M16 5v4', 'M8 15v4']
};

export function icon(name) {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of ICONS[name]) {
    const path = document.createElementNS(SVG, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

export const field = (label, control, hint) => h('label', { class: 'field' }, label, control, hint && h('small', {}, hint));

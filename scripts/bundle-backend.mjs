// Assemble le backend en un seul fichier, à coller dans l'éditeur Apps Script.
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const dir = new URL('../backend/', import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith('.gs')).sort();
const body = files.map((f) => `// ===== ${f} =====\n${readFileSync(new URL(f, dir), 'utf8')}`).join('\n');
mkdirSync(new URL('../dist/', import.meta.url), { recursive: true });
writeFileSync(new URL('../dist/Orbia_backend.gs', import.meta.url),
  `// Fichier généré par npm run bundle. Ne pas modifier ici.\n${body}`);

# orbia.

Application privée de gestion comptable, en construction par étapes.
**État actuel : étape A4** (socle, droits, stockage, sauvegardes, import bancaire, documents).

- `frontend/` : interface statique publiée sur GitHub Pages
- `backend/` : Google Apps Script, seul à accéder aux données
- `dist/Orbia_backend.gs` : backend en un seul fichier, à coller dans Apps Script
- `tests/` : tests du backend et parcours navigateur
- `docs/DEPLOIEMENT.md` : mise en service et tests manuels

## Pourquoi deux hébergements

GitHub Pages ne sert que des fichiers statiques : il ne peut ni vérifier un droit ni lire Drive.
L'interface y vit donc sans aucune donnée, et Apps Script contrôle chaque appel.

## Règles pour ce dépôt

Il peut être public : n'y mettez jamais de facture, de relevé, d'adresse e-mail réelle ni de SIREN.
Les réglages réels vivent dans les propriétés de script et dans Orbia.

## Développement

```bash
npm test            # backend, sur un simulateur des services Apps Script
npm run test:e2e    # parcours Chromium (Playwright requis)
npm run bundle      # régénère dist/Orbia_backend.gs
```

Après toute modification de `backend/`, lancez `npm run bundle` et recollez le fichier dans Apps Script.

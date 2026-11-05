# Mise en service d'Orbia (A1)

Comptez 30 minutes. Connectez-vous avec le compte Google de la société pour les étapes 1 à 3 :
c'est lui qui possédera le serveur, puis les données Drive à partir de A2.

## 1. Créer l'identifiant de connexion Google

1. Ouvrez console.cloud.google.com et créez un projet nommé `Orbia`.
2. Dans **Google Auth Platform**, configurez l'application : audience **Externe**, puis publiez-la.
   Orbia ne demande que l'identité du compte, aucune donnée sensible.
3. Dans **Clients**, créez un **ID client OAuth** de type **Application Web**.
4. Dans **Origines JavaScript autorisées**, ajoutez `https://VOTRE-COMPTE.github.io`.
5. Copiez l'ID client (il finit par `.apps.googleusercontent.com`).

## 2. Installer le serveur

1. Sur script.google.com, créez un projet nommé `Orbia`.
2. Remplacez tout le contenu de `Code.gs` par `dist/Orbia_backend.gs`, puis enregistrez.
3. Dans **Paramètres du projet > Propriétés de script**, ajoutez :

| Propriété | Valeur |
|---|---|
| `ORBIA_GOOGLE_CLIENT_ID` | l'ID client de l'étape 1 |
| `ORBIA_BOOTSTRAP_ADMIN` | l'e-mail Google du premier administrateur |

4. Dans l'éditeur, lancez `orbiaCheckSetup` et acceptez l'autorisation. Le journal doit indiquer « Configuration complète ».

## 3. Déployer le serveur

1. **Déployer > Nouveau déploiement > Application Web**.
2. **Exécuter en tant que : Moi**. **Accès : Tout le monde**.
3. Copiez l'URL, qui finit par `/exec`.

« Tout le monde » est nécessaire pour que GitHub Pages puisse joindre le serveur.
Rien n'est accessible sans jeton Google valide d'un compte autorisé.

Pour une mise à jour, utilisez **Gérer les déploiements > Modifier > Nouvelle version** : l'URL reste la même.

## 4. Publier l'interface

1. Poussez ce dépôt sur GitHub, branche `main`.
2. **Settings > Pages > Source : GitHub Actions**.
3. **Settings > Secrets and variables > Actions > Variables**, ajoutez :
   - `ORBIA_API_URL` : l'URL `/exec`
   - `ORBIA_GOOGLE_CLIENT_ID` : l'ID client
4. Dans **Actions**, relancez **Publier l'interface**.

Sans compte payant, GitHub Pages exige un dépôt public.

## 5. Tests manuels

| Test | Résultat attendu |
|---|---|
| Ouvrir le site et se connecter avec le compte administrateur | Accueil, trésorerie « Pas encore de relevé » |
| Se connecter avec un compte non autorisé | « Accès refusé » |
| Ouvrir l'URL `/exec` dans un navigateur | `{"ok":true,"service":"orbia"}` et rien d'autre |
| Enregistrer un SIREN de 3 chiffres | Refus, message clair |
| Autoriser Julie comme collaboratrice, puis se connecter avec son compte | Pas d'onglets Utilisateurs ni Journal, société en lecture |
| Désactiver ce compte pendant qu'il est connecté, puis enregistrer ou recharger | Accès refusé |
| Ouvrir Réglages > Journal | La connexion refusée et les changements apparaissent |
| Répéter sur téléphone et sur PC | Navigation basse sur téléphone, menu latéral sur PC |

## Limites connues de A1

- **Signature des jetons** : Apps Script ne sait pas vérifier une signature RS256. Orbia fait vérifier le jeton par le service `tokeninfo` de Google, ce qui ajoute un appel réseau, mis en cache 5 minutes par jeton.
- **Reconnexion** : le jeton reste en mémoire. Recharger la page relance la connexion, souvent automatique.
- **En-têtes de sécurité** : GitHub Pages n'en permet pas. La politique de sécurité est dans la page, et l'affichage dans un cadre est bloqué par script.
- **Journal** : les 100 derniers événements restent visibles dans Orbia, et l'historique complet va dans l'onglet `AuditLog` du classeur.
- **Utilisateurs et configuration** : la source reste côté serveur, volontairement. Une modification à la main dans le classeur ne donne aucun droit. Les onglets `Users` et `Settings` n'en sont qu'une copie.

## Mise à jour vers A2

1. Dans Apps Script, remplacez tout `Code.gs` par `dist/Orbia_backend.gs`, puis enregistrez.
2. Lancez `orbiaCheckSetup` et acceptez les nouvelles autorisations (Drive, Sheets, tâches planifiées).
3. **Déployer > Gérer les déploiements**, crayon, **Nouvelle version**, **Déployer**. Vérifiez que l'accès reste **Tout le monde**.
4. Dans Orbia, **Réglages > Stockage**, cliquez sur **Créer l'espace Orbia**.

| Test A2 | Résultat attendu |
|---|---|
| Cliquer sur **Créer l'espace Orbia** | Dossier `Orbia` dans Drive, avec le classeur et les 7 sous-dossiers |
| Cliquer sur **Vérifier la structure** | Aucun doublon, aucune donnée modifiée |
| Cliquer sur **Sauvegarder maintenant** | Un classeur et un fichier JSON dans `07_Sauvegardes` |
| Cliquer sur **Tester la dernière sauvegarde** | « Réussi » |
| Renommer une colonne du classeur, puis vérifier la structure | Message d'alerte, puis remettre le nom d'origine |
| Se connecter en collaborateur | Pas d'onglet Stockage |

Une restauration fait basculer Orbia sur une copie de la sauvegarde. L'ancien classeur reste dans Drive.

## Mise à jour vers A3

1. Remplacez `Code.gs` par `dist/Orbia_backend.gs`, puis enregistrez.
2. **Déployer > Gérer les déploiements**, crayon, **Nouvelle version**, **Déployer**.
3. Dans Orbia, **Réglages > Stockage**, cliquez sur **Vérifier la structure** pour activer la lecture horaire du dossier Drive.

| Test A3 | Résultat attendu |
|---|---|
| **Banque > Importer depuis Qonto**, avec un vrai CSV | Colonnes proposées, à confirmer |
| **Vérifier le fichier** | Nombre de lignes, période, erreurs éventuelles |
| Importer, puis réimporter le même fichier | Aucun doublon |
| Importer un fichier avec une ligne abîmée | Refus, aucune opération ajoutée |
| Déposer un CSV de même format dans `Imports_CSV` | Importé dans l'heure, puis déplacé dans `Archives_imports` |

Le solde affiché est celui du dernier relevé, jamais un solde en temps réel. Les encaissements et décaissements sont des flux bancaires, pas du chiffre d'affaires.

## Relevés PDF

Le PDF est lu dans le navigateur et converti, puis suit le contrôle habituel. Comparez toujours les totaux affichés à ceux du relevé. N'importez pas la même période en PDF et en CSV : les libellés diffèrent, et les opérations seraient comptées deux fois.

## Mise à jour vers A4

1. Remplacez tout `Code.gs` par `dist/Orbia_backend.gs`. Contrôlez que le fichier se termine bien par `orbiaCheckSetup`.
2. **Déployer > Gérer les déploiements**, sélectionnez le déploiement actif utilisé par `ORBIA_API_URL`, crayon, **Nouvelle version**, **Déployer**.
3. N'utilisez jamais **Nouveau déploiement** : l'adresse changerait.

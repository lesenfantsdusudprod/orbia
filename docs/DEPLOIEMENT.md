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
- **Journal** : 100 événements dans les propriétés de script. Le journal durable arrive avec le classeur, en A2.
- **Liste des utilisateurs et configuration** : provisoirement dans les propriétés de script, puis déplacées vers le classeur en A2.

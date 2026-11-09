/**
 * À lancer depuis l'éditeur Apps Script après avoir rempli les propriétés de script.
 * Déclenche aussi la demande d'autorisation Google. N'écrit rien.
 */
function orbiaCheckSetup() {
  const props = PropertiesService.getScriptProperties();
  UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=test', { muteHttpExceptions: true });
  // Vrais essais d'écriture : une simple lecture ne prouve pas le droit de créer.
  DriveApp.createFolder('Orbia - test d\u2019autorisation').setTrashed(true);
  ScriptApp.getProjectTriggers();
  DriveApp.getFileById(SpreadsheetApp.create('Orbia - test d\u2019autorisation').getId()).setTrashed(true);
  const admin = props.getProperty(PROP.BOOTSTRAP_ADMIN) || ownerEmail_();
  if (!admin) {
    console.log('Administrateur introuvable : ajoutez la propriété ' + PROP.BOOTSTRAP_ADMIN + '.');
    return;
  }
  console.log('Configuration complète. Version ' + ORBIA_VERSION + '. Premier administrateur : ' + admin + '.');
  console.log('Étape suivante : Déployer > Nouveau déploiement > Application Web, Exécuter en tant que Moi, Accès Tout le monde.');
}

/**
 * À lancer depuis l'éditeur Apps Script après avoir rempli les propriétés de script.
 * Déclenche aussi la demande d'autorisation Google. N'écrit rien.
 */
function orbiaCheckSetup() {
  const props = PropertiesService.getScriptProperties();
  const missing = [PROP.GOOGLE_CLIENT_ID, PROP.BOOTSTRAP_ADMIN].filter((key) => !props.getProperty(key));
  UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=test', { muteHttpExceptions: true });
  // Vrai essai d'écriture : une simple lecture de Drive ne prouve pas le droit de créer.
  DriveApp.createFolder('Orbia - test d\u2019autorisation').setTrashed(true);
  ScriptApp.getProjectTriggers();
  DriveApp.getFileById(SpreadsheetApp.create('Orbia - test d\u2019autorisation').getId()).setTrashed(true);
  if (missing.length) {
    console.log('Propriétés manquantes : ' + missing.join(', '));
  } else {
    console.log('Configuration complète. Version ' + ORBIA_VERSION);
  }
}

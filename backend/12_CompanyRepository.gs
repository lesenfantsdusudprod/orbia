/**
 * Configuration par société, rangée sous son propre identifiant.
 * Rien n'est pré-rempli : les données légales sont saisies par un administrateur.
 */
const COMPANY_DEFAULTS = Object.freeze({
  legalName: '',
  legalForm: '',
  siren: '',
  siret: '',
  fiscalYearStart: '',
  fiscalYearEnd: '',
  currency: 'EUR',
  vatRegime: 'a_confirmer',
  vatPeriodicity: 'a_confirmer',
  projectsEnabled: true
});

const CompanyRepository = {
  key_() {
    const id = PropertiesService.getScriptProperties().getProperty(PROP.COMPANY_ID) || 'default';
    return PROP.COMPANY_PREFIX + id;
  },

  get() {
    const raw = PropertiesService.getScriptProperties().getProperty(this.key_());
    return Object.assign({}, COMPANY_DEFAULTS, raw ? JSON.parse(raw) : {});
  },

  /** À appeler uniquement dans withLock_. */
  save_(config) {
    PropertiesService.getScriptProperties().setProperty(this.key_(), JSON.stringify(config));
    return config;
  }
};

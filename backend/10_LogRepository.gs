/**
 * Journal circulaire des erreurs et actions sensibles (100 dernières entrées).
 * Stockage provisoire : le journal d'audit durable arrive avec le classeur en A2.
 * Écrire au journal ne doit jamais faire échouer l'opération en cours.
 */
function sanitizeLogText_(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/eyJ[A-Za-z0-9_-]{8,}(\.[A-Za-z0-9_-]+){0,2}/g, '[jeton masqué]')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .slice(0, LIMITS.LOG_MESSAGE_CHARS);
}

const LogRepository = {
  append(entry) {
    const clean = {
      at: new Date().toISOString(),
      level: ['error', 'warn', 'audit', 'info'].indexOf(entry.level) >= 0 ? entry.level : 'info',
      source: entry.source === 'client' ? 'client' : 'server',
      code: sanitizeLogText_(entry.code).slice(0, 40),
      action: sanitizeLogText_(entry.action).slice(0, 60),
      actor: sanitizeLogText_(entry.actor).slice(0, 254),
      message: sanitizeLogText_(entry.message),
      correlationId: sanitizeLogText_(entry.correlationId).slice(0, 40)
    };
    console.log(JSON.stringify(clean));
    try {
      withLock_(() => {
        const props = PropertiesService.getScriptProperties();
        const head = Number(props.getProperty(PROP.LOG_HEAD) || 0);
        props.setProperties({
          [PROP.LOG_PREFIX + (head % LIMITS.LOG_SLOTS)]: JSON.stringify(clean),
          [PROP.LOG_HEAD]: String(head + 1)
        });
      });
    } catch (err) {
      console.error('Journal indisponible');
    }
  },

  /** Du plus récent au plus ancien. */
  list() {
    const all = PropertiesService.getScriptProperties().getProperties();
    const head = Number(all[PROP.LOG_HEAD] || 0);
    const out = [];
    for (let i = 1; i <= Math.min(head, LIMITS.LOG_SLOTS); i++) {
      const raw = all[PROP.LOG_PREFIX + ((head - i) % LIMITS.LOG_SLOTS)];
      if (raw) out.push(JSON.parse(raw));
    }
    return out;
  }
};

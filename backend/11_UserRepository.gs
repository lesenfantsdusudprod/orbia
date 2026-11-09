/**
 * Liste blanche. Interface volontairement étroite pour migrer vers l'onglet
 * `Users` en A2 sans toucher aux appelants.
 */
function normalizeEmail_(email) {
  return String(email || '').trim().toLowerCase();
}

/**
 * Demandes d'accès : une par compte, plafonnées pour qu'un inconnu ne puisse pas
 * remplir le stockage. Une demande ne donne aucun droit tant qu'un administrateur
 * ne l'a pas acceptée.
 */
function ownerEmail_() {
  try { return Session.getEffectiveUser().getEmail(); } catch (err) { return ''; }
}

const AccessRequests = {
  all() {
    return JSON.parse(PropertiesService.getScriptProperties().getProperty(PROP.ACCESS_REQUESTS) || '[]');
  },

  save_(list) {
    PropertiesService.getScriptProperties().setProperty(PROP.ACCESS_REQUESTS, JSON.stringify(list));
  },

  submit_(identity, correlationId) {
    UserRepository.bootstrapIfEmpty();
    const user = UserRepository.find(identity.email);
    if (user && user.active === true) return { status: 'authorized' };
    if (user) return { status: 'disabled' };
    return withLock_(() => {
      const list = this.all();
      if (list.some((r) => r.email === identity.email)) return { status: 'pending' };
      if (list.length >= LIMITS.MAX_ACCESS_REQUESTS) throw new OrbiaError('REQUESTS_FULL', 'Trop de demandes en attente. Contactez directement un administrateur.');
      list.push({ email: identity.email, name: sanitizeLogText_(identity.name).slice(0, 80), at: new Date().toISOString() });
      this.save_(list);
      LogRepository.append({ level: 'audit', code: 'ACCESS_REQUESTED', actor: identity.email, message: 'Demande d\u2019accès reçue.', correlationId });
      return { status: 'pending' };
    });
  },

  /** À appeler dans withLock_. */
  remove_(email) {
    const list = this.all();
    const next = list.filter((r) => r.email !== email);
    if (next.length === list.length) throw ERR.validation('Cette demande n\u2019existe plus.');
    this.save_(next);
  }
};

const UserRepository = {
  all() {
    const raw = PropertiesService.getScriptProperties().getProperty(PROP.USERS);
    return raw ? JSON.parse(raw) : [];
  },

  find(email) {
    const wanted = normalizeEmail_(email);
    return this.all().find((u) => u.email === wanted) || null;
  },

  saveAll_(users) {
    PropertiesService.getScriptProperties().setProperty(PROP.USERS, JSON.stringify(users));
  },

  /** Crée le premier administrateur, une seule fois, si la liste est vide. */
  bootstrapIfEmpty() {
    if (this.all().length) return;
    // Sans réglage, le premier administrateur est le propriétaire du serveur.
    const admin = normalizeEmail_(PropertiesService.getScriptProperties().getProperty(PROP.BOOTSTRAP_ADMIN) || ownerEmail_());
    if (!admin) throw ERR.notConfigured();
    withLock_(() => {
      if (this.all().length) return;
      this.saveAll_([{ email: admin, role: ROLES.ADMIN, active: true, addedAt: new Date().toISOString(), addedBy: 'bootstrap' }]);
    });
  },

  /** À appeler uniquement dans withLock_. Refuse de laisser Orbia sans administrateur actif. */
  upsert_(user, actorEmail) {
    const users = this.all();
    const index = users.findIndex((u) => u.email === user.email);
    const next = index >= 0
      ? Object.assign({}, users[index], { role: user.role, active: user.active })
      : { email: user.email, role: user.role, active: user.active, addedAt: new Date().toISOString(), addedBy: actorEmail };
    if (index >= 0) users[index] = next; else users.push(next);
    if (!users.some((u) => u.active && u.role === ROLES.ADMIN)) {
      throw ERR.validation('Orbia doit garder au moins un administrateur actif.');
    }
    this.saveAll_(users);
    return next;
  }
};

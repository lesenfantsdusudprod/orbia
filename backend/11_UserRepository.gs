/**
 * Liste blanche. Interface volontairement étroite pour migrer vers l'onglet
 * `Users` en A2 sans toucher aux appelants.
 */
function normalizeEmail_(email) {
  return String(email || '').trim().toLowerCase();
}

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
    const admin = normalizeEmail_(PropertiesService.getScriptProperties().getProperty(PROP.BOOTSTRAP_ADMIN));
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

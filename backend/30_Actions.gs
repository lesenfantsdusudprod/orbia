/**
 * Registre des actions. Chaque action déclare son droit : pas de droit, pas d'accès.
 * Ajouter une fonction ailleurs ne l'expose jamais.
 */
const ACTIONS = Object.freeze({
  'session.get': {
    permission: 'session:read',
    run: (_, ctx) => ({
      user: { email: ctx.user.email, name: ctx.user.name, role: ctx.user.role },
      permissions: ROLE_PERMISSIONS[ctx.user.role],
      company: CompanyRepository.get(),
      version: ORBIA_VERSION
    })
  },

  'company.update': {
    permission: 'company:write',
    run: (payload, ctx) => {
      const config = validateCompany_(payload);
      withLock_(() => CompanyRepository.save_(config));
      LogRepository.append({ level: 'audit', code: 'COMPANY_UPDATED', action: ctx.action, actor: ctx.user.email, message: 'Configuration de la société modifiée.', correlationId: ctx.correlationId });
      return { company: config };
    }
  },

  'users.list': {
    permission: 'users:manage',
    run: () => ({ users: UserRepository.all() })
  },

  'users.save': {
    permission: 'users:manage',
    run: (payload, ctx) => {
      const input = validateUser_(payload);
      if (input.email === ctx.user.email && (!input.active || input.role !== ROLES.ADMIN)) {
        throw ERR.validation('Vous ne pouvez pas retirer vos propres droits d’administrateur.');
      }
      const saved = withLock_(() => UserRepository.upsert_(input, ctx.user.email));
      LogRepository.append({ level: 'audit', code: 'USER_SAVED', action: ctx.action, actor: ctx.user.email, message: input.email + ' : rôle ' + input.role + ', ' + (input.active ? 'actif' : 'désactivé') + '.', correlationId: ctx.correlationId });
      return { user: saved };
    }
  },

  'logs.list': {
    permission: 'logs:read',
    run: () => ({ entries: LogRepository.list() })
  },

  'logs.client': {
    permission: 'logs:write',
    run: (payload, ctx) => {
      const data = asPlainObject_(payload);
      LogRepository.append({ level: 'error', source: 'client', code: 'CLIENT_ERROR', action: data.where, actor: ctx.user.email, message: data.message, correlationId: ctx.correlationId });
      return {};
    }
  }
});

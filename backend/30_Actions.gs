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
      mirrorSafely_();
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
      mirrorSafely_();
      LogRepository.append({ level: 'audit', code: 'USER_SAVED', action: ctx.action, actor: ctx.user.email, message: input.email + ' : rôle ' + input.role + ', ' + (input.active ? 'actif' : 'désactivé') + '.', correlationId: ctx.correlationId });
      return { user: saved };
    }
  },

  'storage.status': {
    permission: 'storage:manage',
    run: () => StorageService.status()
  },

  'storage.init': {
    permission: 'storage:manage',
    run: (_, ctx) => {
      const status = withLock_(() => StorageService.initialize_(), LIMITS.STORAGE_LOCK_WAIT_MS);
      mirrorSafely_();
      LogRepository.append({ level: 'audit', code: 'STORAGE_READY', action: ctx.action, actor: ctx.user.email, message: 'Espace Drive et classeur vérifiés.', correlationId: ctx.correlationId });
      return status;
    }
  },

  'storage.backup': {
    permission: 'storage:manage',
    run: (_, ctx) => {
      const backup = withLock_(() => BackupService.create_(), LIMITS.STORAGE_LOCK_WAIT_MS);
      LogRepository.append({ level: 'audit', code: 'BACKUP_CREATED', action: ctx.action, actor: ctx.user.email, message: 'Sauvegarde créée : ' + backup.name + '.', correlationId: ctx.correlationId });
      return StorageService.status();
    }
  },

  'storage.restoreTest': {
    permission: 'storage:manage',
    run: (_, ctx) => {
      const result = withLock_(() => BackupService.testLatest_(), LIMITS.STORAGE_LOCK_WAIT_MS);
      LogRepository.append({ level: result.ok ? 'audit' : 'error', code: 'RESTORE_TEST', action: ctx.action, actor: ctx.user.email, message: result.message, correlationId: ctx.correlationId });
      return Object.assign(StorageService.status(), { restoreTest: result });
    }
  },

  'storage.restore': {
    permission: 'storage:manage',
    run: (payload, ctx) => {
      const data = asPlainObject_(payload);
      if (data.confirm !== 'RESTAURER') throw ERR.validation('Confirmez la restauration.');
      const restored = withLock_(() => BackupService.restore_(cleanString_(data.backupId, 'Sauvegarde', 200)), LIMITS.STORAGE_LOCK_WAIT_MS);
      LogRepository.append({ level: 'audit', code: 'BACKUP_RESTORED', action: ctx.action, actor: ctx.user.email, message: 'Restauration depuis ' + restored.from + '. L\u2019ancien classeur est conservé dans Drive.', correlationId: ctx.correlationId });
      return StorageService.status();
    }
  },

  'bank.summary': {
    permission: 'bank:read',
    run: () => BankService.summary()
  },

  'bank.list': {
    permission: 'bank:read',
    run: (payload) => BankService.list(asPlainObject_(payload))
  },

  'bank.preview': {
    permission: 'bank:import',
    run: (payload) => BankService.preview(asPlainObject_(payload))
  },

  'bank.import': {
    permission: 'bank:import',
    run: (payload, ctx) => {
      const report = withLock_(() => BankService.import_(asPlainObject_(payload), ctx.user.email), LIMITS.STORAGE_LOCK_WAIT_MS);
      LogRepository.append({ level: 'audit', code: 'BANK_IMPORT', action: ctx.action, actor: ctx.user.email, message: report.fileName + ' : ' + report.added + ' opération(s) ajoutée(s), ' + report.skipped + ' déjà présente(s).', correlationId: ctx.correlationId });
      return report;
    }
  },

  'bank.scanFolder': {
    permission: 'bank:import',
    run: () => BankService.scanFolder_()
  },

  'documents.list': {
    permission: 'documents:read',
    run: (payload) => DocumentService.list(asPlainObject_(payload))
  },

  'documents.file': {
    permission: 'documents:read',
    run: (payload) => DocumentService.file(asPlainObject_(payload).id)
  },

  'documents.upload': {
    permission: 'documents:write',
    run: (payload, ctx) => {
      const result = withLock_(() => DocumentService.upload_(asPlainObject_(payload), ctx.user.email), LIMITS.STORAGE_LOCK_WAIT_MS);
      if (!result.duplicate) LogRepository.append({ level: 'audit', code: 'DOCUMENT_ADDED', action: ctx.action, actor: ctx.user.email, message: 'Document ajouté : ' + result.document.fileName + '.', correlationId: ctx.correlationId });
      return result;
    }
  },

  'documents.update': {
    permission: 'documents:write',
    run: (payload, ctx) => {
      const data = asPlainObject_(payload);
      const result = withLock_(() => DocumentService.update_(data), LIMITS.STORAGE_LOCK_WAIT_MS);
      LogRepository.append({ level: 'audit', code: 'DOCUMENT_UPDATED', action: ctx.action, actor: ctx.user.email, message: 'Document ' + result.document.id + ' : ' + result.changes + '.', correlationId: ctx.correlationId });
      return result;
    }
  },

  'documents.validate': {
    permission: 'documents:validate',
    run: (payload, ctx) => {
      const id = asPlainObject_(payload).id;
      const document = withLock_(() => DocumentService.setStatus_(id, 'valide'), LIMITS.STORAGE_LOCK_WAIT_MS);
      LogRepository.append({ level: 'audit', code: 'DOCUMENT_VALIDATED', action: ctx.action, actor: ctx.user.email, message: 'Document validé : ' + document.id + '.', correlationId: ctx.correlationId });
      return { document };
    }
  },

  'documents.reopen': {
    permission: 'documents:validate',
    run: (payload, ctx) => {
      const data = asPlainObject_(payload);
      const reason = cleanString_(data.reason, 'Motif', 200);
      if (!reason) throw ERR.validation('Indiquez le motif de la réouverture.');
      const document = withLock_(() => DocumentService.setStatus_(data.id, 'a_verifier'), LIMITS.STORAGE_LOCK_WAIT_MS);
      LogRepository.append({ level: 'audit', code: 'DOCUMENT_REOPENED', action: ctx.action, actor: ctx.user.email, message: 'Document rouvert : ' + document.id + '. Motif : ' + reason, correlationId: ctx.correlationId });
      return { document };
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

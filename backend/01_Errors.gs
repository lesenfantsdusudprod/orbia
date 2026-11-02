/** Erreur métier : `message` est affiché à l'utilisateur, jamais de détail technique. */
class OrbiaError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'OrbiaError';
    this.code = code;
  }
}

const ERR = Object.freeze({
  notConfigured: () => new OrbiaError('NOT_CONFIGURED', "Orbia n'est pas encore configuré sur le serveur."),
  badRequest: (m) => new OrbiaError('BAD_REQUEST', m || 'La requête est invalide.'),
  unauthenticated: () => new OrbiaError('UNAUTHENTICATED', 'Votre session a expiré. Reconnectez-vous.'),
  notAllowed: () => new OrbiaError('NOT_ALLOWED', "Ce compte Google n'a pas accès à Orbia."),
  forbidden: () => new OrbiaError('FORBIDDEN', "Votre rôle ne permet pas cette action."),
  validation: (m) => new OrbiaError('VALIDATION', m),
  busy: () => new OrbiaError('BUSY', 'Orbia est occupé. Réessayez dans quelques secondes.'),
  authUnavailable: () => new OrbiaError('AUTH_UNAVAILABLE', "La vérification Google n'a pas répondu. Réessayez.")
});

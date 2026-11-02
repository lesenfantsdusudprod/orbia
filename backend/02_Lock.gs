/** Sérialise les écritures : les propriétés de script n'ont pas de transaction. */
function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(LIMITS.LOCK_WAIT_MS)) throw ERR.busy();
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

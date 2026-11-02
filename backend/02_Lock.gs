/** Sérialise les écritures : les propriétés de script n'ont pas de transaction. */
function withLock_(fn, waitMs) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(waitMs || LIMITS.LOCK_WAIT_MS)) throw ERR.busy();
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

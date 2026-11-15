// Turn low-level storage errors into messages a person can act on.
export function friendlyError(e, fallback = 'Something went wrong') {
  const name = e && e.name, msg = e && e.message ? String(e.message) : '';
  if (name === 'QuotaExceededError' || /quota|storage.*full|exceeded/i.test(msg)) return 'Your browser storage is full. Free some space (delete old presentations or large images, or clear other site data), or export a backup and continue in a new deck.';
  if (name === 'SecurityError' || /denied|not allowed/i.test(msg) && /storage|indexeddb/i.test(msg)) return 'The browser blocked storage for this site (private or restricted mode?). Your work is kept in this tab only; export a backup to keep it.';
  if (name === 'InvalidStateError' || /database.*(closing|closed)|connection is closing/i.test(msg)) return 'The browser closed its storage connection. Reload the page; your last saved version is safe.';
  return msg || fallback;
}

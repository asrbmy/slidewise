export function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  if (import.meta.env.DEV) return;
  // If a worker already controls the page, a later controller change means a new version took over:
  // tell the app so it can offer a reload (old lazy-loaded chunks may no longer exist).
  const hadController = !!navigator.serviceWorker.controller;
  let notified = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || notified) return; notified = true;
    window.dispatchEvent(new CustomEvent('slidewise:update'));
  });
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(import.meta.env.BASE_URL + 'sw.js', { scope: import.meta.env.BASE_URL }).then((reg) => {
      // check for a new deployment when the tab becomes visible again (long-lived tabs / installed PWA)
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
    }).catch(() => {});
  });
}

/** Registro del service worker (solo en producción): la app funciona sin conexión. */
export function registerServiceWorker(onReady: () => void): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  const go = () =>
    navigator.serviceWorker
      .register('./sw.js')
      .then((reg) => {
        reg.addEventListener('updatefound', () => {
          const w = reg.installing;
          w?.addEventListener('statechange', () => {
            // Primera instalación: todo quedó en caché → lista para jugar offline
            if (w.state === 'installed' && !navigator.serviceWorker.controller) onReady();
          });
        });
      })
      .catch(() => {});
  // El arranque es asíncrono (Rapier): si `load` ya ocurrió, registra de inmediato.
  if (document.readyState === 'complete') go();
  else window.addEventListener('load', go);
}

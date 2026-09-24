import { useEffect, useState } from 'react';

/**
 * Registers the service worker (vite-plugin-pwa, autoUpdate). New versions are
 * downloaded and activated in the background; instead of force-reloading in the
 * middle of a game we show a small toast and let the user reload when ready.
 */
export function UpdateToast() {
  const [needReload, setNeedReload] = useState(false);
  const [offlineReady, setOfflineReady] = useState(false);

  useEffect(() => {
    if (import.meta.env.DEV || !('serviceWorker' in navigator)) return;
    let timer: ReturnType<typeof setInterval> | undefined;
    import('virtual:pwa-register')
      .then(({ registerSW }) =>
        registerSW({
          immediate: true,
          onNeedReload: () => setNeedReload(true),
          onOfflineReady: () => setOfflineReady(true),
          onRegisteredSW: (_url, reg) => {
            // Check for a new deployment every hour while the app stays open.
            if (reg) timer = setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);
          },
        }),
      )
      .catch(() => {});
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!offlineReady) return;
    const t = setTimeout(() => setOfflineReady(false), 4000);
    return () => clearTimeout(t);
  }, [offlineReady]);

  if (needReload) {
    return (
      <div className="update-toast" role="status">
        <span>New version available</span>
        <button className="btn small primary" onClick={() => window.location.reload()}>
          Reload
        </button>
        <button className="btn small ghost" onClick={() => setNeedReload(false)} aria-label="Dismiss">
          ✕
        </button>
      </div>
    );
  }
  if (offlineReady) {
    return (
      <div className="update-toast" role="status">
        <span>Ready to work offline</span>
      </div>
    );
  }
  return null;
}

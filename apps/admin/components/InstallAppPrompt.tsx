'use client';

import { useEffect, useState } from 'react';
import styles from './InstallAppPrompt.module.scss';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

const DISMISS_KEY = 'pumpkin.admin.pwa.install.dismissed';

export function InstallAppPrompt({ appLabel }: { appLabel: string }) {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);
  const [standalone, setStandalone] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      ('standalone' in navigator &&
        Boolean((navigator as Navigator & { standalone?: boolean }).standalone));
    setStandalone(isStandalone);
    if (isStandalone) return;
    if (sessionStorage.getItem(DISMISS_KEY) === '1') return;

    const onBip = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      setVisible(true);
    };
    window.addEventListener('beforeinstallprompt', onBip);
    return () => window.removeEventListener('beforeinstallprompt', onBip);
  }, []);

  if (standalone || !visible || !deferred) return null;

  return (
    <div className={styles.bar} role="region" aria-label="Instalar aplicación">
      <p>
        Instala <strong>{appLabel}</strong> como app en este equipo.
      </p>
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.primary}
          onClick={() => {
            void (async () => {
              await deferred.prompt();
              await deferred.userChoice;
              setVisible(false);
              setDeferred(null);
            })();
          }}
        >
          Instalar
        </button>
        <button
          type="button"
          className={styles.ghost}
          onClick={() => {
            sessionStorage.setItem(DISMISS_KEY, '1');
            setVisible(false);
          }}
        >
          Ahora no
        </button>
      </div>
    </div>
  );
}

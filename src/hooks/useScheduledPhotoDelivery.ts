import { useEffect } from 'react';
import { triggerScheduledPhotoDelivery } from '../lib/scheduledPhotos';

const POLL_INTERVAL_MS = 30 * 1000;

/**
 * Backup trigger for scheduled photos.
 *
 * The database cron job is the main trigger. This hook is a safety net: while
 * either person has the couple chat open, it asks the delivery worker to send
 * any photo whose time has come. Delivery is idempotent (one Firestore document
 * per scheduled photo), so running it from both places never duplicates a photo.
 */
export function useScheduledPhotoDelivery(): void {
  useEffect(() => {
    let cancelled = false;

    const run = () => {
      if (cancelled || document.visibilityState === 'hidden') return;
      void triggerScheduledPhotoDelivery();
    };

    run();
    const interval = window.setInterval(run, POLL_INTERVAL_MS);
    document.addEventListener('visibilitychange', run);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', run);
    };
  }, []);
}
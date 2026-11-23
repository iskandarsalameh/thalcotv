import { signal } from '@preact/signals';

/** True when the current tab has scrolled away from the top (tab bar gets out of the way). */
export const chromeHidden = signal(false);
/** Set when a newer build has been published and is waiting to be applied. */
export const updateReady = signal(false);

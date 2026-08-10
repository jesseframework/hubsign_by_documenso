/**
 * Notification chime for newly-arrived Signature Inbox mail.
 *
 * Synthesised with the Web Audio API rather than shipping an audio file: it's a
 * few hundred bytes of code instead of a binary asset, needs no network fetch
 * (so it still sounds on a cold or offline page), and can't 404.
 */

const STORAGE_KEY = 'hubsign:inbox-chime';

/** Two-note fall, quiet and short — a notification, not an alarm. */
const NOTES: { frequency: number; startAt: number; duration: number }[] = [
  { frequency: 880.0, startAt: 0, duration: 0.18 }, // A5
  { frequency: 1174.66, startAt: 0.11, duration: 0.26 }, // D6
];

const PEAK_GAIN = 0.09;

export const isInboxChimeEnabled = (): boolean => {
  if (typeof window === 'undefined') {
    return false;
  }

  try {
    // Default on — an inbox you have to watch isn't much of an inbox.
    return window.localStorage.getItem(STORAGE_KEY) !== 'off';
  } catch {
    return true; // Storage blocked (private mode, embedded) — keep the default.
  }
};

export const setInboxChimeEnabled = (enabled: boolean): void => {
  try {
    window.localStorage.setItem(STORAGE_KEY, enabled ? 'on' : 'off');
  } catch {
    // Preference simply won't persist; the in-page toggle still works.
  }
};

let audioContext: AudioContext | null = null;

const getAudioContext = (): AudioContext | null => {
  if (typeof window === 'undefined') {
    return null;
  }

  const Ctor =
    window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

  if (!Ctor) {
    return null;
  }

  // One context for the tab; browsers cap how many can exist.
  if (!audioContext) {
    audioContext = new Ctor();
  }

  return audioContext;
};

/**
 * Play the chime. Silent no-op when muted, unsupported, or when the browser's
 * autoplay policy still has the context suspended because the user hasn't
 * interacted with the page yet — never throws into the caller's event handler.
 */
export const playInboxChime = (): void => {
  if (!isInboxChimeEnabled()) {
    return;
  }

  try {
    const ctx = getAudioContext();

    if (!ctx) {
      return;
    }

    // Suspended until the first user gesture on a freshly-loaded page. Resuming
    // is a promise we deliberately don't await: if it's still blocked this
    // chime is lost, and the next one plays once the user has clicked anything.
    if (ctx.state === 'suspended') {
      void ctx.resume().catch(() => undefined);
    }

    const now = ctx.currentTime;

    for (const note of NOTES) {
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();

      oscillator.type = 'sine';
      oscillator.frequency.value = note.frequency;

      const start = now + note.startAt;
      const end = start + note.duration;

      // Ramp in and out — a raw start/stop on a sine clicks audibly.
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(PEAK_GAIN, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, end);

      oscillator.connect(gain).connect(ctx.destination);
      oscillator.start(start);
      oscillator.stop(end + 0.02);
    }
  } catch {
    // Audio is a nicety; a failure here must never break inbox updates.
  }
};

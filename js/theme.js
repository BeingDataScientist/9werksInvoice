// Theme application. Kept separate so the router doesn't pull in the whole
// settings screen just to paint the right colours on boot.
//
// The chosen theme lives in IndexedDB with the rest of the settings, but a
// copy is mirrored into localStorage: the boot script in index.html has to
// pick a skin synchronously, before the first paint, and IndexedDB is async.

export const THEMES = [
  { key: 'system', label: 'System' },
  { key: 'light', label: 'Light' },
  { key: 'dark', label: 'Dark' },
];

export const THEME_KEY = 'werks:theme';

// Must match --bg in css/styles.css for each skin.
const BAR_COLOR = { light: '#ece5d5', dark: '#0f1115' };

const listeners = new Set();

export const prefersDark = () => window.matchMedia('(prefers-color-scheme: dark)').matches;

/** 'system' resolved against the OS setting — always 'light' or 'dark'. */
export const resolveTheme = (theme) =>
  (theme === 'dark' || theme === 'light' ? theme : prefersDark() ? 'dark' : 'light');

/** What the mirror says, for code that runs before settings are loaded. */
export function readStoredTheme() {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

export function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'dark' || theme === 'light') root.dataset.theme = theme;
  else delete root.dataset.theme;

  const resolved = resolveTheme(theme);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', BAR_COLOR[resolved]);

  try {
    if (theme === 'dark' || theme === 'light') localStorage.setItem(THEME_KEY, theme);
    else localStorage.removeItem(THEME_KEY);
  } catch {
    // Private browsing can block storage; the theme still applies for this session.
  }

  listeners.forEach((fn) => fn(theme, resolved));
  return resolved;
}

/** Subscribe to theme changes. Returns an unsubscribe function. */
export function onThemeChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** The opposite of what is on screen right now — a plain light/dark flip. */
export const flipTheme = (theme) => (resolveTheme(theme) === 'dark' ? 'light' : 'dark');

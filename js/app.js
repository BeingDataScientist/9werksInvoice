// Router + bootstrap. Views are lazy-loaded so the first paint stays quick.

import { getSettings, openDB, saveSettings } from './store.js';
import { esc, html, qs, qsa, raw, toast } from './util.js';
import { applyTheme, flipTheme, onThemeChange } from './theme.js';

const ROUTES = [
  { pattern: /^#?\/?$/,                        view: 'list',      nav: 'invoices' },
  { pattern: /^#\/invoices$/,                  view: 'list',      nav: 'invoices' },
  { pattern: /^#\/invoice\/new$/,              view: 'editor',    nav: 'new',      params: () => ({ id: 'new' }) },
  { pattern: /^#\/invoice\/([^/]+)\/edit$/,    view: 'editor',    nav: 'invoices', params: (m) => ({ id: m[1] }) },
  { pattern: /^#\/invoice\/([^/]+)$/,          view: 'detail',    nav: 'invoices', params: (m) => ({ id: m[1] }) },
  { pattern: /^#\/analytics$/,                 view: 'analytics', nav: 'analytics' },
  { pattern: /^#\/history$/,                   view: 'history',   nav: 'history' },
  { pattern: /^#\/history\/([^/]+)$/,          view: 'history',   nav: 'history',  params: (m) => ({ id: m[1] }) },
  { pattern: /^#\/settings$/,                  view: 'settings',  nav: 'settings' },
];

const loaders = {
  list: () => import('./views/list.js'),
  editor: () => import('./views/editor.js'),
  detail: () => import('./views/detail.js'),
  analytics: () => import('./views/analytics.js'),
  history: () => import('./views/history.js'),
  settings: () => import('./views/settings.js'),
};

const viewEl = qs('#view');
const titleEl = qs('#topbar-title');
const subEl = qs('#topbar-sub');
const actionsEl = qs('#topbar-actions');
const backBtn = qs('#btn-back');
const themeBtn = qs('#btn-theme');

let guard = null;
let suppressHashChange = false;
let renderToken = 0;

/* ---------------- topbar ---------------- */

function setTopbar({ title, sub = '', back = false, actions = [] }) {
  titleEl.textContent = title;
  subEl.textContent = sub;
  document.title = title === 'Challans' ? 'Challan Book' : `${title} · Challan Book`;
  backBtn.hidden = !back;
  actionsEl.innerHTML = actions
    .map((a) => html`<button class="icon-btn" data-topbar-action="${a.id}" aria-label="${a.label}">
      <svg viewBox="0 0 24 24" aria-hidden="true">${raw(a.icon)}</svg></button>`)
    .join('');
}

function setNav(key) {
  qsa('[data-nav]').forEach((n) => {
    const on = n.dataset.nav === key;
    n.classList.toggle('is-active', on);
    if (on) n.setAttribute('aria-current', 'page');
    else n.removeAttribute('aria-current');
  });
}

/* ---------------- navigation ---------------- */

function navigate(hash, { replace = false, reload = false } = {}) {
  if (location.hash === hash) {
    if (reload) route();
    return;
  }
  guard = null; // an in-app navigation has already dealt with any prompt
  if (replace) {
    history.replaceState(null, '', hash);
    route();
  } else {
    location.hash = hash;
  }
}

const setGuard = (fn) => { guard = fn; };

/* ---------------- routing ---------------- */

async function route() {
  const hash = location.hash || '#/invoices';
  const match = ROUTES.map((r) => ({ r, m: hash.match(r.pattern) })).find((x) => x.m);

  if (!match) {
    navigate('#/invoices', { replace: true });
    return;
  }

  const { r, m } = match;
  const token = ++renderToken;
  guard = null;

  setNav(r.nav);
  viewEl.classList.remove('view-enter');

  try {
    const settings = await getSettings();
    const mod = await loaders[r.view]();
    if (token !== renderToken) return; // a newer navigation won

    viewEl.innerHTML = '';
    await mod.render(viewEl, {
      params: r.params ? r.params(m) : {},
      settings,
      navigate,
      setTopbar,
      setGuard,
      reload: () => route(),
    });

    if (token !== renderToken) return;
    void viewEl.offsetWidth; // restart the entry animation
    viewEl.classList.add('view-enter');
    viewEl.scrollTop = 0;
    window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
  } catch (err) {
    if (token !== renderToken) return;
    console.error(err);
    viewEl.innerHTML = html`
      <div class="empty">
        <div class="empty__icon"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 16.5v.01"/></svg></div>
        <h3>Something went wrong</h3>
        <p>${esc(err.message || 'This screen could not be opened.')}</p>
        <button class="btn btn--primary" id="retry">Try again</button>
      </div>`;
    qs('#retry')?.addEventListener('click', () => route());
  }
}

window.addEventListener('hashchange', async (e) => {
  if (suppressHashChange) { suppressHashChange = false; return; }
  if (guard) {
    const allowed = await guard();
    if (!allowed) {
      suppressHashChange = true;
      history.replaceState(null, '', new URL(e.oldURL).hash || '#/invoices');
      return;
    }
    guard = null;
  }
  route();
});

backBtn.addEventListener('click', () => {
  if (history.length > 1) history.back();
  else navigate('#/invoices', { replace: true });
});

// Intercept in-app links so the guard runs before the hash changes.
document.addEventListener('click', async (e) => {
  const link = e.target.closest('a[href^="#/"]');
  if (!link || !guard) return;
  e.preventDefault();
  const allowed = await guard();
  if (!allowed) return;
  guard = null;
  location.hash = link.getAttribute('href');
});

window.addEventListener('beforeunload', (e) => {
  if (!guard) return;
  e.preventDefault();
  e.returnValue = '';
});

/* ---------------- theme toggle ---------------- */

const SUN_ICON = '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.2v2.3M12 19.5v2.3M4.6 4.6l1.6 1.6M17.8 17.8l1.6 1.6M2.2 12h2.3M19.5 12h2.3M4.6 19.4l1.6-1.6M17.8 6.2l1.6-1.6"/>';
const MOON_ICON = '<path d="M20.5 14.6A8.6 8.6 0 0 1 9.4 3.5a8.6 8.6 0 1 0 11.1 11.1z"/>';

// The button always offers the other skin, so one tap flips light <-> dark
// even when the preference is still following the system.
let themePref = 'system';

onThemeChange((theme) => {
  themePref = theme;
  const next = flipTheme(theme);
  themeBtn.querySelector('[data-theme-icon]').innerHTML = next === 'dark' ? MOON_ICON : SUN_ICON;
  themeBtn.setAttribute('aria-label', next === 'dark' ? 'Switch to dark theme' : 'Switch to light theme');
  themeBtn.title = next === 'dark' ? 'Dark theme' : 'Light theme';
});

themeBtn.addEventListener('click', async () => {
  const next = flipTheme(themePref);
  applyTheme(next);
  await saveSettings({ ui: { theme: next } });
});

/* ---------------- chrome ---------------- */

const topbar = qs('#topbar');
const onScroll = () => topbar.classList.toggle('is-stuck', window.scrollY > 4);
window.addEventListener('scroll', onScroll, { passive: true });
onScroll();

let installPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
  window.werksInstall = async () => {
    if (!installPrompt) return false;
    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    installPrompt = null;
    return outcome === 'accepted';
  };
});

window.addEventListener('online', () => toast('Back online', { kind: 'good', duration: 1800 }));

/* ---------------- boot ---------------- */

async function boot() {
  try {
    await openDB();
  } catch (err) {
    viewEl.innerHTML = html`
      <div class="empty">
        <div class="empty__icon"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 16.5v.01"/></svg></div>
        <h3>Storage unavailable</h3>
        <p>${esc(err.message || 'This browser blocked local storage, so challans cannot be saved. Private browsing often causes this.')}</p>
      </div>`;
    return;
  }

  const settings = await getSettings();
  applyTheme(settings.ui.theme);
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', async () => {
    const s = await getSettings();
    if (s.ui.theme === 'system') applyTheme('system');
  });

  await route();

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    try {
      const reg = await navigator.serviceWorker.register('sw.js', { scope: './' });
      reg.addEventListener('updatefound', () => {
        const sw = reg.installing;
        sw?.addEventListener('statechange', () => {
          if (sw.state === 'installed' && navigator.serviceWorker.controller) {
            toast('Update ready', {
              duration: 8000,
              actionLabel: 'Reload',
              onAction: () => { sw.postMessage({ type: 'SKIP_WAITING' }); location.reload(); },
            });
          }
        });
      });
    } catch (err) {
      console.warn('Service worker registration failed', err);
    }
  }
}

boot();

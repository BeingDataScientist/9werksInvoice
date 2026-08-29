# Challan Book

An offline-first Progressive Web App that replaces a paper challan book. Create,
view and edit challans on the phone; every change is written to a plain-language
audit trail; challans print to a PDF laid out like the printed book; and
everything is stored on the device — nothing is uploaded anywhere.

**Install it:** <https://beingdatascientist.github.io/9werksInvoice/> — open on a
phone, then *browser menu → Install app / Add to Home Screen*.

The app ships with no business details of its own. Each shop enters its own
name, address, contacts, terms and logo under Settings, and those are what
appear on its challans.

---

## What it does

**Your shop**
- Name, tagline, address, phone numbers and terms are entered under Settings —
  nothing is pre-filled, and a first-run prompt points the way there.
- Upload a logo and it is downscaled, flattened onto white and converted to
  grey, then printed at the top of every challan and beside the signature.
  Challans are black-and-white documents, so that is what the logo becomes.
- The logo is stored with the settings, so it travels inside a backup.

**Challans**
- Create, view and edit challans with the same fields as the book — To/M/s.,
  Address, Vehicle, Challan No., Date, Veh No., Km, and the Sr/Particulars/
  Quantity/Rate/Amount table.
- Amount follows `Quantity × Rate` when both are filled, and is otherwise taken
  as typed — which is how the paper book is actually used.
- Cancel a challan and it stays in the list, marked cancelled, keeping its
  number reserved. Restore it any time.

**Challan numbering** — the part the book depends on
- The next number is filled in automatically and only committed on save, so an
  abandoned draft never eats a number.
- Duplicates are **blocked**, with a one-tap fix that inserts the right number.
- Skipping a number **warns** first and names the gap it would leave.
- Reusing the number of a cancelled challan warns — a voided page in a book is
  not written on again.
- Optional series prefix with `{FY}` / `{YY}` / `{MM}` tokens, a digit count
  (3 prints `34` as `034`), a starting number, and an optional restart each
  financial year (1 April) or calendar year.
- **Challan book health** in Analytics shows every number as a cell — used,
  cancelled, missing or duplicated — so a hole in the book is visible at a glance.

**Audit history**
- Every create, edit, cancellation, restore, PDF export and backup is recorded.
- Written as sentences, not field dumps: *"Customer changed from Ajinkya to
  Rahul"*, *"Added 'Wheel Alignment' — ₹800"*.
- Readable in **English, हिन्दी and मराठी**. Events store raw values, so
  switching language re-renders the entire history, including old entries.
- Exportable as a plain text file in the chosen language.

**PDF**
- Vector PDF drawn to match the printed challan, in A5 (book size) or A4.
- Saved **where you choose**: pick a default folder once and every PDF goes
  straight there, or get a save dialog each time. Falls back to a normal
  download where the browser doesn't support folder access.
- Also share to WhatsApp/Drive/mail via the phone's share sheet, preview, or print.
- Long challans paginate automatically.

**Analytics**
- Billed per month, top services & parts, top customers, payment mode split,
  and outstanding balance, over 3 months / 12 months / this FY / all time.
- Every chart has a **Table** toggle, so no number is locked behind a colour.

**Backup**
- One `.zip` with everything: challans, full history, learned suggestions and
  settings as JSON, **plus** CSV and plain-text copies that open in Excel or
  Notepad without this app.
- Restore by **merge** (keep what's here, add what's missing, newest edit wins)
  or **replace** (wipe first, load the backup verbatim).

**Type-ahead**
- Every part, service, customer and vehicle you enter is remembered. Typing
  offers past entries — ranked by how often you use them, matched loosely so
  `rks` finds *Rear Kit Set* — and picking one fills in the last rate used.

**Interface**
- Responsive: bottom tab bar on the phone, sidebar on desktop.
- Animated throughout, and all of it disabled under `prefers-reduced-motion`.
- Dark and light themes, following the system by default.

---

## Running it

The app is plain static files — no build step, no dependencies to install.
It does need to be served over `http://` (ES modules and service workers do not
work from `file://`).

```bash
node tools/serve.mjs          # http://localhost:5173
```

### On a phone

Quick look, same Wi-Fi — find this machine's LAN IP (`ipconfig`) and open
`http://<that-ip>:5173`. Everything works except the parts browsers gate behind
a "secure origin": offline mode, home-screen install, the folder picker and the
share sheet. A bare LAN IP is not a secure origin; `localhost` and `https://` are.

Full PWA, including install and offline:

```bash
node tools/tunnel.mjs         # prints an https://…trycloudflare.com link
```

Open that link on the phone, then *browser menu → Install app*. Needs
`tools/cloudflared.exe` once — the script prints the download URL if it is
missing.

**The tunnel URL changes every run.** Browsers key stored data to the URL, so
challans saved under one link do not appear under the next one. For throwaway
testing that is fine; before entering anything you want to keep, either deploy
to a fixed URL (below) or take a backup (Settings → *Back up now*) and restore
it on the new link.

### GitHub Pages

Already enabled, serving `main` from `/` at
<https://beingdatascientist.github.io/9werksInvoice/>. Pushing to `main`
redeploys within a minute or two; bump `VERSION` in `sw.js` so installed copies
pick the change up.

---

## Your data

Everything lives in IndexedDB on the device. There is no server, no account and
no network call — the app works in airplane mode. Which also means:

- **The only copy is on that phone.** Take backups.
- Settings → *Keep this data safe* asks the browser not to evict the storage.
- Clearing the browser's site data deletes everything. So does uninstalling.

---

## Layout

```
index.html              app shell
manifest.webmanifest    PWA manifest
sw.js                   service worker — precaches everything for offline use
css/styles.css          design system: tokens, layout, animation
js/
  app.js                hash router + bootstrap
  store.js              IndexedDB access, settings
  repo.js               domain ops — save/delete/restore, learned suggestions
  challan.js            numbering: format, next number, validation, book health
  audit.js              change diffing + plain-language rendering (en/hi/mr)
  pdf.js                the challan PDF, drawn with jsPDF
  backup.js             zip export/import
  charts.js             small SVG charts
  ac.js                 type-ahead component
  theme.js              light/dark
  logo.js               shop logo: downscale, flatten, greyscale
  validate.js           field sanitising and validation
  views/                list, detail, editor, analytics, history, settings
vendor/                 jsPDF + JSZip, vendored so the app works offline
tools/serve.mjs         zero-dependency dev server
tools/tunnel.mjs        serve + HTTPS tunnel for phone testing
```

### Notes for future edits

- **PDF glyphs.** jsPDF's built-in fonts are WinAnsi-encoded: no `₹`, no
  Devanagari. Amounts print as bare numbers, like the book. Embedding a Unicode
  font would be needed before printing Hindi/Marathi text or a rupee sign.
- **Charts** use the app's blue series colour, never the brand amber — amber is
  interface chrome. Charts are single-series so colour never carries meaning
  alone, and each has a table view.
- **Save-to-folder** uses the File System Access API (Chrome/Edge, including
  Android). Elsewhere it falls back to the browser's download folder.
- Bumping `VERSION` in `sw.js` forces clients to pick up new files.

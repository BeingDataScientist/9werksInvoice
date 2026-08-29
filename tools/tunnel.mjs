// Serve the app and expose it over HTTPS via a Cloudflare quick tunnel, so a
// phone can install it as a real PWA (install + offline need a secure origin,
// which a plain http://192.168.x.x address is not).
//
//   node tools/tunnel.mjs
//
// Needs tools/cloudflared.exe. Download once from:
//   https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe
//
// The URL is different every run. Browsers key stored data to the URL, so
// challans saved under one tunnel URL will NOT appear under the next one —
// take a backup (Settings > Back up now) before restarting, and restore it
// on the new URL.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PORT = Number(process.argv[2]) || 5173;
const BIN = resolve(ROOT, 'tools/cloudflared.exe');

if (!existsSync(BIN)) {
  console.error('cloudflared.exe not found at tools/cloudflared.exe');
  console.error('Download it from:');
  console.error('  https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe');
  process.exit(1);
}

const server = spawn(process.execPath, [resolve(ROOT, 'tools/serve.mjs'), String(PORT)], { stdio: 'inherit' });
const tunnel = spawn(BIN, ['tunnel', '--url', `http://localhost:${PORT}`, '--no-autoupdate'], {
  stdio: ['ignore', 'pipe', 'pipe'],
});

let announced = false;
const scan = (chunk) => {
  const text = chunk.toString();
  const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
  if (match && !announced) {
    announced = true;
    const url = match[0];
    console.log('');
    console.log('  '.padEnd(2) + '='.repeat(58));
    console.log('   Open this on your phone:');
    console.log('');
    console.log(`      ${url}`);
    console.log('');
    console.log('   Then: browser menu > Install app / Add to Home screen.');
    console.log('   Leave this window open — closing it kills the link.');
    console.log('  '.padEnd(2) + '='.repeat(58));
    console.log('');
  }
};
tunnel.stdout.on('data', scan);
tunnel.stderr.on('data', scan);

const shutdown = () => {
  try { tunnel.kill(); } catch { /* already gone */ }
  try { server.kill(); } catch { /* already gone */ }
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
tunnel.on('exit', shutdown);

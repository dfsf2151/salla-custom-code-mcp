#!/usr/bin/env node
// Local MCP server: read/write a Salla store's custom CSS and JS (theme editor → Advanced customization).
// Salla's public API and hosted MCP have no endpoint for this, so requests run *inside* a logged-in
// s.salla.sa tab of a dedicated Chromium profile (driven over CDP); the dashboard token never leaves the browser.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const STORE_ID = process.env.SALLA_STORE_ID;               // guard: refuse to act on any other store
const VERSION_ID = process.env.SALLA_VERSION_ID;           // default theme version (the published one)
const PROFILE = process.env.SALLA_PROFILE || 'default';
const PORT = Number(process.env.SALLA_CDP_PORT || 9333);
const CHROME = process.env.SALLA_CHROME || join(homedir(), '.cache/ms-playwright/chromium-1248/chrome-linux64/chrome');
const CONFIG_DIR = join(homedir(), '.config', 'salla-custom-code');
const PROFILE_DIR = join(CONFIG_DIR, `profile-${PROFILE}`);
const BACKUP_DIR = join(CONFIG_DIR, 'backups', PROFILE);
const API = 'https://api.salla.dev/admin/v2';

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function listTargets() {
  try { return await (await fetch(`http://localhost:${PORT}/json/list`)).json(); } catch { return null; }
}

function launchBrowser() {
  const child = spawn(CHROME, [
    `--user-data-dir=${PROFILE_DIR}`, `--remote-debugging-port=${PORT}`,
    '--no-first-run', '--no-default-browser-check', 'https://s.salla.sa/',
  ], { detached: true, stdio: 'ignore' });
  child.unref();
}

// Returns a CDP websocket URL for a tab on s.salla.sa, launching the browser if needed.
async function dashboardTab() {
  let targets = await listTargets();
  if (!targets) {
    launchBrowser();
    for (let i = 0; i < 30 && !(targets = await listTargets()); i++) await sleep(500);
    if (!targets) throw new Error(`Could not start Chromium on port ${PORT}`);
  }
  for (let i = 0; i < 40; i++) {
    const tab = targets.find(t => t.type === 'page' && t.url.startsWith('https://s.salla.sa/') && !t.url.includes('/auth'));
    if (tab) return tab.webSocketDebuggerUrl;
    if (targets.some(t => t.type === 'page' && t.url.includes('s.salla.sa/auth')))
      throw new Error('Salla dashboard is not logged in. Log in to the store in the Chromium window, then retry.');
    await sleep(500);
    targets = await listTargets() ?? [];
  }
  throw new Error('No s.salla.sa tab found in the Chromium window. Open https://s.salla.sa/ there and retry.');
}

// Runs one dashboard API call inside the logged-in tab and returns the parsed JSON body.
async function dashboardRequest(method, path, versionId, body) {
  const ws = new WebSocket(await dashboardTab());
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('CDP connection failed')); });
  const expression = `(async () => {
    const raw = localStorage.user;
    if (!raw) return { error: 'not_logged_in' };
    const { token } = JSON.parse(raw);
    const claims = JSON.parse((() => { const s = atob(token.split('.')[2].replace(/-/g, '+').replace(/_/g, '/')); return s.slice(0, s.length - 64); })());
    if (${JSON.stringify(STORE_ID ?? null)} && String(claims.store) !== ${JSON.stringify(STORE_ID ?? '')})
      return { error: 'wrong_store', store: String(claims.store) };
    if (new Date(claims.exp) < new Date()) return { error: 'token_expired' };
    const res = await fetch(${JSON.stringify(API)} + ${JSON.stringify(path)} + '?version_id=' + ${JSON.stringify(String(versionId))}, {
      method: ${JSON.stringify(method)},
      headers: { Authorization: 'Bearer ' + token, Accept: 'application/json', 'Content-Type': 'application/json',
                 's-source': 'merchant-dashboard', 's-store-id': String(claims.store), 's-app-version': '1.0.0' },
      body: ${body === undefined ? 'undefined' : JSON.stringify(JSON.stringify(body))},
    });
    const text = await res.text();
    try { return { status: res.status, json: JSON.parse(text) }; } catch { return { status: res.status, text: text.slice(0, 500) }; }
  })()`;
  ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
  const msg = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Dashboard request timed out')), 30000);
    ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id === 1) { clearTimeout(timer); resolve(m); } };
  });
  ws.close();
  const out = msg.result?.result?.value;
  if (!out) throw new Error(msg.result?.exceptionDetails?.exception?.description || 'Dashboard request failed');
  if (out.error === 'not_logged_in' || out.error === 'token_expired')
    throw new Error('Salla dashboard session is missing or expired. Log in again in the Chromium window, then retry.');
  if (out.error === 'wrong_store')
    throw new Error(`The Chromium window is logged into store ${out.store}, not ${STORE_ID}. Nothing was changed.`);
  if (out.status >= 400 || out.json?.success === false)
    throw new Error(`Salla API ${out.status}: ${JSON.stringify(out.json ?? out.text).slice(0, 500)}`);
  return out.json;
}

function backup(kind, versionId, content) {
  mkdirSync(BACKUP_DIR, { recursive: true });
  const file = join(BACKUP_DIR, `${kind}-${versionId}-${new Date().toISOString().replace(/[:.]/g, '-')}.${kind}`);
  writeFileSync(file, content ?? '');
  return file;
}

const versionArg = z.union([z.string(), z.number()]).optional()
  .describe(`Theme version ID (from theme_versions_list). Defaults to ${VERSION_ID ?? 'SALLA_VERSION_ID'}.`);
const resolveVersion = v => {
  const id = v ?? VERSION_ID;
  if (!id) throw new Error('version_id is required (no SALLA_VERSION_ID default configured)');
  return id;
};
const text = t => ({ content: [{ type: 'text', text: t }] });

const server = new McpServer({ name: `salla-custom-code-${PROFILE}`, version: '1.0.0' });

server.registerTool('custom_css_get', {
  description: `Read the store's custom CSS (theme editor → Advanced customization → CSS) for store ${STORE_ID ?? ''}.`,
  inputSchema: { version_id: versionArg },
}, async ({ version_id }) => {
  const res = await dashboardRequest('GET', '/design/custom/css', resolveVersion(version_id));
  return text(res?.data?.css ?? '');
});

server.registerTool('custom_css_update', {
  description: 'Replace the store\'s entire custom CSS. Changes are live on the published version as soon as they are saved. ' +
    'Always read the current CSS first and pass the full new stylesheet (not a fragment). The previous CSS is backed up locally before saving. ' +
    'Show the merchant the change and get their OK before calling.',
  inputSchema: { css: z.string().describe('The complete new CSS.'), version_id: versionArg },
}, async ({ css, version_id }) => {
  const id = resolveVersion(version_id);
  const before = (await dashboardRequest('GET', '/design/custom/css', id))?.data?.css ?? '';
  const file = backup('css', id, before);
  await dashboardRequest('POST', '/design/custom/css', id, { css });
  const after = (await dashboardRequest('GET', '/design/custom/css', id))?.data?.css ?? '';
  return text(`Saved custom CSS for version ${id} (${before.length} → ${after.length} chars; verified ${after === css ? 'identical' : 'DIFFERENT from input'}). Backup of previous CSS: ${file}`);
});

server.registerTool('custom_js_get', {
  description: `Read the store's custom JavaScript for store ${STORE_ID ?? ''}. ` +
    'Whether it is enabled is the version\'s custom_js_enabled flag in the Salla MCP\'s theme_versions_list.',
  inputSchema: { version_id: versionArg },
}, async ({ version_id }) => {
  const res = await dashboardRequest('GET', '/design/custom/js', resolveVersion(version_id));
  return text(res?.data?.js ?? '');
});

server.registerTool('custom_js_update', {
  description: 'Replace the store\'s entire custom JavaScript. Runs on every storefront page once saved (if custom JS is enabled). ' +
    'Always read the current JS first and pass the full new script. The previous JS is backed up locally before saving. ' +
    'Show the merchant the change and get their OK before calling.',
  inputSchema: { js: z.string().describe('The complete new JavaScript.'), version_id: versionArg },
}, async ({ js, version_id }) => {
  const id = resolveVersion(version_id);
  const before = (await dashboardRequest('GET', '/design/custom/js', id))?.data?.js ?? '';
  const file = backup('js', id, before);
  await dashboardRequest('POST', '/design/custom/js', id, { js });
  const after = (await dashboardRequest('GET', '/design/custom/js', id))?.data?.js ?? '';
  return text(`Saved custom JS for version ${id} (${before.length} → ${after.length} chars; verified ${after === js ? 'identical' : 'DIFFERENT from input'}). Backup of previous JS: ${file}`);
});

server.registerTool('custom_js_toggle', {
  description: 'Turn the store\'s custom JavaScript on or off without changing the code. Get the merchant\'s OK first.',
  inputSchema: { enabled: z.boolean(), version_id: versionArg },
}, async ({ enabled, version_id }) => {
  const res = await dashboardRequest('PUT', '/design/custom/js/toggle', resolveVersion(version_id), { enabled });
  return text(`Custom JS is now ${res?.data?.enabled ? 'enabled' : 'disabled'}.`);
});

if (!existsSync(CHROME)) console.error(`warning: Chromium not found at ${CHROME}; set SALLA_CHROME`);
await server.connect(new StdioServerTransport());

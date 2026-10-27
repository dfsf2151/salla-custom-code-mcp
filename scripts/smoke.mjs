// Read-only smoke test: lists tools and calls the two *_get tools over stdio.
// usage: SALLA_STORE_ID=... SALLA_VERSION_ID=... node scripts/smoke.mjs
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
for (const k of ['SALLA_STORE_ID', 'SALLA_VERSION_ID'])
  if (!process.env[k]) { console.error(`Set ${k}`); process.exit(1); }
const client = new Client({ name: 'smoke', version: '1' });
await client.connect(new StdioClientTransport({ command: 'node', args: ['server.mjs'], env: process.env }));
console.log('tools:', (await client.listTools()).tools.map(t => t.name).join(', '));
const css = (await client.callTool({ name: 'custom_css_get', arguments: {} })).content[0].text;
console.log('css chars:', css.length, '| starts:', css.slice(0, 80));
const js = (await client.callTool({ name: 'custom_js_get', arguments: {} })).content[0].text;
console.log('js:', js.length, 'chars | head:', js.slice(0, 160).replace(/\n/g, ' ⏎ '));
await client.close();

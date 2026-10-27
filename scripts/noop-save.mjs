// Write-path test that changes nothing: reads the current CSS and saves it back unchanged.
// usage: SALLA_STORE_ID=... SALLA_VERSION_ID=... node scripts/noop-save.mjs
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
for (const k of ['SALLA_STORE_ID', 'SALLA_VERSION_ID'])
  if (!process.env[k]) { console.error(`Set ${k}`); process.exit(1); }
const client = new Client({ name: 'noop-save', version: '1' });
await client.connect(new StdioClientTransport({ command: 'node', args: ['server.mjs'], env: process.env }));
const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args });
  if (r.isError) throw new Error(r.content[0].text);
  return r.content[0].text;
};
const css = await call('custom_css_get');
console.log('before:', css.length, 'chars');
console.log(await call('custom_css_update', { css }));
const after = await call('custom_css_get');
console.log('after:', after.length, 'chars | identical:', after === css);
await client.close();

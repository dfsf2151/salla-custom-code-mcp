// Uploads local image files to a product via the dashboard session (in-page fetch over CDP).
// usage: node scripts/upload-images.mjs <productId> <alt> <file1> [file2 ...]   (first file becomes the main image)
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

const [productId, alt, ...files] = process.argv.slice(2);
const list = await (await fetch('http://localhost:9333/json/list')).json();
const page = list.find(t => t.type === 'page' && t.url.startsWith('https://s.salla.sa/'));
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let id = 0;
const evaluate = expression => new Promise(resolve => {
  const i = ++id;
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id === i) resolve(m.result?.result?.value ?? m.result); };
  ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
});

for (const [n, file] of files.entries()) {
  const b64 = readFileSync(file).toString('base64');
  const out = await evaluate(`(async () => {
    const { token } = JSON.parse(localStorage.user);
    const bytes = Uint8Array.from(atob(${JSON.stringify(b64)}), c => c.charCodeAt(0));
    const fd = new FormData();
    fd.append('photo', new Blob([bytes], { type: 'image/webp' }), ${JSON.stringify(basename(file))});
    fd.append('alt', ${JSON.stringify(alt)});
    fd.append('sort', '${n + 1 + Number(process.env.SORT_OFFSET || 0)}');
    if (${n === 0 && !process.env.SORT_OFFSET}) fd.append('default', '1');
    const res = await fetch('https://api.salla.dev/admin/v2/products/${productId}/images', {
      method: 'POST', headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' }, body: fd });
    return res.status + ' ' + (await res.text()).slice(0, 300);
  })()`);
  console.log(basename(file), '→', typeof out === 'string' ? out : JSON.stringify(out).slice(0, 300));
}
ws.close();

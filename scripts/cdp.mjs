// usage: node scripts/cdp.mjs <navigate URL|eval JS|watch SECONDS> ; logs XHR/fetch traffic
const [cmd, arg] = process.argv.slice(2);
const list = await (await fetch('http://localhost:9333/json/list')).json();
const page = list.find(t => t.type === 'page' && t.url.includes('salla'));
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pending = new Map(); const reqs = new Map();
const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
ws.onmessage = e => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Network.requestWillBeSent') {
    const r = m.params.request; if (process.env.ALL ? false : !['XHR', 'Fetch'].includes(m.params.type)) return; if (r.url.startsWith('data:') || /\.(png|svg|woff2?|jpe?g|webp|gif|css)(\?|$)/.test(r.url)) return;
    reqs.set(m.params.requestId, r);
    console.log('>>', r.method, r.url.slice(0, 200), r.postData ? 'BODY:' + r.postData.slice(0, 300) : '');
  }
  if (m.method === 'Network.responseReceived' && reqs.has(m.params.requestId))
    console.log('<<', m.params.response.status, m.params.response.url.slice(0, 200));
};
await new Promise(r => ws.onopen = r);
await send('Network.enable');
const wait = s => new Promise(r => setTimeout(r, s * 1000));
if (cmd === 'navigate') { await send('Page.navigate', { url: arg }); await wait(Number(process.env.WAIT || 12)); }
else if (cmd === 'eval') { const res = await send('Runtime.evaluate', { expression: arg, awaitPromise: true, returnByValue: true }); console.log(JSON.stringify(res.result?.result?.value ?? res.result, null, 1)); }
else if (cmd === 'watch') await wait(Number(arg || 15));
else if (cmd === 'shot') { const res = await send('Page.captureScreenshot', { format: 'png' }); (await import('node:fs')).writeFileSync(arg, Buffer.from(res.result.data, 'base64')); console.log('saved', arg); }
ws.close(); process.exit(0);

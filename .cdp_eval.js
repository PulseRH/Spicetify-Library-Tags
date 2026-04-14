// CDP debug helper for Spotify's Chromium runtime.
// Usage: node .cdp_eval.js "javascript expression"
// Requires Spotify launched with --remote-debugging-port=9222.
const WebSocket = require('ws');
const http = require('http');
const expr = process.argv[2];
http.get('http://localhost:9222/json', res => {
  let d = '';
  res.on('data', c => d += c);
  res.on('end', () => {
    const ws = new WebSocket(JSON.parse(d)[0].webSocketDebuggerUrl);
    ws.on('open', () => ws.send(JSON.stringify({
      id: 1,
      method: 'Runtime.evaluate',
      params: {
        expression: `(async () => { ${expr} })()`,
        awaitPromise: true,
        returnByValue: true,
      },
    })));
    ws.on('message', m => {
      const r = JSON.parse(m).result?.result;
      console.log(JSON.stringify(r?.value, null, 2));
      ws.close();
    });
  });
});

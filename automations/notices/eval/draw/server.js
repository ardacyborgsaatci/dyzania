// Redraws the 12 invented notices in ../samples from the "print" instructions in ../notices.json.
//   node eval/draw/server.js        then open http://localhost:4180/draw.html in any browser
// The page draws each notice on a canvas (the instructions say what is printed; nothing is read from a real document)
// and posts the PNG back here, which saves it into ../samples. Needs only Node. Stop it with Ctrl+C.
const http = require('http');
const fs = require('fs');
const path = require('path');
const EVAL = path.join(__dirname, '..');
http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  if (req.method === 'GET' && u === '/draw.html') { res.setHeader('content-type', 'text/html'); return res.end(fs.readFileSync(path.join(__dirname, 'draw.html'))); }
  if (req.method === 'GET' && u === '/notices.json') { res.setHeader('content-type', 'application/json'); return res.end(fs.readFileSync(path.join(EVAL, 'notices.json'))); }
  if (req.method === 'POST' && u.startsWith('/save/')) {
    const name = path.basename(u.slice(6));
    if (!/^N\d\d\.png$/.test(name)) { res.statusCode = 400; return res.end('bad name'); }
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      fs.mkdirSync(path.join(EVAL, 'samples'), { recursive: true });
      const buf = Buffer.from(body, 'base64');
      fs.writeFileSync(path.join(EVAL, 'samples', name), buf);
      res.end('saved ' + name + ' ' + buf.length);
    });
    return;
  }
  res.statusCode = 404; res.end('no');
}).listen(4180, '127.0.0.1', () => console.log('listening on http://localhost:4180/draw.html'));

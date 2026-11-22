// Local stand-in for Supabase's gateway: forwards /rest/v1/* to PostgREST (which serves at the root). 127.0.0.1 only. node proxy.mjs <listenPort> <postgrestPort>
import http from 'node:http';
const [listen, target] = process.argv.slice(2).map(Number);
http.createServer((req, res) => {
  const path = req.url.replace(/^\/rest\/v1/, '') || '/';
  const up = http.request({ host: '127.0.0.1', port: target, method: req.method, path, headers: req.headers }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
  up.on('error', (e) => { res.writeHead(502); res.end(JSON.stringify({ message: 'bad gateway: ' + e.message })); });
  req.pipe(up);
}).listen(listen, '127.0.0.1');

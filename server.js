// Optional read-only browser preview. Desktop SQLite is the only writable store.
'use strict';
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=__dirname,port=Number(process.env.PORT)||3001;
const types={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.woff2':'font/woff2'};
http.createServer((req,res)=>{
  if(!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.host||'')){res.writeHead(403);return res.end('Forbidden host');}
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{Allow:'GET, HEAD'});return res.end('Read-only preview. Use the Windows app to save.');}
  let rel;try{rel=decodeURIComponent(new URL(req.url,'http://localhost').pathname).replace(/^\//,'')||'index.html';}catch{res.writeHead(400);return res.end('Bad URL');}
  if(!/^(index\.html|(?:css|shared|js|assets|lib)\/[\w./-]+)$/.test(rel)||rel.split('/').some(s=>s==='..'||s.startsWith('.'))){res.writeHead(404);return res.end('Not found');}
  const filename=path.resolve(root,rel),type=types[path.extname(filename)];if(!filename.startsWith(root+path.sep)||!type){res.writeHead(404);return res.end('Not found');}
  fs.readFile(filename,(err,data)=>{if(err){res.writeHead(404);return res.end('Not found');}res.writeHead(200,{'Content-Type':type,'X-Content-Type-Options':'nosniff','Cache-Control':'no-store'});res.end(req.method==='HEAD'?undefined:data);});
}).listen(port,'127.0.0.1',()=>console.log(`Read-only browser preview: http://localhost:${port}. Run the desktop app for billing.`)).on('error',e=>{console.error('Preview could not start:',e.message);process.exitCode=1;});

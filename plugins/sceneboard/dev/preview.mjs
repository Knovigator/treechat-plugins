#!/usr/bin/env node
// Local preview: serves the board template with an in-memory stand-in for the claude.ai runtime
// (db with live snapshots, user), seeded from a scenes.json + meta.json. No sign-in needed.
//   node dev/preview.mjs [examples/demo] [--port 4321]
// POST /_db/<collection>/<doc> with a JSON body writes a row, so tests (and you) can watch the page update live.
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve, extname, normalize } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const args = process.argv.slice(2);
const pi = args.indexOf('--port');
const port = pi >= 0 ? Number(args[pi + 1]) : 4321;
const dir = resolve(args.find((a, i) => !a.startsWith('--') && (pi < 0 || i !== pi + 1)) || join(root, 'examples/demo'));

const rows = {};
const put = (path, data) => { rows[path] = data; };
const scenes = JSON.parse(readFileSync(join(dir, 'scenes.json'), 'utf8'));
for (const { id, ...s } of scenes) put(`scenes/${id}`, s);
if (existsSync(join(dir, 'meta.json'))) put('board/meta', JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8')));
let version = 0;

const MOCK = `<script>
(()=>{const subs=[];let rows={},ver=-1;
const snapDoc=(p)=>({id:p.split('/').pop(),exists:p in rows,data:()=>rows[p]?JSON.parse(JSON.stringify(rows[p])):undefined});
const inColl=(c)=>Object.keys(rows).filter(p=>p.slice(0,p.lastIndexOf('/'))===c);
const fire=()=>subs.forEach(s=>s());
async function poll(){try{const r=await fetch('/_db');const j=await r.json();if(j.version!==ver){ver=j.version;rows=j.rows;fire()}}catch(e){}setTimeout(poll,400)}
const write=(p,d)=>fetch('/_db/'+p,{method:d===null?'DELETE':'POST',body:d===null?undefined:JSON.stringify(d)});
const doc=(p)=>({id:p.split('/').pop(),get:async()=>snapDoc(p),set:async d=>{rows[p]=d;fire();await write(p,d)},update:async d=>{rows[p]=Object.assign({},rows[p],d);fire();await write(p,rows[p])},delete:async()=>{delete rows[p];fire();await write(p,null)},
  onSnapshot:(cb)=>{const s=()=>cb(snapDoc(p));subs.push(s);if(ver>=0)s();return()=>{}}});
const coll=(c)=>({doc:(id)=>doc(c+'/'+id),add:async d=>{const id='n'+Date.now()+Math.random().toString(36).slice(2,6);await doc(c+'/'+id).set(d);return doc(c+'/'+id)},
  onSnapshot:(cb)=>{const s=()=>cb({docs:inColl(c).map(snapDoc)});subs.push(s);if(ver>=0)s();return()=>{}}});
const db={doc,collection:coll};
const user={id:async()=>'u_local',profiles:async()=>({}),isOwner:()=>true,canEdit:()=>true};
const caps={db,user};
window.claude={use:async(n)=>{await new Promise(r=>setTimeout(r,50));return caps[n]||null}};
poll();})();
</script>`;

const TYPES = { '.mp4': 'video/mp4', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.txt': 'text/plain', '.json': 'application/json', '.mp3': 'audio/mpeg' };

createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/_db' && req.method === 'GET') {
    res.setHeader('content-type', 'application/json');
    return res.end(JSON.stringify({ version, rows }));
  }
  if (url.pathname.startsWith('/_db/')) {
    const p = url.pathname.slice(5);
    if (!/^[A-Za-z0-9_\-.~:@+]+(\/[A-Za-z0-9_\-.~:@+]+)+$/.test(p) || p.split('/').length % 2) { res.statusCode = 400; return res.end('bad path'); }
    let body = '';
    req.on('data', (c) => (body += c));
    return req.on('end', () => {
      if (req.method === 'DELETE') delete rows[p];
      else { try { const d = JSON.parse(body); rows[p] = req.headers['x-merge'] ? { ...rows[p], ...d } : d; } catch { res.statusCode = 400; return res.end('bad json'); } }
      version++;
      res.end('ok');
    });
  }
  if (url.pathname === '/' || url.pathname === '/index.html') {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    return res.end('<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">' + MOCK + readFileSync(join(root, 'template/index.html'), 'utf8'));
  }
  const f = normalize(join(dir, decodeURIComponent(url.pathname)));
  if (!f.startsWith(dir + '/') || !existsSync(f) || !statSync(f).isFile()) { res.statusCode = 404; return res.end('not found'); }
  res.setHeader('content-type', TYPES[extname(f).toLowerCase()] || 'application/octet-stream');
  res.end(readFileSync(f));
}).listen(port, '127.0.0.1', () => console.log(`sceneboard preview: http://127.0.0.1:${port}/  (rows from ${dir})`));

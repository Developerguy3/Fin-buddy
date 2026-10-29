const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
test('device web updates activate fresh static assets and leave unrelated caches alone',async()=>{
 const listeners={},deleted=[];let requested=[],activated=0,claimed=0;
 class AssetRequest{constructor(url,options){this.url=url;this.cache=options.cache;}}
 const context={Request:AssetRequest,self:{skipWaiting:async()=>activated++,clients:{claim:async()=>claimed++},addEventListener:(type,fn)=>listeners[type]=fn},caches:{open:async()=>({addAll:async requests=>{requested=requests;}}),keys:async()=>['finbuddy-device-old','other-app-cache'],delete:async key=>deleted.push(key)}};
 vm.runInNewContext(fs.readFileSync('mobile/device-sw.js','utf8'),context);
 let pending;listeners.install({waitUntil:promise=>{pending=promise;}});await pending;
 assert.equal(activated,1);assert.ok(requested.length>0);assert.ok(requested.every(r=>r.cache==='reload'&&!r.url.startsWith('/api/')));
 listeners.activate({waitUntil:promise=>{pending=promise;}});await pending;
 assert.deepEqual(deleted,['finbuddy-device-old']);assert.equal(claimed,1);
});
test('install manifest includes real Android and Apple icon assets',()=>{
 const manifest=JSON.parse(fs.readFileSync('public/manifest.webmanifest','utf8'));assert.equal(manifest.display,'standalone');
 for(const icon of manifest.icons){const png=fs.readFileSync('public'+icon.src),size=Number(icon.sizes.split('x')[0]);assert.equal(png.readUInt32BE(16),size);assert.equal(png.readUInt32BE(20),size);}
 assert.ok(fs.existsSync('public/icons/apple-touch-icon.png'));
});
test('service worker never handles or caches financial API requests',()=>{
 const listeners={},context={self:{location:{origin:'https://example.test'},addEventListener:(event,fn)=>listeners[event]=fn},URL,caches:{},fetch:()=>{throw Error('API request must not reach the shell cache');}};
 vm.runInNewContext(fs.readFileSync('public/sw.js','utf8'),context);
 for(const [pathname,method] of [['/api/state','GET'],['/api/categorize','POST'],['/api/report?month=2026-10','GET']]){let handled=false;listeners.fetch({request:{url:'https://example.test'+pathname,method,mode:'cors'},respondWith:()=>{handled=true;}});assert.equal(handled,false);}
});

const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
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

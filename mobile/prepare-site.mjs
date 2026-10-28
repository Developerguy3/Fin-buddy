// Keep large local AI assets beneath static hosting's per-file upload limit.
// This changes the hosted copy only; native apps retain their bundled files.
import fs from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..'),out=path.join(root,'output/site/dist');
await fs.mkdir(out,{recursive:true});
await fs.cp(path.join(root,'mobile/www'),out,{recursive:true});
const manifest={};
async function walk(dir){for(const item of await fs.readdir(dir,{withFileTypes:true})){const file=path.join(dir,item.name);if(item.isDirectory()){await walk(file);continue;}const size=(await fs.stat(file)).size;if(size<=20*1024*1024)continue;const bytes=await fs.readFile(file),url='/'+path.relative(out,file).split(path.sep).join('/'),parts=[];for(let i=0;i<bytes.length;i+=20*1024*1024){const part=file+'.part'+parts.length;await fs.writeFile(part,bytes.subarray(i,i+20*1024*1024));parts.push('/'+path.relative(out,part).split(path.sep).join('/'));}manifest[url]=parts;await fs.unlink(file);}}
await walk(out);
await fs.writeFile(path.join(out,'asset-chunks.json'),JSON.stringify(manifest));
const shim=`const originalAssetFetch=globalThis.fetch.bind(globalThis);let assetChunks;globalThis.fetch=async function(input,options){const url=new URL(typeof input==='string'?input:input.url||String(input),self.location.href);assetChunks||=originalAssetFetch('/asset-chunks.json').then(r=>r.json());const parts=(await assetChunks)[url.pathname];if(!parts||url.origin!==self.location.origin)return originalAssetFetch(input,options);const buffers=[];for(const part of parts){const r=await originalAssetFetch(part,{signal:options?.signal});if(!r.ok)throw Error('Model asset download failed: '+r.status);buffers.push(await r.arrayBuffer());}return new Response(new Blob(buffers),{headers:{'Content-Type':url.pathname.endsWith('.wasm')?'application/wasm':'application/octet-stream'}});};\n`;
const worker=path.join(out,'device-model.js');await fs.writeFile(worker,shim+await fs.readFile(worker,'utf8'));
const sw=path.join(out,'device-sw.js');await fs.writeFile(sw,(await fs.readFile(sw,'utf8')).replace("SHELL.includes(path)","path==='/asset-chunks.json'||SHELL.includes(path)"));
async function list(dir,prefix=''){const files=[];for(const item of await fs.readdir(dir,{withFileTypes:true})){const rel=prefix+'/'+item.name;if(item.isDirectory())files.push(...await list(path.join(dir,item.name),rel));else if(item.name!=='offline-files.json')files.push(rel);}return files;}
await fs.writeFile(path.join(out,'offline-files.json'),JSON.stringify(await list(out)));
console.log('Prepared public browser-local app; no financial data or credentials included.');

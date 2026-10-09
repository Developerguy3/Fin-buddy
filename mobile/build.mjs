import fs from 'node:fs/promises';
import path from 'node:path';
import {build} from 'esbuild';
import {createHash} from 'node:crypto';
const root=path.resolve(import.meta.dirname,'..'),out=path.join(root,'mobile/www');await fs.mkdir(out,{recursive:true});
for(const file of await fs.readdir(path.join(root,'public'))){if(['sw.js','offline.html'].includes(file))continue;await fs.cp(path.join(root,'public',file),path.join(out,file),{recursive:true});}
let html=await fs.readFile(path.join(out,'index.html'),'utf8');html=html.replace('<head>','<head><script src="/device-engine.js"></script>');await fs.writeFile(path.join(out,'index.html'),html);
await build({entryPoints:[path.join(root,'mobile/device-entry.js')],bundle:true,outfile:path.join(out,'device-engine.js'),platform:'browser',format:'iife',alias:{'node:crypto':path.join(root,'mobile/crypto-shim.js'),'node:path':path.join(root,'mobile/path-shim.js')},minify:true});
await build({entryPoints:[path.join(root,'mobile/model-worker.js')],bundle:true,outfile:path.join(out,'device-model.js'),platform:'browser',format:'esm',minify:true});
await fs.mkdir(path.join(out,'model-runtime'),{recursive:true});
for(const file of await fs.readdir(path.join(root,'node_modules/onnxruntime-web/dist')))if(/\.(wasm|mjs)$/.test(file))await fs.copyFile(path.join(root,'node_modules/onnxruntime-web/dist',file),path.join(out,'model-runtime',file));
try{await fs.cp(path.join(root,'mobile/models'),path.join(out,'models'),{recursive:true});}catch(e){if(e.code!=='ENOENT')throw e;console.log('Model weights not bundled yet. Run npm run mobile:model.');}
const doc=path.join(out,'document-runtime');await fs.mkdir(doc,{recursive:true});
await fs.copyFile(path.join(root,'node_modules/pdfjs-dist/build/pdf.worker.min.mjs'),path.join(doc,'pdf.worker.min.mjs'));
for(const folder of ['standard_fonts','cmaps','wasm'])await fs.cp(path.join(root,'node_modules/pdfjs-dist',folder),path.join(doc,folder==='wasm'?'pdf-wasm':folder),{recursive:true});
await fs.copyFile(path.join(root,'node_modules/tesseract.js/dist/worker.min.js'),path.join(doc,'worker.min.js'));
await fs.mkdir(path.join(doc,'core'),{recursive:true});
for(const file of await fs.readdir(path.join(root,'node_modules/tesseract.js-core')))if(/\.wasm(?:\.js)?$/.test(file))await fs.copyFile(path.join(root,'node_modules/tesseract.js-core',file),path.join(doc,'core',file));
await fs.mkdir(path.join(doc,'language'),{recursive:true});await fs.copyFile(path.join(root,'node_modules/@tesseract.js-data/eng/4.0.0/eng.traineddata.gz'),path.join(doc,'language/eng.traineddata.gz'));
const version=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8')).version,cacheDigest=createHash('sha256');for(const file of await fs.readdir(out))if(/\.(html|css|js)$/.test(file)&&file!=='device-sw.js')cacheDigest.update(await fs.readFile(path.join(out,file)));const worker=(await fs.readFile(path.join(root,'mobile/device-sw.js'),'utf8')).replace('finbuddy-device-1.1.0','finbuddy-device-'+version+'-'+cacheDigest.digest('hex').slice(0,12));await fs.writeFile(path.join(out,'device-sw.js'),worker);
async function allFiles(folder,prefix=''){const result=[];for(const item of await fs.readdir(folder,{withFileTypes:true})){const relative=prefix+'/'+item.name;if(item.isDirectory())result.push(...await allFiles(path.join(folder,item.name),relative));else if(item.name!=='offline-files.json')result.push(relative);}return result;}
await fs.writeFile(path.join(out,'offline-files.json'),JSON.stringify(await allFiles(out)));
let notices='Fin Buddy third-party software notices\n\n';
for(const entry of await fs.readdir(path.join(root,'node_modules'),{withFileTypes:true})){if(!entry.isDirectory()||entry.name.startsWith('.'))continue;const packages=entry.name.startsWith('@')?(await fs.readdir(path.join(root,'node_modules',entry.name))).map(name=>entry.name+'/'+name):[entry.name];for(const name of packages){const folder=path.join(root,'node_modules',name);try{const meta=JSON.parse(await fs.readFile(path.join(folder,'package.json'),'utf8'));notices+='\n'+meta.name+' '+meta.version+' | '+(typeof meta.license==='string'?meta.license:'See package licence')+'\n';for(const file of await fs.readdir(folder))if(/^(licen[cs]e|copying|notice|thirdpartynotices)/i.test(file)){const stats=await fs.stat(path.join(folder,file));if(stats.isFile())notices+=await fs.readFile(path.join(folder,file),'utf8')+'\n';}}catch{}}}
notices+='\nModel: onnx-community/SmolLM2-135M-Instruct-ONNX\nUpstream: HuggingFaceTB/SmolLM2-135M-Instruct\nPinned conversion revision: b8a5c0f183b78c55955a5364f610c36668b5e681\nhttps://huggingface.co/HuggingFaceTB/SmolLM2-135M-Instruct\n';await fs.writeFile(path.join(out,'third-party-notices.txt'),notices);
console.log('Bundled on-device UI and local ledger engine in mobile/www. No backend address or financial data included.');

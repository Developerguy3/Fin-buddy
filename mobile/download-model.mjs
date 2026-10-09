import fs from 'node:fs/promises';
import path from 'node:path';
const model='onnx-community/SmolLM2-135M-Instruct-ONNX',base=path.join(import.meta.dirname,'models',model);
const revision='b8a5c0f183b78c55955a5364f610c36668b5e681';
const response=await fetch('https://huggingface.co/api/models/'+model+'/revision/'+revision);if(!response.ok)throw Error('Could not read model metadata: '+response.status);const metadata=await response.json();
const names=metadata.siblings.map(x=>x.rfilename).filter(name=>/^[^/]+\.(json|txt)$/.test(name)||/^(README\.md|LICENSE.*)$/.test(name)||name==='onnx/model_q4.onnx'||name==='onnx/model_q4.onnx_data');
for(const name of names){const target=path.join(base,name);try{await fs.access(target);console.log('Already downloaded '+name);continue;}catch{}
 console.log('Downloading '+name);const r=await fetch('https://huggingface.co/'+model+'/resolve/'+metadata.sha+'/'+name);if(!r.ok)throw Error(name+': '+r.status);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,new Uint8Array(await r.arrayBuffer()));}
await fs.writeFile(path.join(base,'BUNDLE-METADATA.json'),JSON.stringify({model,revision:metadata.sha,license:metadata.cardData?.license,files:names},null,2));console.log('Model weights bundled locally; no transaction data sent.');

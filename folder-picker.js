const fs=require('node:fs');const path=require('node:path');
function browseFolder(initial=''){
  const drives=process.platform==='win32'?'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(x=>x+':\\').filter(x=>fs.existsSync(x)):['/'];
  const folder=initial?path.resolve(initial):drives[0];
  if(!folder||!fs.statSync(folder).isDirectory())throw Error('Choose an existing folder.');
  const folders=fs.readdirSync(folder,{withFileTypes:true}).filter(e=>e.isDirectory()&&!e.isSymbolicLink()).map(e=>({name:e.name,path:path.join(folder,e.name)})).sort((a,b)=>a.name.localeCompare(b.name));
  const parent=path.dirname(folder);
  return {folder,parent:parent===folder?null:parent,folders,drives};
}
module.exports={browseFolder};

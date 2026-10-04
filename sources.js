const fs=require('node:fs');const path=require('node:path');
function collectSources(folders){
  const files=[],issues=[],visited=new Set();
  function walk(folder){
    let entries;
    try {const real=fs.realpathSync(folder);const key=process.platform==='win32'?real.toLowerCase():real;if(visited.has(key))return;visited.add(key);entries=fs.readdirSync(folder,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name));}
    catch {issues.push({file:folder,message:'Folder cannot be read. Check the path and permissions.'});return;}
    for(const entry of entries){
      const filePath=path.join(folder,entry.name);
      if(['desktop.ini','thumbs.db'].includes(entry.name.toLowerCase()))continue;
      if(entry.isSymbolicLink()){issues.push({file:filePath,message:'Linked file or folder was not scanned. Add its actual folder as a source.'});continue;}
      if(entry.isDirectory())walk(filePath);
      else if(entry.isFile())files.push(filePath);
    }
  }
  folders.forEach(walk);return {files,issues};
}
function normalizeSources(input){
  const folders=Array.isArray(input.folders)?input.folders:[input.folder];
  if(!folders.length)throw Error('Add at least one source folder.');
  const unique=new Map();
  for(const value of folders){
    if(typeof value!=='string'||!path.isAbsolute(value.trim()))throw Error('Enter an absolute path for every source folder.');
    const folder=path.resolve(value.trim());
    try {if(!fs.statSync(folder).isDirectory())throw Error();}catch {throw Error('Source folder cannot be opened: '+folder);}
    unique.set(process.platform==='win32'?folder.toLowerCase():folder,folder);
  }
  return [...unique.values()];
}
module.exports={collectSources,normalizeSources};

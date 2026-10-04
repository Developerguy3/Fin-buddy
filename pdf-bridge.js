const fs=require('node:fs');const path=require('node:path');const os=require('node:os');const {spawnSync}=require('node:child_process');
function extractPdfs(files){
  if(!files.length)return new Map();
  const bundled=path.join(os.homedir(),'.cache','codex-runtimes','codex-primary-runtime','dependencies','python','python.exe');
  const python=process.env.FIN_BUDDY_PYTHON||(fs.existsSync(bundled)?bundled:'python');
  const result=spawnSync(python,[path.join(__dirname,'document-import.py')],{input:JSON.stringify(files),encoding:'utf8',timeout:240000,maxBuffer:32*1024*1024,windowsHide:true});
  if(result.error||result.status!==0)throw Error('PDF extraction unavailable. Configure FIN_BUDDY_PYTHON with a Python installation containing pdfplumber.');
  return new Map(JSON.parse(result.stdout).map(item=>[item.file,item]));
}
module.exports={extractPdfs};

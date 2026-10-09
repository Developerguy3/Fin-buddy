const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { parseStatement, summarize } = require('./workflow');
const { extractPdfs } = require('./pdf-bridge');
const { collectSources,normalizeSources } = require('./sources');
const {identifyAccount}=require('./accounts');
const {browseFolder}=require('./folder-picker');
const {parseExport,recordsToRows}=require('./statement-formats');
const {reviewSnapshot,matches:scopeMatches,key,validateScope,ruleCategories}=require('./review');
const {predict,discover}=require('./local-ai');
const {recognize,keywordTerms,keywordMatch}=require('./recognition');
const {activeTransactions,splitTransaction}=require('./transaction-splits');
const root = __dirname;
const dataDir = path.join(root, 'data');
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(path.join(root, 'statements'), { recursive: true });
const profilesFile=path.join(dataDir,'profiles.json');
let profiles=fs.existsSync(profilesFile)?JSON.parse(fs.readFileSync(profilesFile,'utf8')):{active:'default',items:[{id:'default',name:'Main profile'}]};
const profilePath=id=>id==='default'?path.join(dataDir,'ledger.json'):path.join(dataDir,'profile-'+id+'.json');
let dbFile = profilePath(profiles.active);
function saveProfiles(){fs.writeFileSync(profilesFile+'.tmp',JSON.stringify(profiles,null,2));fs.renameSync(profilesFile+'.tmp',profilesFile);}
function emptyProfile(mode){return {folder:path.join(root,'statements'),folders:[],transactions:[],rules:[],issues:[],imports:[],exclusions:[],transferCategory:'Transfers',profileMode:mode,categories:['Income','Housing','Groceries','Dining','Transport','Utilities','Healthcare','Shopping','Entertainment','Transfers','Other','Bank fees',...(mode==='professional'?['Business supplies','Contractors','Payroll','Rent','Insurance']:['Insurance'])]};}
const cacheFile=path.join(dataDir,'import-cache.json');
let importCache=fs.existsSync(cacheFile)?JSON.parse(fs.readFileSync(cacheFile,'utf8')):{};
let db = fs.existsSync(dbFile) ? JSON.parse(fs.readFileSync(dbFile, 'utf8')) : { folder: path.join(root, 'statements'), transactions: [], rules: [], issues: [], imports: [], categories: ['Income', 'Housing', 'Groceries', 'Dining', 'Transport', 'Utilities', 'Healthcare', 'Shopping', 'Entertainment', 'Transfers', 'Other'] };
if (!db.categories.includes('Bank fees')) db.categories.push('Bank fees');
db.exclusions ||= [];
db.transferCategory ||= 'Transfers';
db.folders ||= [db.folder];
for(const transaction of db.transactions){
    const matches=db.imports.filter(i=>path.basename(i.file)===path.basename(transaction.source));
    const source=path.isAbsolute(transaction.source)?transaction.source:matches.length?matches[0].file:path.join(db.folder,transaction.source);
    transaction.account=identifyAccount(source,transaction);
}
function save() { fs.writeFileSync(dbFile + '.tmp', JSON.stringify(db, null, 2)); fs.renameSync(dbFile + '.tmp', dbFile); }
function snapshot() {const transactions=activeTransactions(db);return { ...db,profiles:profiles.items,activeProfile:profiles.active,...reviewSnapshot(db,transactions),transactions, months: [...new Set(transactions.map(t => t.date.slice(0,7)))].sort().reverse() }; }
function chooseCategory(input) {
  if(input.category!=='__new__') {if(!db.categories.includes(input.category))throw Error('Choose a valid category.');return input.category;}
  const name=typeof input.newCategory==='string'?input.newCategory.trim().replace(/\s+/g,' '):'';
  if(!name||name.length>60||/[\x00-\x1f]/.test(name)||name==='__new__')throw Error('Enter a new category name between 1 and 60 characters.');
  return db.categories.find(c=>c.toLowerCase()===name.toLowerCase())||name;
}
let automationRunning=false;
async function automaticRecognition(){
  if(automationRunning)return;automationRunning=true;
  try{
    const rows=activeTransactions(db),result=recognize(rows,db.rules,{mode:db.profileMode,transferCategory:db.transferCategory},ruleCategories);
    for(const t of rows)if(t.category&&!db.categories.includes(t.category))db.categories.push(t.category);
    db.automationSummary={...result,modelApplied:0,at:new Date().toISOString()};
    db.aiStatus=await discover(db.aiSettings||{});
    if(db.aiStatus.available&&db.automaticAI!==false){
      db.aiSettings={endpoint:db.aiStatus.endpoint,model:db.aiStatus.model,provider:db.aiStatus.provider};
      const batches=reviewSnapshot(db,rows).merchantGroups.filter(g=>!g.confirmed),started=Date.now();db.aiSuggestions||=[];
      for(let offset=0;offset<batches.length&&Date.now()-started<120000;offset+=8){
        const batch=batches.slice(offset,offset+8);db.automationProgress={stage:'local-model',completed:offset,total:batches.length};
        const suggestions=await predict(db.aiSettings,batch,db.categories,db.profileMode||'personal');
        db.aiSuggestions=db.aiSuggestions.filter(s=>!batch.some(g=>g.id===s.id));db.aiSuggestions.push(...suggestions);
        for(const s of suggestions){const group=batch.find(g=>g.id===s.id);if(s.confidence!=='high'||!s.reason||['Other',db.transferCategory].includes(s.category)||(group.total<0&&s.category==='Income'))continue;
          for(const t of group.transactions)if(!t.category&&ruleCategories(t,db.rules).length<2){t.category=s.category;t.categorySource='local-llm';t.recognition={layer:'local-llm',confidence:'high',reason:s.reason,model:db.aiSettings.model};db.automationSummary.modelApplied++;}
        }
      }
    }
  }catch(e){db.aiStatus={...db.aiStatus,available:false,error:e.message};}
  finally{db.automationProgress={stage:'complete'};automationRunning=false;save();}
}
function applyEditedRule(oldPattern,newPattern) {
  let updated=0;
  for(const row of activeTransactions(db)) {
    const description=row.description.toLowerCase();
    if(!keywordMatch(description,oldPattern)&&!keywordMatch(description,newPattern))continue;
    const categories=ruleCategories(row,db.rules);
    const category=categories.length===1?categories[0]:null;
    if(row.category!==category){row.category=category;row.isTransfer=category===db.transferCategory;updated++;}
  }
  return updated;
}
function scan() {
  const {files,issues}=collectSources(db.folders);
  const imports = [], staged = [];
  const external=/\.(pdf|xlsx|xlsm|xls|ods|xml|html|htm|docx|png|jpe?g|tiff?|bmp|webp)$/i;
  const hashes=new Map();for(const file of files){try{hashes.set(file,crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'));}catch{}}
  let pdfs = new Map(), pdfError;
  try { pdfs = extractPdfs(files.filter(name=>!importCache[hashes.get(name)]&&!db.exclusions.some(e=>e.hash===hashes.get(name)))); } catch(e) { pdfError=e.message; }
  for (const name of files) {
    try {
      const bytes = fs.readFileSync(name);
      const hash = crypto.createHash('sha256').update(bytes).digest('hex');
      if(db.exclusions.some(e=>e.hash===hash)){imports.push({file:name,count:0,excluded:true});continue;}
      const extension=path.extname(name).toLowerCase();
      const pdf = db.corrections?.find(c=>c.hash===hash)||importCache[hash] || pdfs.get(name);
      const native=['.csv','.tsv','.txt','.ofx','.qfx','.qif','.json'].includes(extension);
      let rows=db.corrections?.find(c=>c.hash===hash)?.rows;
      if(!rows&&native){try{rows=parseExport(bytes.toString('utf8'),extension);}catch(e){if(!pdf||pdf.error){e.document=pdf?.document;throw e;}}}
      if(!rows){if(!pdf||pdf.error){const error=Error(pdfError||pdf?.error||'Document could not be read.');error.document=pdf?.document;throw error;}rows=pdf.rows||(pdf.records?recordsToRows(pdf.records):parseStatement(pdf.csv));}
      if(pdf)importCache[hash]=pdf;
      rows.forEach((row, index) => staged.push({ ...row, id: crypto.createHash('sha256').update(hash + ':' + index).digest('hex'), source:name, account:identifyAccount(name,row),category:row.category||null }));
      imports.push({file:name, count:rows.length,...(pdf?.document?{document:{...pdf.document,text:undefined}}:{}),...(pdf?.note?{note:pdf.note}:!rows.length?{note:'Statement or summary contains no itemized transactions.'}:{})});
    } catch (e) { issues.push({file:name,filePath:name, message:e.message,...(e.document?{document:e.document}:{})}); }
  }
  const ids = new Set(db.transactions.map(t => t.id));
  const fingerprint=t=>[t.account?.id||'',t.date,t.cents,t.description.toLowerCase().replace(/[^a-z0-9]/g,'')].join('|');
  const previousOccurrences=new Map(),seen=new Set();
  for(const t of db.transactions){const key=fingerprint(t),sourceKey=t.source+'|'+key,n=(previousOccurrences.get(sourceKey)||0)+1;previousOccurrences.set(sourceKey,n);seen.add(key+'|'+n);}
  const stagedOccurrences=new Map();
  let added = 0;
  for (const t of staged) {
    const key=fingerprint(t),sourceKey=t.source+'|'+key,n=(stagedOccurrences.get(sourceKey)||0)+1;stagedOccurrences.set(sourceKey,n);
    if (ids.has(t.id)) {
      const existing=db.transactions.find(row=>row.id===t.id);
      for(const field of ['description','account','accountNumber','bank','accountType','balanceCents','postedDate','owner','source'])if(t[field]!==undefined)existing[field]=t[field];
      continue;
    }
    if(seen.has(key+'|'+n))continue;
    const matches = db.rules.filter(r => scopeMatches(t,r));
    const categories = ruleCategories(t,db.rules);
    if (categories.length === 1) t.category = categories[0];
    if (!matches.length && t.currency === 'CAD') {
      if (/monthly\s*fee|pay-file\s*fees/i.test(t.description) && t.cents < 0) t.category='Bank fees';
      else if (/enbridge|gr\.?\s*sudbury\s*utl/i.test(t.description) && t.cents < 0) t.category='Utilities';
    }
    t.isTransfer=t.category===db.transferCategory;db.transactions.push(t); ids.add(t.id);seen.add(key+'|'+n); added++;
  }
  const grouped=new Map(),occurrences=new Map();
  for(const t of db.transactions){
    delete t.duplicateOf;
    const key=fingerprint(t),sourceKey=t.source+'|'+key,n=(occurrences.get(sourceKey)||0)+1;occurrences.set(sourceKey,n);
    const duplicateKey=key+'|'+n,canonical=grouped.get(duplicateKey);
    if(canonical){t.duplicateOf=canonical.id;if(!canonical.category&&t.category)canonical.category=t.category;else if(canonical.category&&t.category&&canonical.category!==t.category)canonical.category=null;}
    else grouped.set(duplicateKey,t);
  }
  fs.writeFileSync(cacheFile,JSON.stringify(importCache));db.issues = issues; db.imports = imports; db.lastScan = new Date().toISOString(); save(); return added;
}
function reply(res, status, payload, type='application/json') { res.writeHead(status, {'Content-Type':type, 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff'}); res.end(type === 'application/json' ? JSON.stringify(payload) : payload); }
let mutationBusy=false;
const server = http.createServer(async (req,res) => {
  let ownsMutation=false;
  try {
    if (req.headers.host !== `127.0.0.1:${port}` && req.headers.host !== `localhost:${port}`) return reply(res,403,{error:'Invalid host.'});
    if (req.method === 'POST' && req.headers.origin && ![`http://localhost:${port}`,`http://127.0.0.1:${port}`].includes(req.headers.origin)) return reply(res,403,{error:'Invalid origin.'});
    const url = new URL(req.url, `http://localhost:${port}`);
    const assets={'/responsive.css':'text/css','/platform-ui.js':'text/javascript','/device-ui.js':'text/javascript','/manifest.webmanifest':'application/manifest+json','/sw.js':'text/javascript','/offline.html':'text/html','/icons/icon-192.png':'image/png','/icons/icon-512.png':'image/png','/icons/apple-touch-icon.png':'image/png'};
    if(req.method==='GET'&&assets[url.pathname])return reply(res,200,fs.readFileSync(path.join(root,'public',url.pathname.slice(1))),assets[url.pathname]);
    if (req.method === 'GET' && url.pathname === '/') return reply(res,200,fs.readFileSync(path.join(root,'public','index.html')),'text/html; charset=utf-8');
    if(req.method==='GET'&&['/review-ui.js','/home-ui.js','/ledger-ui.js','/automation-ui.js','/profiles-ui.js'].includes(url.pathname))return reply(res,200,fs.readFileSync(path.join(root,'public',url.pathname.slice(1))),'text/javascript; charset=utf-8');
    if (req.method === 'GET' && url.pathname === '/api/state') return reply(res,200,snapshot());
    if(req.method==='GET'&&url.pathname==='/api/ai-status'){const target=db;target.aiStatus=await discover(target.aiSettings||{});return reply(res,200,target.aiStatus);}
    if (req.method === 'GET' && url.pathname === '/api/report') {
      const month = url.searchParams.get('month');
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month || '')) throw new Error('Choose a valid month.');
      if (db.issues.length) return reply(res,409,{error:'Resolve all statement import issues and scan again before generating reports.'});
      const rows = activeTransactions(db).filter(t => t.date.startsWith(month));
      const pending = rows.filter(t => !t.category);
      if (pending.length) return reply(res,409,{error:`Complete the ${pending.length} unfinished tasks for this month first.`});
      if (!rows.length) throw new Error('No transactions found for this month.');
      const currencies=[...new Set(rows.map(t=>t.currency||'USD'))];
      if(currencies.length>1) return reply(res,409,{error:'Mixed currencies cannot be combined into one report.'});
      return reply(res,200,{month,currency:currencies[0],...summarize(rows)});
    }
    if (req.method !== 'POST') return reply(res,404,{error:'Not found.'});
    let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 100000) throw new Error('Request too large.'); }
    const input = JSON.parse(body || '{}');
    if(mutationBusy)return reply(res,409,{error:'Another change is still processing. Please wait before saving or switching profiles.'});
    mutationBusy=true;ownsMutation=true;
    if(req.headers['x-finbuddy-profile']&&req.headers['x-finbuddy-profile']!==profiles.active)return reply(res,409,{error:'The active profile changed in another tab. Refresh this page before saving.'});
    if(url.pathname==='/api/profiles'){
      if(automationRunning)throw Error('Wait for recognition to finish before changing profiles.');
      if(input.action==='create'){
        const name=String(input.name||'').trim().replace(/\s+/g,' ');
        if(!name||name.length>60||/[\x00-\x1f]/.test(name))throw Error('Enter a profile name between 1 and 60 characters.');
        if(profiles.items.some(p=>p.name.toLowerCase()===name.toLowerCase()))throw Error('A profile with this name already exists.');
        if(!['personal','professional'].includes(input.mode))throw Error('Choose Personal or Professional.');
        save();const id=crypto.randomUUID(),next=emptyProfile(input.mode);
        fs.writeFileSync(profilePath(id),JSON.stringify(next,null,2));profiles.items.push({id,name});profiles.active=id;dbFile=profilePath(id);db=next;saveProfiles();
      }else if(input.action==='switch'){
        const item=profiles.items.find(p=>p.id===input.id);if(!item)throw Error('Choose an existing profile.');
        const next=JSON.parse(fs.readFileSync(profilePath(item.id),'utf8'));save();profiles.active=item.id;dbFile=profilePath(item.id);db=next;saveProfiles();
      }else throw Error('Choose create or switch.');
      return reply(res,200,snapshot());
    }
    if(url.pathname==='/api/profile'){
      if(!['personal','professional'].includes(input.mode))throw Error('Choose Personal or Professional.');db.profileMode=input.mode;db.automaticAI=input.automaticAI!==false;
      for(const category of input.mode==='professional'?['Business supplies','Contractors','Payroll','Rent','Insurance']:['Insurance'])if(!db.categories.includes(category))db.categories.push(category);
      save();await automaticRecognition();return reply(res,200,snapshot());
    }
    if(url.pathname==='/api/ai-settings'){
      const status=await discover({endpoint:input.endpoint,model:input.model,provider:input.provider==='openai'?'openai':'ollama'});
      db.aiSettings={endpoint:input.endpoint,model:input.model||status.model||'',provider:input.provider==='openai'?'openai':'ollama'};db.aiStatus=status;db.automaticAI=input.automaticAI!==false;save();await automaticRecognition();return reply(res,200,snapshot());
    }
    if(url.pathname==='/api/recognize'){await automaticRecognition();return reply(res,200,snapshot());}
    if(url.pathname==='/api/transaction-split'){
      const t=db.transactions.find(t=>t.id===input.id&&!t.duplicateOf);if(!t)throw Error('Split the original transaction, rather than a split part.');
      const oldIds=[t.id,...(t.splitParts||[]).map(p=>p.id)];
      if(input.undo)delete t.splitParts;else t.splitParts=splitTransaction(t,input.parts,db.categories,db.transferCategory);
      const newIds=t.splitParts?.map(p=>p.id)||[t.id];
      for(const group of [...(db.trips||[]),...(db.merchantSplits||[])])if(group.ids.some(id=>oldIds.includes(id)))group.ids=[...new Set([...group.ids.filter(id=>!oldIds.includes(id)),...newIds])];
      save();return reply(res,200,snapshot());
    }
    if(url.pathname==='/api/local-ai'){
      const settings={endpoint:String(input.endpoint||''),model:String(input.model||'')};
      const result=await predict(settings,reviewSnapshot(db,activeTransactions(db)).merchantGroups.filter(g=>!g.confirmed).slice(0,50),db.categories);
      db.aiSettings=settings;db.aiSuggestions=result;save();return reply(res,200,snapshot());
    }
    if(url.pathname==='/api/import-correction'){
      const issue=db.issues.find(i=>i.file===input.file&&i.filePath);if(!issue)throw Error('Choose a current statement import problem.');
      const rows=parseStatement(String(input.csv||''));const hash=crypto.createHash('sha256').update(fs.readFileSync(issue.filePath)).digest('hex');
      db.corrections||=[];db.corrections=db.corrections.filter(c=>c.hash!==hash);db.corrections.push({hash,rows,note:'User supplied corrected transaction rows; original file preserved.'});save();const added=scan();await automaticRecognition();return reply(res,200,{...snapshot(),added});
    }
    if(url.pathname==='/api/merchant-alias'){
      const names=Array.isArray(input.names)?input.names.filter(n=>typeof n==='string'):[];const name=String(input.name||'').trim();
      if(names.length<2||!name||name.length>100)throw Error('Choose at least two merchant names and enter a standard name.');
      db.merchantAliases||=[];db.merchantAliases=db.merchantAliases.filter(a=>!a.names.some(n=>names.includes(n)));db.merchantAliases.push({name,names:[...new Set(names)]});save();return reply(res,200,snapshot());
    }
    if(url.pathname==='/api/category') {
      const old=String(input.old||''),name=String(input.name||'').trim();
      if(!name||name.length>60||/[\x00-\x1f]/.test(name))throw Error('Enter a category name between 1 and 60 characters.');
      if(old&&!db.categories.includes(old))throw Error('Category no longer exists.');
      if(db.categories.some(c=>c.toLowerCase()===name.toLowerCase()&&c!==old))throw Error('That category already exists.');
      const patterns=String(input.patterns||'').split('\n').map(p=>p.trim().toLowerCase()).filter(Boolean);
      if(patterns.some(p=>!keywordTerms(p).length||keywordTerms(p).some(term=>term.length>300)))throw Error('Each merchant rule needs valid comma-separated keywords.');
      if(patterns.some(p=>db.rules.some(r=>r.category!==old&&r.pattern===p)))throw Error('A matching rule already belongs to another category.');
      const previous=db.rules.filter(r=>r.category===old);
      db.categories=old?db.categories.map(c=>c===old?name:c):[...db.categories,name];
      if(old===db.transferCategory)db.transferCategory=name;
      db.rules=db.rules.filter(r=>r.category!==old);
      db.rules.push(...patterns.map(pattern=>({...previous.find(r=>r.pattern===pattern),pattern,category:name})));
      for(const t of [...db.transactions,...activeTransactions(db)])if(t.category===old){if(old==='Transfers')t.isTransfer=true;t.category=name;}
      for(const pattern of new Set([...previous.map(r=>r.pattern),...patterns]))applyEditedRule(pattern,pattern);
      save();return reply(res,200,snapshot());
    }
    if(url.pathname==='/api/bulk'){
      if(!Array.isArray(input.ids)||!input.ids.length)throw Error('Select transactions first.');
      const rows=activeTransactions(db).filter(t=>input.ids.includes(t.id));
      if(rows.length!==new Set(input.ids).size)throw Error('Some transactions no longer exist.');
      const category=chooseCategory(input);
      const scope=validateScope(input.scope||{});
      if(input.remember&&(!keywordTerms(scope.pattern).length||!rows.every(t=>scopeMatches(t,scope))))throw Error('The permanent keywords must match all selected transactions.');
      if(!db.categories.includes(category))db.categories.push(category);
      if(input.remember)db.rules.push({...scope,pattern:scope.pattern.toLowerCase(),category});
      for(const t of rows){t.category=category;t.categorySource='user';t.isTransfer=category===db.transferCategory;}
      save();return reply(res,200,snapshot());
    }
    if(url.pathname==='/api/split-preview'){const scope=validateScope(input.scope||{});return reply(res,200,{ids:activeTransactions(db).filter(t=>scopeMatches(t,scope)).map(t=>t.id)});}
    if(url.pathname==='/api/split'){
      db.merchantSplits||=[];
      if(input.remove){db.merchantSplits=db.merchantSplits.filter(g=>g.id!==input.remove);save();return reply(res,200,snapshot());}
      const ids=[...new Set(input.ids||[])];
      if(!ids.length||ids.some(id=>!activeTransactions(db).some(t=>t.id===id)))throw Error('Select valid transactions for the new group.');
      const name=String(input.name||'').trim();if(!name||name.length>100)throw Error('Enter a group name up to 100 characters.');
      for(const g of db.merchantSplits)g.ids=g.ids.filter(id=>!ids.includes(id));
      db.merchantSplits=db.merchantSplits.filter(g=>g.ids.length);
      db.merchantSplits.push({id:key(Date.now()+name+ids.join()),name,ids});save();return reply(res,200,snapshot());
    }
    if(url.pathname==='/api/travel-settings'){
      db.reviewSettings={travelEnabled:input.enabled!==false,homeCity:String(input.homeCity||'').trim().slice(0,100)};
      if(input.clear){db.trips=[];db.rejectedTrips=[];}
      save();return reply(res,200,snapshot());
    }
    if(url.pathname==='/api/trip'){
      db.trips||=[];db.rejectedTrips||=[];
      if(input.reject){db.rejectedTrips.push(input.reject);save();return reply(res,200,snapshot());}
      if(input.remove){db.trips=db.trips.filter(t=>t.id!==input.remove);save();return reply(res,200,snapshot());}
      const name=String(input.name||'').trim(),ids=[...new Set(input.ids||[])];
      if(!name||name.length>100||!ids.length||ids.some(id=>!activeTransactions(db).some(t=>t.id===id)))throw Error('Enter a trip name and select valid transactions.');
      if(!input.from||!input.to)throw Error('Choose a valid trip date range.');validateScope({from:input.from,to:input.to});
      const trip={id:input.id||key(Date.now()+name),suggestionId:input.suggestionId,name,ids,from:input.from,to:input.to,label:['Personal','Business'].includes(input.label)?input.label:'Unspecified',confidence:'Confirmed by user'};
      for(const t of db.trips)t.ids=t.ids.filter(id=>!ids.includes(id));
      db.trips=db.trips.filter(t=>t.id!==trip.id&&t.ids.length);db.trips.push(trip);save();return reply(res,200,snapshot());
    }
    if(url.pathname==='/api/browse')return reply(res,200,browseFolder(input.initial||''));
    if (url.pathname === '/api/settings') {
      const folders=normalizeSources(input);
      db.folders=folders;db.folder=folders[0]; db.issues = [{file:'Folder changed',message:'Import is pending.'}]; save(); const added=scan();await automaticRecognition(); return reply(res,200,{...snapshot(),added});
    }
    if (url.pathname === '/api/exclude') {
      const issue=db.issues.find(i=>i.file===input.file&&i.filePath);
      if(!issue) throw Error('Choose a file import issue from the current sources. Scan again if needed.');
      const hash=crypto.createHash('sha256').update(fs.readFileSync(issue.filePath)).digest('hex');
      db.exclusions.push({hash,file:input.file,reason:'User marked as non-statement',at:new Date().toISOString()});save();const added=scan();await automaticRecognition();return reply(res,200,{...snapshot(),added});
    }
    if (url.pathname === '/api/scan') { const added = scan();await automaticRecognition(); return reply(res,200,{...snapshot(),added}); }
    if(url.pathname==='/api/rules') {
      const oldPattern=String(input.oldPattern||'');
      const rule=db.rules.find(r=>r.pattern===oldPattern);
      if(!rule)throw Error('This rule no longer exists. Refresh and try again.');
      const pattern=String(input.pattern||'').trim().toLowerCase();
      if(!keywordTerms(pattern).length||keywordTerms(pattern).some(term=>term.length>300))throw Error('Enter comma-separated matching keywords or phrases.');
      if(db.rules.some(r=>r!==rule&&r.pattern===pattern))throw Error('A rule already uses this matching text. Edit that rule instead.');
      const category=chooseCategory(input);
      if(!db.categories.includes(category))db.categories.push(category);
      rule.pattern=pattern;rule.category=category;rule.description=String(input.ruleDescription===undefined?rule.description||'':input.ruleDescription).slice(0,300);rule.matchMode=input.matchMode==='all'?'all':input.matchMode==='any'?'any':rule.matchMode||'any';
      const updated=applyEditedRule(oldPattern,pattern);save();return reply(res,200,{...snapshot(),updated});
    }
    if (url.pathname === '/api/categorize') {
      const t = activeTransactions(db).find(t => t.id === input.id);
      if (!t) throw new Error('Choose a valid transaction.');
      const category=chooseCategory(input);
      const pattern=String(input.pattern||'').trim().toLowerCase();
      const terms=keywordTerms(pattern);if(input.remember&&(!terms.length||terms.length>30||terms.some(term=>term.length>300)||!keywordMatch(t.description,pattern,input.matchMode)))throw Error('Enter comma-separated keywords matching this transaction. Any mode needs at least one match; All mode needs every keyword.');
      if(!db.categories.includes(category)) db.categories.push(category);
      if (input.remember) {
        db.rules = db.rules.filter(r => r.pattern !== pattern); db.rules.push({pattern,category,description:String(input.ruleDescription||'').slice(0,300),matchMode:input.matchMode==='all'?'all':'any'});
        // Explicitly remembering a rule applies it to existing matches as well as future imports.
        applyEditedRule(pattern,pattern);
      }
      t.category = category;t.categorySource='user';t.recognition={layer:'user',confidence:'confirmed',reason:'Category confirmed by you.'};t.isTransfer=category===db.transferCategory;await automaticRecognition();save(); return reply(res,200,snapshot());
    }
    return reply(res,404,{error:'Not found.'});
  } catch(e) { reply(res,400,{error:e.message}); }
  finally{if(ownsMutation)mutationBusy=false;}
});
const port = Number(process.env.PORT || 3210);
if (require.main === module) server.listen(port,'127.0.0.1', () => console.log(`Fin Buddy is ready at http://localhost:${port}`));

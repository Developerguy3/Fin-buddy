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
const {predict}=require('./local-ai');
const root = __dirname;
const dataDir = path.join(root, 'data');
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(path.join(root, 'statements'), { recursive: true });
const dbFile = path.join(dataDir, 'ledger.json');
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
function snapshot() {const transactions=db.transactions.filter(t=>!t.duplicateOf);return { ...db,...reviewSnapshot(db,transactions),transactions, months: [...new Set(transactions.map(t => t.date.slice(0,7)))].sort().reverse() }; }
function chooseCategory(input) {
  if(input.category!=='__new__') {if(!db.categories.includes(input.category))throw Error('Choose a valid category.');return input.category;}
  const name=typeof input.newCategory==='string'?input.newCategory.trim().replace(/\s+/g,' '):'';
  if(!name||name.length>60||/[\x00-\x1f]/.test(name)||name==='__new__')throw Error('Enter a new category name between 1 and 60 characters.');
  return db.categories.find(c=>c.toLowerCase()===name.toLowerCase())||name;
}
function applyEditedRule(oldPattern,newPattern) {
  let updated=0;
  for(const row of db.transactions) {
    const description=row.description.toLowerCase();
    if(!description.includes(oldPattern)&&!description.includes(newPattern))continue;
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
  try { pdfs = extractPdfs(files.filter(name=>external.test(name)&&!importCache[hashes.get(name)]&&!db.exclusions.some(e=>e.hash===hashes.get(name)))); } catch(e) { pdfError=e.message; }
  for (const name of files) {
    try {
      const bytes = fs.readFileSync(name);
      const hash = crypto.createHash('sha256').update(bytes).digest('hex');
      if(db.exclusions.some(e=>e.hash===hash)){imports.push({file:name,count:0,excluded:true});continue;}
      const extension=path.extname(name).toLowerCase();
      if(!external.test(name)&&!['.csv','.tsv','.txt','.ofx','.qfx','.qif','.json'].includes(extension))throw Error('Unrecognized statement format. Supported exports: PDF, CSV, TSV, TXT, Excel, ODS, OFX, QFX, QIF, JSON, XML, HTML and statement images.');
      const pdf = db.corrections?.find(c=>c.hash===hash)||importCache[hash] || pdfs.get(name);
      if(external.test(name) && (!pdf || pdf.error)) throw Error(pdfError || pdf?.error || 'Document could not be read.');
      const rows = db.corrections?.find(c=>c.hash===hash)?.rows || (external.test(name) ? pdf.rows || (pdf.records?recordsToRows(pdf.records):parseStatement(pdf.csv)) : parseExport(bytes.toString('utf8'),extension));
      if(external.test(name))importCache[hash]=pdf;
      rows.forEach((row, index) => staged.push({ ...row, id: crypto.createHash('sha256').update(hash + ':' + index).digest('hex'), source:name, account:identifyAccount(name,row),category:row.category||null }));
      imports.push({file:name, count:rows.length,...(pdf?.note?{note:pdf.note}:!rows.length?{note:'Statement or summary contains no itemized transactions.'}:{})});
    } catch (e) { issues.push({file:name,filePath:name, message:e.message}); }
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
const server = http.createServer(async (req,res) => {
  try {
    if (req.headers.host !== `127.0.0.1:${port}` && req.headers.host !== `localhost:${port}`) return reply(res,403,{error:'Invalid host.'});
    if (req.method === 'POST' && req.headers.origin && ![`http://localhost:${port}`,`http://127.0.0.1:${port}`].includes(req.headers.origin)) return reply(res,403,{error:'Invalid origin.'});
    const url = new URL(req.url, `http://localhost:${port}`);
    if (req.method === 'GET' && url.pathname === '/') return reply(res,200,fs.readFileSync(path.join(root,'public','index.html')),'text/html; charset=utf-8');
    if(req.method==='GET'&&['/review-ui.js','/home-ui.js'].includes(url.pathname))return reply(res,200,fs.readFileSync(path.join(root,'public',url.pathname.slice(1))),'text/javascript; charset=utf-8');
    if (req.method === 'GET' && url.pathname === '/api/state') return reply(res,200,snapshot());
    if (req.method === 'GET' && url.pathname === '/api/report') {
      const month = url.searchParams.get('month');
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month || '')) throw new Error('Choose a valid month.');
      if (db.issues.length) return reply(res,409,{error:'Resolve all statement import issues and scan again before generating reports.'});
      const rows = db.transactions.filter(t => !t.duplicateOf&&t.date.startsWith(month));
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
    if(url.pathname==='/api/local-ai'){
      const settings={endpoint:String(input.endpoint||''),model:String(input.model||'')};
      const result=await predict(settings,reviewSnapshot(db,db.transactions.filter(t=>!t.duplicateOf)).merchantGroups.filter(g=>!g.confirmed).slice(0,50),db.categories);
      db.aiSettings=settings;db.aiSuggestions=result;save();return reply(res,200,snapshot());
    }
    if(url.pathname==='/api/import-correction'){
      const issue=db.issues.find(i=>i.file===input.file&&i.filePath);if(!issue)throw Error('Choose a current statement import problem.');
      const rows=parseStatement(String(input.csv||''));const hash=crypto.createHash('sha256').update(fs.readFileSync(issue.filePath)).digest('hex');
      db.corrections||=[];db.corrections=db.corrections.filter(c=>c.hash!==hash);db.corrections.push({hash,rows,note:'User supplied corrected transaction rows; original file preserved.'});save();const added=scan();return reply(res,200,{...snapshot(),added});
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
      if(patterns.some(p=>p.length<3||p.length>300))throw Error('Each merchant rule needs 3 to 300 characters.');
      if(patterns.some(p=>db.rules.some(r=>r.category!==old&&r.pattern===p)))throw Error('A matching rule already belongs to another category.');
      const previous=db.rules.filter(r=>r.category===old);
      db.categories=old?db.categories.map(c=>c===old?name:c):[...db.categories,name];
      if(old===db.transferCategory)db.transferCategory=name;
      db.rules=db.rules.filter(r=>r.category!==old);
      db.rules.push(...patterns.map(pattern=>({...previous.find(r=>r.pattern===pattern),pattern,category:name})));
      for(const t of db.transactions)if(t.category===old){if(old==='Transfers')t.isTransfer=true;t.category=name;}
      for(const pattern of new Set([...previous.map(r=>r.pattern),...patterns]))applyEditedRule(pattern,pattern);
      save();return reply(res,200,snapshot());
    }
    if(url.pathname==='/api/bulk'){
      if(!Array.isArray(input.ids)||!input.ids.length)throw Error('Select transactions first.');
      const rows=db.transactions.filter(t=>!t.duplicateOf&&input.ids.includes(t.id));
      if(rows.length!==new Set(input.ids).size)throw Error('Some transactions no longer exist.');
      const category=chooseCategory(input);
      const scope=validateScope(input.scope||{});
      if(input.remember&&(!scope.pattern||scope.pattern.trim().length<3||!rows.every(t=>scopeMatches(t,scope))))throw Error('The permanent rule must match all selected transactions and contain at least 3 characters.');
      if(!db.categories.includes(category))db.categories.push(category);
      if(input.remember)db.rules.push({...scope,pattern:scope.pattern.toLowerCase(),category});
      for(const t of rows){t.category=category;t.isTransfer=category===db.transferCategory;}
      save();return reply(res,200,snapshot());
    }
    if(url.pathname==='/api/split-preview'){const scope=validateScope(input.scope||{});return reply(res,200,{ids:db.transactions.filter(t=>!t.duplicateOf&&scopeMatches(t,scope)).map(t=>t.id)});}
    if(url.pathname==='/api/split'){
      db.merchantSplits||=[];
      if(input.remove){db.merchantSplits=db.merchantSplits.filter(g=>g.id!==input.remove);save();return reply(res,200,snapshot());}
      const ids=[...new Set(input.ids||[])];
      if(!ids.length||ids.some(id=>!db.transactions.some(t=>t.id===id&&!t.duplicateOf)))throw Error('Select valid transactions for the new group.');
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
      if(!name||name.length>100||!ids.length||ids.some(id=>!db.transactions.some(t=>t.id===id&&!t.duplicateOf)))throw Error('Enter a trip name and select valid transactions.');
      if(!input.from||!input.to)throw Error('Choose a valid trip date range.');validateScope({from:input.from,to:input.to});
      const trip={id:input.id||key(Date.now()+name),suggestionId:input.suggestionId,name,ids,from:input.from,to:input.to,label:['Personal','Business'].includes(input.label)?input.label:'Unspecified',confidence:'Confirmed by user'};
      for(const t of db.trips)t.ids=t.ids.filter(id=>!ids.includes(id));
      db.trips=db.trips.filter(t=>t.id!==trip.id&&t.ids.length);db.trips.push(trip);save();return reply(res,200,snapshot());
    }
    if(url.pathname==='/api/browse')return reply(res,200,browseFolder(input.initial||''));
    if (url.pathname === '/api/settings') {
      const folders=normalizeSources(input);
      db.folders=folders;db.folder=folders[0]; db.issues = [{file:'Folder changed',message:'Import is pending.'}]; save(); const added=scan(); return reply(res,200,{...snapshot(),added});
    }
    if (url.pathname === '/api/exclude') {
      const issue=db.issues.find(i=>i.file===input.file&&i.filePath);
      if(!issue) throw Error('Choose a file import issue from the current sources. Scan again if needed.');
      const hash=crypto.createHash('sha256').update(fs.readFileSync(issue.filePath)).digest('hex');
      db.exclusions.push({hash,file:input.file,reason:'User marked as non-statement',at:new Date().toISOString()});save();const added=scan();return reply(res,200,{...snapshot(),added});
    }
    if (url.pathname === '/api/scan') { const added = scan(); return reply(res,200,{...snapshot(),added}); }
    if(url.pathname==='/api/rules') {
      const oldPattern=String(input.oldPattern||'');
      const rule=db.rules.find(r=>r.pattern===oldPattern);
      if(!rule)throw Error('This rule no longer exists. Refresh and try again.');
      const pattern=String(input.pattern||'').trim().toLowerCase();
      if(pattern.length<3||pattern.length>300)throw Error('Enter merchant or matching text between 3 and 300 characters.');
      if(db.rules.some(r=>r!==rule&&r.pattern===pattern))throw Error('A rule already uses this matching text. Edit that rule instead.');
      const category=chooseCategory(input);
      if(!db.categories.includes(category))db.categories.push(category);
      rule.pattern=pattern;rule.category=category;
      const updated=applyEditedRule(oldPattern,pattern);save();return reply(res,200,{...snapshot(),updated});
    }
    if (url.pathname === '/api/categorize') {
      const t = db.transactions.find(t => t.id === input.id);
      if (!t) throw new Error('Choose a valid transaction.');
      const category=chooseCategory(input);
      const pattern=String(input.pattern||'').trim().toLowerCase();
      if(input.remember && (pattern.length<3 || !t.description.toLowerCase().includes(pattern))) throw new Error('Matching text must be at least 3 characters copied from this transaction description.');
      if(!db.categories.includes(category)) db.categories.push(category);
      if (input.remember) {
        db.rules = db.rules.filter(r => r.pattern !== pattern); db.rules.push({pattern,category});
        applyEditedRule(pattern,pattern);
      }
      t.category = category;t.isTransfer=category===db.transferCategory; save(); return reply(res,200,snapshot());
    }
    return reply(res,404,{error:'Not found.'});
  } catch(e) { reply(res,400,{error:e.message}); }
});
const port = Number(process.env.PORT || 3210);
if (require.main === module) server.listen(port,'127.0.0.1', () => console.log(`Fin Buddy is ready at http://localhost:${port}`));

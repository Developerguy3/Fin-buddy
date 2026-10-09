import workflow from '../workflow.js';
import formats from '../statement-formats.js';
import recognition from '../recognition.js';
import review from '../review.js';
import splits from '../transaction-splits.js';
import {readDocument} from './document-reader.js';
import accounts from '../accounts.js';
const categories=['Income','Housing','Groceries','Dining','Transport','Utilities','Healthcare','Shopping','Entertainment','Transfers','Other','Bank fees','Business supplies','Insurance','Property taxes'];
export const emptyLedger=mode=>({profileMode:mode,automaticAI:true,folder:'Device files',folders:[],transactions:[],rules:[],issues:[],imports:[],categories:[...categories],transferCategory:'Transfers',exclusions:[]});
export class LocalEngine{
 constructor(store){this.store=store;this.registry={active:'default',items:[{id:'default',name:'Main profile'}]};this.db=emptyLedger();}
 async init(){this.registry=await this.store.get('profiles')||this.registry;this.db=await this.store.get('ledger:'+this.registry.active)||emptyLedger();return this;}
 async save(){await this.store.set('ledger:'+this.registry.active,this.db);await this.store.set('profiles',this.registry);}
 snapshot(){const rows=splits.activeTransactions(this.db);return {...this.db,...review.reviewSnapshot(this.db,rows),transactions:rows,profiles:this.registry.items,activeProfile:this.registry.active,months:[...new Set(rows.map(t=>t.date.slice(0,7)))].sort().reverse(),deviceLocal:true,aiStatus:{available:!!this.db.deviceModelLoaded,model:'SmolLM2-135M on-device',error:'On-device model not loaded. Enable it in Settings → On-device AI.'}};}
 recognize(){const result=recognition.recognize(splits.activeTransactions(this.db),this.db.rules,{mode:this.db.profileMode,transferCategory:this.db.transferCategory},review.ruleCategories);this.db.automationSummary={...result,modelApplied:0,at:new Date().toISOString()};for(const t of this.db.transactions)if(t.category&&!this.db.categories.includes(t.category))this.db.categories.push(t.category);}
 category(input){const name=input.category==='__new__'?String(input.newCategory||'').trim():input.category;if(!name||name.length>60||(input.category!=='__new__'&&!this.db.categories.includes(name)))throw Error('Choose a category or enter a valid new name.');if(!this.db.categories.includes(name))this.db.categories.push(name);return name;}
 async importFiles(files){let added=0;for await(const file of files){try{
  const bytes=await file.arrayBuffer(),hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');if(this.db.imports.some(i=>i.hash===hash)||this.db.exclusions.some(e=>e.hash===hash))continue;
  const document=await readDocument(file),rows=document.rows;
  const fingerprint=t=>[t.account.id,t.currency||'USD',t.date,t.cents,t.description.trim().toLowerCase(),t.balanceCents??''].join('|'),existing=new Map(),occurrences=new Map();
  for(const t of this.db.transactions.filter(t=>!t.duplicateOf)){const f=fingerprint(t);if(!existing.has(f))existing.set(f,[]);existing.get(f).push(t);}
  for(const [index,row] of rows.entries()){const id=review.key(hash+'|'+index),account=accounts.identifyAccount(file.name,row);if(!row.bank&&!row.accountNumber&&account.bank==='Imported account'){account.id=review.key(file.name);account.label=file.name;}const transaction={...row,id,source:file.name,category:row.category||null,account},f=fingerprint(transaction),n=occurrences.get(f)||0;occurrences.set(f,n+1);const original=account.number?existing.get(f)?.[n]:null;if(original)transaction.duplicateOf=original.id;else added++;this.db.transactions.push(transaction);}
  this.db.issues=this.db.issues.filter(i=>i.file!==file.name);
  this.db.imports.push({file:file.name,hash,count:rows.length,document:document.document,original:file,...(!rows.length?{note:(document.document?.kind||'Document')+' indexed separately; no payment inferred.'}:{})});
 }catch(e){this.db.issues=this.db.issues.filter(i=>i.file!==file.name);this.db.issues.push({file:file.name,filePath:file.name,message:e.message,original:file,document:e.document,sourceToken:file.sourceToken});}}
 this.db.lastScan=new Date().toISOString();this.recognize();await this.save();return {...this.snapshot(),added};}
 async request(route,input={}){
  const url=new URL(route,'https://device.local'),rows=splits.activeTransactions(this.db);
  if(url.pathname==='/api/state')return this.snapshot();
  if(url.pathname==='/api/ai-status')return this.snapshot().aiStatus;
  if(url.pathname==='/api/device-ai'){this.db.deviceModelLoaded=true;this.db.modelReviewedGroups=[...new Set([...(this.db.modelReviewedGroups||[]),...(input.reviewedIds||[])])];const suggestions=(input.suggestions||[]).filter(s=>this.db.categories.includes(s.category));this.db.aiSuggestions=[...(this.db.aiSuggestions||[]).filter(s=>!suggestions.some(next=>next.id===s.id)),...suggestions];await this.save();return this.snapshot();}
  if(url.pathname==='/api/device-ai-settings'){this.db.automaticAI=input.enabled!==false;await this.save();return this.snapshot();}
  if(url.pathname==='/api/report'){
   const month=url.searchParams.get('month'),selected=rows.filter(t=>t.date.startsWith(month));if(this.db.issues.length||selected.some(t=>!t.category))throw Error('Resolve document issues and unfinished transactions first.');if(!selected.length)throw Error('No transactions for this month.');const currencies=[...new Set(selected.map(t=>t.currency||'USD'))];if(currencies.length!==1)throw Error('Mixed currencies cannot be combined.');return {month,currency:currencies[0],...workflow.summarize(selected)};
  }
  if(url.pathname==='/api/profiles'){
   if(input.action==='create'){const name=String(input.name||'').trim();if(!name||name.length>60||this.registry.items.some(p=>p.name.toLowerCase()===name.toLowerCase()))throw Error('Enter a unique profile name.');if(!['personal','professional'].includes(input.mode))throw Error('Choose Personal or Professional.');await this.save();const id=crypto.randomUUID();this.registry.items.push({id,name});this.registry.active=id;this.db=emptyLedger(input.mode);}
   else if(input.action==='switch'){if(!this.registry.items.some(p=>p.id===input.id))throw Error('Choose an existing profile.');await this.save();this.registry.active=input.id;this.db=await this.store.get('ledger:'+input.id)||emptyLedger();}else throw Error('Choose create or switch.');
  }else if(url.pathname==='/api/profile'){if(!['personal','professional'].includes(input.mode))throw Error('Choose Personal or Professional.');this.db.profileMode=input.mode;this.recognize();}
  else if(url.pathname==='/api/categorize'){
   const t=rows.find(t=>t.id===input.id);if(!t)throw Error('Choose a transaction.');const category=this.category(input),pattern=String(input.pattern||'').trim().toLowerCase();
   if(input.remember){if(!recognition.keywordMatch(t.description,pattern,input.matchMode))throw Error('The keywords must match this transaction.');this.db.rules=this.db.rules.filter(r=>r.pattern!==pattern);this.db.rules.push({pattern,category,matchMode:input.matchMode||'any',description:input.ruleDescription||''});for(const row of rows)if(recognition.keywordMatch(row.description,pattern,input.matchMode)){const matches=review.ruleCategories(row,this.db.rules);row.category=matches.length===1?matches[0]:null;row.isTransfer=row.category===this.db.transferCategory;}}
   t.category=category;t.categorySource='user';t.isTransfer=category===this.db.transferCategory;this.recognize();
  }else if(url.pathname==='/api/category'){
   const name=String(input.name||'').trim();if(!name||name.length>60)throw Error('Enter a category name.');if(input.old&&input.old!==name&&this.db.categories.includes(name))throw Error('Category already exists.');const oldPatterns=this.db.rules.filter(r=>r.category===input.old).map(r=>r.pattern);this.db.categories=this.db.categories.filter(c=>c!==input.old);if(!this.db.categories.includes(name))this.db.categories.push(name);for(const t of rows)if(t.category===input.old)t.category=name;this.db.rules=this.db.rules.filter(r=>r.category!==input.old);const patterns=String(input.patterns||'').split('\n').map(s=>s.trim().toLowerCase()).filter(Boolean);for(const pattern of patterns)this.db.rules.push({pattern,category:name});for(const row of rows)if([...oldPatterns,...patterns].some(p=>recognition.keywordMatch(row.description,p))){const matched=review.ruleCategories(row,this.db.rules);row.category=matched.length===1?matched[0]:null;row.isTransfer=row.category===this.db.transferCategory;}this.recognize();
  }else if(url.pathname==='/api/transaction-split'){
   const t=this.db.transactions.find(t=>t.id===input.id);if(!t)throw Error('Choose a transaction.');if(input.undo)delete t.splitParts;else t.splitParts=splits.splitTransaction(t,input.parts,this.db.categories,this.db.transferCategory);
  }else if(url.pathname==='/api/scan'||url.pathname==='/api/recognize'){this.recognize();}
  else if(url.pathname==='/api/exclude'){const issue=this.db.issues.find(i=>i.file===input.file);if(issue?.original){const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await issue.original.arrayBuffer())),b=>b.toString(16).padStart(2,'0')).join('');this.db.exclusions.push({hash,file:issue.file});}this.db.issues=this.db.issues.filter(i=>i.file!==input.file);}
  else if(url.pathname==='/api/import-correction'){
   const issue=this.db.issues.find(i=>i.file===input.file);if(!issue)throw Error('Choose a current document issue.');const corrected=formats.parseExport(input.csv,'.csv');
   for(const row of corrected)this.db.transactions.push({...row,id:crypto.randomUUID(),source:issue.file,category:null,account:{id:review.key(issue.file),label:issue.file,bank:'Imported',type:'Account',owner:''}});
   const hash=issue.original?Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await issue.original.arrayBuffer())),b=>b.toString(16).padStart(2,'0')).join(''):undefined;this.db.imports.push({file:issue.file,hash,count:corrected.length,original:issue.original,note:'Transaction extraction confirmed by you.'});this.db.issues=this.db.issues.filter(i=>i!==issue);this.recognize();
  }
  else if(url.pathname==='/api/bulk'){const category=this.category(input),selected=rows.filter(t=>input.ids.includes(t.id));if(input.remember){const scope=review.validateScope(input.scope||{});if(!scope.pattern||!selected.every(t=>review.matches(t,scope)))throw Error('The rule must match the selected transactions.');this.db.rules.push({...scope,category});}for(const t of selected){t.category=category;t.categorySource='user';t.isTransfer=category===this.db.transferCategory;}this.recognize();}
  else if(url.pathname==='/api/split-preview'){const scope=review.validateScope(input.scope||{});return {ids:rows.filter(t=>review.matches(t,scope)).map(t=>t.id)};}
  else if(url.pathname==='/api/merchant-alias'){if(!input.name?.trim()||!Array.isArray(input.names)||input.names.length<2)throw Error('Choose two merchant names and a standard name.');this.db.merchantAliases||=[];this.db.merchantAliases.push({name:input.name.trim(),names:input.names});}
  else if(url.pathname==='/api/split'){this.db.merchantSplits||=[];if(input.remove)this.db.merchantSplits=this.db.merchantSplits.filter(s=>s.id!==input.remove);else this.db.merchantSplits.push({id:crypto.randomUUID(),name:String(input.name||'').trim(),ids:input.ids.filter(id=>rows.some(t=>t.id===id))});}
  else if(url.pathname==='/api/travel-settings'){this.db.reviewSettings={travelEnabled:input.enabled!==false,homeCity:String(input.homeCity||'')};if(input.clear){this.db.trips=[];this.db.rejectedTrips=[];}}
  else if(url.pathname==='/api/trip'){this.db.trips||=[];if(input.remove)this.db.trips=this.db.trips.filter(t=>t.id!==input.remove);else if(input.reject){this.db.rejectedTrips||=[];this.db.rejectedTrips.push(input.reject);}else this.db.trips.push({...input,id:input.id||crypto.randomUUID(),confidence:'Confirmed by user'});}
  else throw Error('This desktop feature is not available on-device yet. Use local statement imports and Device AI.');
  await this.save();return this.snapshot();
 }
}

const crypto=require('node:crypto');
const key=s=>crypto.createHash('sha256').update(s).digest('hex').slice(0,16);
function merchantName(description){
  const text=String(description).toUpperCase().replace(/^(?:POS|PURCHASE|DEBIT PURCHASE|CARD PURCHASE)\s+/,'').replace(/[^A-Z0-9 # '&.-]/g,' ').replace(/\s+/g,' ').trim();
  if(/TRANSFER|PAYMENT|LOAN|WITHDRAWAL|DEPOSIT|\bTFR\b/.test(text))return text;
  return text.replace(/\s*#\d+\b/g,'').replace(/\s+\d{3,}$/,'').replace(/([A-Z])\d{3,}$/,'$1').trim();
}
function validateScope(s){
  if(!s||typeof s!=='object'||Array.isArray(s))throw Error('Invalid rule scope.');
  const scope={};for(const k of ['pattern','account','from','to','location','channel'])if(s[k]){if(typeof s[k]!=='string'||s[k].length>300)throw Error('Invalid '+k+' filter.');scope[k]=s[k].trim();}
  for(const k of ['min','max'])if(s[k]!==undefined){if(!Number.isSafeInteger(s[k])||s[k]<0)throw Error('Amount limits must be positive whole cents.');scope[k]=s[k];}
  for(const k of ['from','to'])if(scope[k]&&(!/^\d{4}-\d{2}-\d{2}$/.test(scope[k])||!Number.isFinite(Date.parse(scope[k]))||new Date(scope[k]).toISOString().slice(0,10)!==scope[k]))throw Error('Invalid date filter.');
  if(scope.from&&scope.to&&scope.from>scope.to||scope.min!==undefined&&scope.max!==undefined&&scope.min>scope.max)throw Error('The range starts after it ends.');
  if(scope.channel&&!['In person','Online / recurring','Unknown'].includes(scope.channel))throw Error('Invalid channel filter.');return scope;
}
function ruleCategories(t,rules){const matching=rules.filter(r=>matches(t,r));const rank=r=>Object.keys(r).filter(k=>!['pattern','category'].includes(k)&&r[k]!==undefined&&r[k]!=='').length;const highest=Math.max(-1,...matching.map(rank));return [...new Set(matching.filter(r=>rank(r)===highest).map(r=>r.category))];}
function channel(t){
  const value=String(t.channel||t.paymentChannel||'').toLowerCase();
  if(/online|e.?commerce|card[ -]not[ -]present|recurring/.test(value))return 'Online / recurring';
  if(/contactless|card[ -]present|chip|in.person/.test(value))return 'In person';
  return 'Unknown';
}
function matches(t,s={}){
  return (!s.pattern||t.description.toLowerCase().includes(s.pattern.toLowerCase()))&&(!s.account||t.account?.id===s.account)&&(!s.from||t.date>=s.from)&&(!s.to||t.date<=s.to)&&(!s.location||String(t.location||t.city||'').toLowerCase()===s.location.toLowerCase())&&(!s.channel||channel(t)===s.channel)&&(s.min===undefined||Math.abs(t.cents)>=s.min)&&(s.max===undefined||Math.abs(t.cents)<=s.max);
}
function groups(rows,db){
  const result=new Map();
  for(const t of rows){
    const split=(db.merchantSplits||[]).find(s=>s.ids.includes(t.id));
    const normalized=merchantName(t.description)||t.description;
    const alias=(db.merchantAliases||[]).find(a=>a.names.includes(normalized));
    const name=split?.name||alias?.name||normalized;
    // Keep owners, accounts, currencies and money directions distinct by default.
    const id=split?.id||key([name,t.account?.id||'',t.currency||'USD',Math.sign(t.cents)].join('|'));
    if(!result.has(id))result.set(id,{id,name,transactions:[],split:!!split});
    result.get(id).transactions.push(t);
  }
  return [...result.values()].map(g=>{
    const ts=g.transactions,cats=[...new Set(ts.map(t=>t.category).filter(Boolean))],known=ts.filter(t=>t.category).length;
    const ai=(db.aiSuggestions||[]).find(s=>s.id===g.id);
    return {...g,count:ts.length,total:ts.reduce((n,t)=>n+t.cents,0),from:ts.map(t=>t.date).sort()[0],to:ts.map(t=>t.date).sort().at(-1),descriptions:[...new Set(ts.map(t=>t.description))],accounts:[...new Set(ts.map(t=>t.account?.label||'Unknown'))],locations:[...new Set(ts.map(t=>t.location||t.city).filter(Boolean))],suggestedCategory:cats.length===1?cats[0]:ai?.category||null,confidence:cats.length===1?'Prior categorization in this account':ai?'Local AI suggestion · '+ai.confidence:'Needs review',alternatives:cats.length?cats:ai?.alternatives||[],confirmed:known===ts.length};
  }).sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name));
}
function tripSuggestions(rows,settings={}){
  if(settings.travelEnabled===false)return [];
  const cities=new Map();
  for(const t of rows){const city=String(t.city||t.location||'').trim();if(!city||city.toLowerCase()===String(settings.homeCity||'').toLowerCase()||channel(t)==='Online / recurring')continue;if(!cities.has(city))cities.set(city,[]);cities.get(city).push(t);}
  const results=[];
  for(const [city,ts] of cities){
    const ordered=ts.sort((a,b)=>a.date.localeCompare(b.date));let cluster=[];
    const emit=()=>{const types=new Set(cluster.map(t=>/hotel|lodging/i.test(t.description)?'lodging':/taxi|uber|rail|airline|transport/i.test(t.description)?'transport':/restaurant|dining|cafe/i.test(t.description)?'dining':'other'));if(cluster.length<3||types.size<2||!([...types].some(x=>x==='lodging'||x==='transport')))return;
      const ids=cluster.map(t=>t.id).sort();results.push({id:key(ids.join('|')),name:city+' visit',city,ids,from:cluster[0].date,to:cluster.at(-1).date,confidence:cluster.filter(t=>channel(t)==='In person').length>=2?'High-confidence suggestion':'Possible trip',reasons:[cluster.length+' transactions with explicit merchant location metadata',types.size+' spending signals across '+new Set(cluster.map(t=>t.date)).size+' dates','Merchant location does not establish your physical presence']});};
    for(const t of ordered){if(cluster.length&&(Date.parse(t.date)-Date.parse(cluster.at(-1).date))/86400000>4){emit();cluster=[];}cluster.push(t);}emit();
  }
  return results;
}
function reviewSnapshot(db,rows){const merchantGroups=groups(rows,db);const possible=tripSuggestions(rows,db.reviewSettings);return {merchantGroups,trips:db.trips||[],tripSuggestions:possible.filter(t=>!(db.rejectedTrips||[]).includes(t.id)&&!(db.trips||[]).some(x=>x.suggestionId===t.id)),reviewSettings:db.reviewSettings||{travelEnabled:true,homeCity:''},processing:{documents:db.imports.filter(i=>!i.excluded).length,transactions:rows.length,possibleDuplicates:db.transactions.filter(t=>t.duplicateOf).length,repeatedGroups:merchantGroups.filter(g=>g.count>1).length,autoCategorized:rows.filter(t=>t.category).length,suggested:merchantGroups.filter(g=>g.suggestedCategory&&!g.confirmed).reduce((n,g)=>n+g.transactions.filter(t=>!t.category).length,0),needsReview:rows.filter(t=>!t.category).length,localAI:'Not configured; suggestions use your saved categories and rules.'}};}
module.exports={merchantName,channel,matches,groups,tripSuggestions,reviewSnapshot,key,validateScope,ruleCategories};

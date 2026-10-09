import workflow from '../workflow.js';
const months={jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12};
const cash=s=>workflow.money(String(s).replace(/CR$/i,''));
export function documentKind(text){const statement=/bank\s*statement|account\s*statement|Transactions\s*From|Opening\s*balance/i.test(text);if(!statement&&/Canada\s*Revenue\s*Agency|Notice\s*of\s*Assessment|Income\s*Tax\s*Return|\bT4\b/i.test(text))return 'tax document';return /\binvoice\b/i.test(text)&&!statement?'invoice':/\breceipt\b/i.test(text)&&!/statement/i.test(text)?'receipt':/statement|withdrawal|deposit|transaction|opening balance|account activity/i.test(text)?'statement':/tax|balance|payment|subtotal|amount due/i.test(text)?'financial document':'non-financial document';}
export function tableRecords(matrix){
 const index=matrix.findIndex(row=>row.some(v=>/^(date|transaction date|posted date)$/i.test(String(v).trim()))&&row.some(v=>/^(description|merchant|memo|payee)$/i.test(String(v).trim()))&&row.some(v=>/^(amount|debit|credit|withdrawals?|deposits?)$/i.test(String(v).trim())));
 if(index<0)return [];
 const headers=matrix[index].map(v=>String(v).trim().replace(/^withdrawals?$/i,'Debit').replace(/^deposits?$/i,'Credit'));
 return matrix.slice(index+1).filter(row=>row.some(v=>v!==null&&v!==undefined&&String(v).trim())).map(row=>Object.fromEntries(headers.map((h,i)=>[h,row[i] instanceof Date?row[i].toISOString().slice(0,10):row[i]??''])));
}
function isoDate(text,year){
 const compact=text.replace(/\s+/g,'');let match=/^(\d{1,2})[-/]?([a-z]{3})[-/]?(\d{4})?$/i.exec(compact);
 if(match){const y=Number(match[3]||year),m=months[match[2].toLowerCase()],d=Number(match[1]);if(!y||!m||!d)throw Error('Statement year/date is unreadable.');const iso=y+'-'+String(m).padStart(2,'0')+'-'+String(d).padStart(2,'0');if(new Date(iso).toISOString().slice(0,10)!==iso)throw Error('Invalid statement date.');return iso;}
 if(/^\d{4}-\d{2}-\d{2}$/.test(compact))return compact;
 if(/^\d{1,2}[/-]\d{1,2}[/-]\d{4}$/.test(compact)){const [m,d,y]=compact.split(/[/-]/);return isoDate(d+'-'+Object.keys(months)[Number(m)-1]+'-'+y,year);}
 return null;
}
export function positionedStatement(pages,text){
 if(/STATEMENT\s+FROM/i.test(text)&&/PREVIOUS\s+STATEMENT\s+BALANCE/i.test(text))return visaStatement(pages,text);
 if(/Current\s*Account/i.test(text)&&/Transactions\s*From/i.test(text))return onlineStatement(pages,text);
 if(/Opening\s+Principal\s+Balance/i.test(text))return loanStatement(pages,text);
 const currency=/\bUSD\b/i.test(text)?'USD':/\bCAD\b|RBC|Ukrainian|Royal Bank|Canada/i.test(text)?'CAD':null;
 if(!currency)throw Error('Currency is not explicit in this document. Review it before import.');
 const years=[...text.matchAll(/\b(20\d{2})\b/g)].map(m=>Number(m[1])),period=/([A-Za-z]+)\s+(\d{1,2}),?\s+(20\d{2})\s*(?:to|[-–])\s*([A-Za-z]+)\s+(\d{1,2}),?\s+(20\d{2})/i.exec(text),year=period?Number(period[6]):years.at(-1),start=period?isoDate(period[2]+'-'+period[1].slice(0,3)+'-'+period[3]):null,end=period?isoDate(period[5]+'-'+period[4].slice(0,3)+'-'+period[6]):null;
 const opening=/opening\s*balance[\s\S]{0,90}?(-?\$?[\d,]+\.\d{2})/i.exec(text),closing=/closing\s*balance[\s\S]{0,90}?(-?\$?[\d,]+\.\d{2})/i.exec(text);
 const descending=/Ukrainian\s+Credit\s+Union/i.test(text);
 let previous=opening?cash(opening[1]):null,currentDate=null,parts=[],rows=[];
 for(const page of pages){
  const header=page.find(line=>/description|merchant|payee/i.test(line.map(w=>w.text).join(' '))&&/debit|credit|amount|withdrawal|deposit/i.test(line.map(w=>w.text).join(' ')));
  if(!header)continue;
  const find=regex=>header.find(w=>regex.test(w.text.replace(/\s/g,'')))?.x;
  const desc=find(/description|merchant|payee/i),debit=find(/debit|withdrawal/i),credit=find(/credit|deposit/i),amount=find(/^amount$/i),balance=find(/balance/i);
  if(desc===undefined||(!Number.isFinite(amount)&&(!Number.isFinite(debit)||!Number.isFinite(credit))))continue;
  for(const line of page.filter(l=>l[0].y>header[0].y+2)){
   const all=line.map(w=>w.text).join(' ');if(/closing balance|account fees|total transactions/i.test(all))break;if(/opening balance/i.test(all))continue;
   const firstAmount=Math.min(...[debit,credit,amount].filter(Number.isFinite));
   const dateText=line.filter(w=>w.x<desc-2).map(w=>w.text).join(''),partial=/^\d{1,2}[-/]?([A-Za-z]{3})$/.exec(dateText),dateYear=period&&partial&&months[partial[1].toLowerCase()]>months[period[4].slice(0,3).toLowerCase()]?year-1:year,date=isoDate(dateText,dateYear);if(date){if(start&&(date<start||date>end))throw Error('Transaction date falls outside the statement period.');currentDate=date;}
   const description=line.filter(w=>w.x>=desc-2&&w.x<firstAmount-2).map(w=>w.text).join(' ').trim();
   const values=line.filter(w=>/^[-+]?\$?[\d,]+\.\d{2}(CR)?$/i.test(w.text)&&w.x>=firstAmount-30).map(w=>({x:w.x,cents:cash(w.text)}));
   const amounts=values.filter(v=>balance===undefined||v.x<balance-35),balances=values.filter(v=>balance!==undefined&&v.x>=balance-35);
   if(description)parts.push(description);
   if(!amounts.length)continue;
   if(!currentDate||amounts.length!==1||balances.length>1||!parts.length)throw Error('Ambiguous date or amount; document needs review.');
   let cents=amounts[0].cents;
   if(Number.isFinite(debit)&&Number.isFinite(credit))cents=amounts[0].x<(debit+credit)/2?-Math.abs(cents):Math.abs(cents);
   else if(cents>0&&!/received|deposit|credit|refund|income/i.test(parts.join(' ')))throw Error('Money direction is not explicit; document needs review.');
   if(!descending&&previous!==null&&balances.length&&previous+cents!==balances[0].cents)throw Error('Running balance does not reconcile. No transactions imported.');
   if(balances.length)previous=balances[0].cents;else if(previous!==null)previous+=cents;
   rows.push({date:currentDate,description:parts.join(' '),cents,currency,balanceCents:balances[0]?.cents});parts=[];
  }
 }
 if(!rows.length)throw Error('No reliable transaction table found.');
 if(descending)for(let i=0;i<rows.length-1;i++)if(rows[i].balanceCents!==rows[i+1].balanceCents+rows[i].cents)throw Error('Running balances do not reconcile.');
 if(closing&&previous!==null&&previous!==cash(closing[1]))throw Error('Closing balance does not reconcile. No transactions imported.');
 const compact=text.replace(/\s+/g,''),credits=/Totaldeposits&credits\((\d+)\)\$?([\d,]+\.\d{2})/i.exec(compact),debits=/Totalcheques&debits\((\d+)\)-?\$?([\d,]+\.\d{2})/i.exec(compact);
 if(credits){const incoming=rows.filter(r=>r.cents>0);if(incoming.length!==Number(credits[1])||incoming.reduce((n,r)=>n+r.cents,0)!==cash(credits[2]))throw Error('Deposit count or totals do not reconcile.');}
 if(debits){const outgoing=rows.filter(r=>r.cents<0);if(outgoing.length!==Number(debits[1])||-outgoing.reduce((n,r)=>n+r.cents,0)!==cash(debits[2]))throw Error('Withdrawal count or totals do not reconcile.');}
 return rows;
}
function visaStatement(pages,text){
 const period=/STATEMENT\s+FROM\s+([A-Z]{3})\s+(\d+)(?:,\s*\d{4})?\s+TO\s+([A-Z]{3})\s+(\d+),\s*(\d{4})/i.exec(text);if(!period)throw Error('Credit-card statement period is unreadable.');
 const endMonth=months[period[3].toLowerCase()],year=Number(period[5]),rows=[];
 for(const page of pages)for(const line of page){const joined=line.filter(w=>w.x<365).map(w=>w.text).join(' ');const match=/^([A-Z]{3})\s+(\d{1,2})\s+([A-Z]{3})\s+(\d{1,2})\s+(.+?)\s+(-?\$[\d,]+\.\d{2})$/i.exec(joined);if(!match)continue;const [,m,d,pm,pd,description,amount]=match,date=isoDate(d+'-'+m+'-'+(year-(months[m.toLowerCase()]>endMonth?1:0))),postedDate=isoDate(pd+'-'+pm+'-'+(year-(months[pm.toLowerCase()]>endMonth?1:0)));rows.push({date,postedDate,description,cents:-cash(amount),currency:'CAD',bank:'RBC',accountType:'Credit card',...(/PAYMENT.*THANK/i.test(description)?{category:'Transfers'}:{})});}
 const opening=/PREVIOUS\s+STATEMENT\s+BALANCE\s+(-?\$[\d,]+\.\d{2})/i.exec(text),closing=/NEW\s+BALANCE\s+(-?\$[\d,]+\.\d{2})/i.exec(text);if(!opening||!closing||cash(opening[1])-rows.reduce((n,r)=>n+r.cents,0)!==cash(closing[1]))throw Error('Card opening and closing balances do not reconcile.');return rows;
}
function onlineStatement(pages,text){
 let current=null,pending=null;const rows=[],daily=[],number=/Current\s*Account\s*\((\d+)\)/i.exec(text)?.[1]||'';
 for(const page of pages)for(const line of page){const joined=line.map(w=>w.text).join(' ');if(/^Showing\s+\d+|^Sign-up with|^Enjoy a rebate|^Get Offer/i.test(joined)){current=null;pending=null;continue;}const date=/^([A-Z]{3})\s+(\d{1,2}),\s*(\d{4})/i.exec(joined);if(date){current=isoDate(date[2]+'-'+date[1]+'-'+date[3]);pending=null;const balances=line.filter(w=>/^[-+]?\$?[\d,]+\.\d{2}$/.test(w.text)&&w.x>500);if(balances.length)daily.push({date:current,balance:cash(balances.at(-1).text),total:0});continue;}
  const amounts=line.filter(w=>/^[-+]?\$?[\d,]+\.\d{2}$/.test(w.text)&&w.x>300&&w.x<500);
  if(current&&amounts.length){if(amounts.length>1&&line[0].y<200)continue;if(amounts.length!==1)throw Error('Ambiguous online-banking amount.');pending={date:current,description:line.filter(w=>w.x<300).map(w=>w.text).join(' ').trim(),cents:cash(amounts[0].text),currency:'CAD',bank:'RBC',accountType:'Chequing',accountNumber:number};rows.push(pending);if(daily.length)daily.at(-1).total+=pending.cents;}else if(pending){const description=line.filter(w=>w.x<300).map(w=>w.text).join(' ');if(description&&!/Royal Bank of Canada Website/i.test(description))pending.description+=(pending.description?' ':'')+description;}
 }
 if(!rows.length||rows.some(r=>!r.description))throw Error('Online-banking transactions were not fully readable.');for(let i=0;i<daily.length-1;i++)if(daily[i].balance!==daily[i+1].balance+daily[i].total)throw Error('Daily balances do not reconcile.');return rows;
}
function loanStatement(pages,text){
 const date=/Statement\s*Date:\s*([A-Za-z]+)\s+(\d+),\s*(\d{4})/i.exec(text);if(!date)throw Error('Loan statement date is unreadable.');const endMonth=months[date[1].slice(0,3).toLowerCase()],year=Number(date[3]),rows=[];let previous=null;
 for(const page of pages)for(const line of page){const joined=line.map(w=>w.text).join(' '),opening=/Opening\s+Principal\s+Balance\s+(\$[\d,]+\.\d{2})/i.exec(joined);if(opening){previous=cash(opening[1]);continue;}const d=/^([A-Za-z]{3})\s+(\d{1,2})/.exec(joined);if(!d)continue;const amounts=line.filter(w=>/^[-+]?\$?[\d,]+\.\d{2}$/.test(w.text)&&w.x>340);if(amounts.length!==2)continue;const description=line.filter(w=>w.x>175&&w.x<340).map(w=>w.text).join(' '),change=cash(amounts[0].text),balance=cash(amounts[1].text),interest=/interest/i.test(description);if(previous===null||balance!==previous+(interest?0:change))throw Error('Loan principal balances do not reconcile.');previous=balance;rows.push({date:isoDate(d[2]+'-'+d[1]+'-'+(year-(months[d[1].toLowerCase()]>endMonth?1:0))),description,cents:change,currency:'CAD',bank:'RBC',accountType:'Operating loan',category:interest?'Bank fees':'Transfers',balanceCents:balance});}
 const closing=/Closing\s+Principal\s+Balance\s+(\$[\d,]+\.\d{2})/i.exec(text);if(!rows.length||!closing||previous!==cash(closing[1]))throw Error('Loan closing balance does not reconcile.');return rows;
}

const {parseStatement,money}=require('./workflow');
function quote(v){return '"'+String(v??'').replaceAll('"','""')+'"';}
function recordsToRows(records){
  if(!Array.isArray(records)||!records.length)throw Error('Expected a nonempty transaction list.');
  const keys=[...new Set(records.flatMap(r=>Object.keys(r)))];
  const aliases={transactiondate:'Date',posteddate:'Date',date:'Date',description:'Description',merchant:'Description',payee:'Description',memo:'Description',amount:'Amount',debit:'Debit',credit:'Credit'};
  const selected=keys.filter(k=>aliases[k.toLowerCase().replace(/[ _-]/g,'')]);
  const csv=selected.map(k=>quote(aliases[k.toLowerCase().replace(/[ _-]/g,'')])).join(',')+'\n'+records.map(r=>selected.map(k=>quote(r[k])).join(',')).join('\n');
  return parseStatement(csv).map((r,i)=>{const currency=String(records[i].currency||records[i].Currency||'USD').trim().toUpperCase();if(!/^[A-Z]{3}$/.test(currency))throw Error('Currency must be a three-letter code such as CAD or USD.');return {...r,currency,accountNumber:records[i].accountNumber||records[i]['Account Number']||'',city:records[i].city||'',location:records[i].location||'',channel:records[i].channel||records[i].paymentChannel||''};});
}
function parseExport(text,extension){
  if(extension==='.json'){const data=JSON.parse(text);return recordsToRows(Array.isArray(data)?data:data.transactions);}
  if(['.csv','.tsv','.txt'].includes(extension)){const delimiter=extension==='.tsv'||text.split(/\r?\n/)[0].includes('\t')?'\t':text.split(/\r?\n/)[0].includes(';')?';':',';return parseStatement(text,delimiter);}
  if(['.ofx','.qfx'].includes(extension)){
    const field=(block,name)=>new RegExp('<'+name+'>\\s*([^<\\r\\n]+)','i').exec(block)?.[1].trim();
    const currency=field(text,'CURDEF')||'USD',accountNumber=field(text,'ACCTID')||'';
    const blocks=text.split(/<STMTTRN>/i).slice(1);if(!blocks.length)throw Error('No OFX transactions found.');
    return blocks.map(block=>{block=block.split(/<\/STMTTRN>|<\/BANKTRANLIST>/i)[0];const raw=field(block,'DTPOSTED');if(!/^\d{8}/.test(raw||''))throw Error('Invalid OFX posting date.');const d=raw.slice(0,4)+'-'+raw.slice(4,6)+'-'+raw.slice(6,8),description=[field(block,'NAME'),field(block,'MEMO')].filter(Boolean).join(' · ')||field(block,'TRNTYPE');const row=parseStatement('Date,Description,Amount\n'+[d,description,field(block,'TRNAMT')].map(quote).join(','))[0];return {...row,currency,accountNumber,reference:field(block,'FITID')};});
  }
  if(extension==='.qif'){
    if(!/!Type:(Bank|CCard|Cash)/i.test(text))throw Error('Only Bank, CCard and Cash QIF transactions are supported.');
    const entries=text.split(/^\^\s*$/m).filter(b=>/^D/m.test(b));
    return entries.map(b=>{const get=k=>new RegExp('^'+k+'(.+)$','m').exec(b)?.[1].trim();let d=get('D');d=d?.replace(/'(\d{2})$/,(_,y)=>'/'+(+y<70?'20':'19')+y);return parseStatement('Date,Description,Amount\n'+[d,[get('P'),get('M')].filter(Boolean).join(' · '),get('T')].map(quote).join(','))[0];});
  }
  throw Error('No transaction parser for this format.');
}
module.exports={parseExport,recordsToRows};

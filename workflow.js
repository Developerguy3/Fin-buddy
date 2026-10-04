function csv(text,delimiter=',') {
  const rows = []; let row = [], value = '', quoted = false;
  text = text.replace(/^\uFEFF/, '');
  for (let i=0;i<text.length;i++) {
    const c = text[i];
    if (c === '"') { if (quoted && text[i+1] === '"') { value += '"'; i++; } else quoted = !quoted; }
    else if (c === delimiter && !quoted) { row.push(value.trim()); value=''; }
    else if ((c === '\n' || c === '\r') && !quoted) { if (c === '\r' && text[i+1] === '\n') i++; row.push(value.trim()); if (row.some(Boolean)) rows.push(row); row=[];value=''; }
    else value += c;
  }
  if (quoted) throw new Error('Unclosed quote in CSV.');
  row.push(value.trim()); if (row.some(Boolean)) rows.push(row); return rows;
}
function money(raw) {
  let s = String(raw).trim(); const negative = /^\(.*\)$/.test(s);
  s = s.replace(/[,$£€\s()]/g,'');
  if (!/^[+-]?\d+(\.\d{1,2})?$/.test(s)) throw new Error(`Invalid amount: ${raw}`);
  const cents = Math.round(Number(s)*100) * (negative ? -1 : 1);
  if (!Number.isSafeInteger(cents)) throw new Error('Amount is too large.'); return cents;
}
function date(raw) {
  let y,m,d; let match;
  if ((match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw))) [,y,m,d] = match;
  else if ((match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw))) [,m,d,y] = match;
  else throw new Error(`Invalid date: ${raw}. Use YYYY-MM-DD or US MM/DD/YYYY.`);
  const dt = new Date(Date.UTC(+y,+m-1,+d));
  if(dt.getUTCFullYear()!==+y || dt.getUTCMonth()!==+m-1 || dt.getUTCDate()!==+d) throw new Error(`Invalid date: ${raw}`);
  return `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
}
function parseStatement(text,delimiter=',') {
  const rows = csv(text,delimiter); if(rows.length<2) throw new Error('Statement has no transactions.');
  const h = rows.shift().map(s => s.toLowerCase().replace(/[_-]/g,' ').trim());
  const find = names => h.findIndex(s => names.includes(s));
  const di=find(['date','transaction date','posted date','posting date']);
  const desc=find(['description','merchant','memo','payee','transaction description']);
  const amount=find(['amount','transaction amount']); const debit=find(['debit','withdrawal','withdrawals']); const credit=find(['credit','deposit','deposits']);
  if(di<0 || desc<0 || (amount<0 && (debit<0 || credit<0))) throw new Error('Required columns: Date, Description, Amount (or Debit and Credit).');
  return rows.map((r,i) => {
    try {
      if (r.length !== h.length) throw new Error('Column count does not match header.');
      if (!r[desc]) throw new Error('Missing transaction description.');
      let cents;
      if(amount>=0) cents=money(r[amount]);
      else { const out=r[debit]?money(r[debit]):0, incoming=r[credit]?money(r[credit]):0; if(out<0 || incoming<0 || (out && incoming)) throw new Error('Debit and Credit must be positive and cannot both be populated.'); cents=incoming-out; }
      const metadata={};for(const field of ['city','location','channel','payment channel','currency','account number']){const index=h.indexOf(field);if(index>=0&&r[index])metadata[({'payment channel':'paymentChannel','account number':'accountNumber'})[field]||field]=r[index];}
      return { date:date(r[di]), description:r[desc], cents,...metadata };
    } catch(e) { throw new Error(`Row ${i+2}: ${e.message}`); }
  });
}
function summarize(rows) {
  let income=0,expenses=0,transfers=0;const categories=Object.create(null);
  for(const t of rows) {
    if(!t.category) throw new Error('Uncategorized transaction.');
    if(t.category==='Transfers'||t.isTransfer) {transfers+=t.cents;continue;}
    if(t.cents>0) income+=t.cents; else expenses-=t.cents;
    categories[t.category]=(categories[t.category]||0)+t.cents;
  }
  return {income,expenses,net:income-expenses,transfers,count:rows.length,categories,transactions:rows};
}
module.exports={parseStatement,summarize,money};

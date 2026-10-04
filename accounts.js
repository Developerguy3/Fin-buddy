const path=require('node:path');const crypto=require('node:crypto');
function identifyAccount(source,metadata={}){
  const parts=source.split(/[\\/]/),name=parts[parts.length-1],context=parts.join(' ').toLowerCase();
  const bank=/\brbc\b|royal bank/.test(context)?'RBC':/\bucu\b|ukrainian credit union/.test(context)?'UCU':/\btd\b/.test(context)?'TD':/\bbmo\b/.test(context)?'BMO':/scotia/.test(context)?'Scotiabank':/cibc/.test(context)?'CIBC':null;
  const type=metadata.accountType||(/cheq|chq|checking/.test(name.toLowerCase())?'Chequing':/visa|mastercard|credit.?card/.test(name.toLowerCase())?'Credit card':/operating|oprating|loan/.test(context)?'Operating loan':/cheq|chq|checking/.test(context)?'Chequing':/saving/.test(context)?'Savings':/visa|mastercard|credit.?card/.test(context)?'Credit card':'Account');
  const number=/statement[- _]+(\d{3,6})(?:\s|_)/i.exec(name)?.[1]||(metadata.accountNumber?String(metadata.accountNumber).replace(/\D/g,'').slice(-4):'');
  const parent=parts.length>1?parts[parts.length-2]:'Imported account';
  const owner=metadata.owner||(/\brobis\b/.test(context)?"Robi's":/\bkcc\b/.test(context)?'KCC':'');
  const label=[owner,metadata.bank||bank||parent,({'Chequing':'CHQ','Savings':'SAV','Credit card':'VISA','Operating loan':'LOC'})[type]||type,number?('••'+number):''].filter(Boolean).join(' · ');
  const id=crypto.createHash('sha256').update(label.toLowerCase()).digest('hex').slice(0,12);
  const colors=['#2563eb','#0d9488','#7c3aed','#d97706','#db2777','#475569'];
  const color=bank==='RBC'&&type==='Chequing'?colors[0]:bank==='UCU'?colors[1]:type==='Savings'?colors[2]:type==='Credit card'?colors[3]:colors[parseInt(id.slice(0,2),16)%colors.length];
  return {id,label,owner,bank:metadata.bank||bank||parent,type,color,number:metadata.accountNumber||number||''};
}
module.exports={identifyAccount};

const crypto=require('node:crypto');
function activeTransactions(db){return db.transactions.filter(t=>!t.duplicateOf).flatMap(t=>t.splitParts?.length?t.splitParts:[t]);}
function splitTransaction(t,parts,categories,transferCategory='Transfers'){
  if(!Array.isArray(parts)||parts.length<2||parts.length>20)throw Error('Create between 2 and 20 parts.');
  if(parts.some(p=>!Number.isSafeInteger(p.cents)||!p.cents||Math.sign(p.cents)!==Math.sign(t.cents)))throw Error('Each part must have a positive amount in the same money direction as the original.');
  if(parts.reduce((sum,p)=>sum+p.cents,0)!==t.cents)throw Error('Split amounts must add up exactly to the original transaction.');
  if(parts.some(p=>p.category&&!categories.includes(p.category)))throw Error('Choose valid categories for the split parts.');
  if(parts.some(p=>typeof p.description!=='string'||!p.description.trim()||p.description.length>100))throw Error('Enter a name up to 100 characters for each part.');
  return parts.map(p=>{const {splitParts,...original}=t;return {...original,id:crypto.randomUUID(),parentId:t.id,originalCents:t.cents,originalDescription:t.description,description:t.description+' · '+p.description.trim(),cents:p.cents,category:p.category||null,isTransfer:p.category===transferCategory};});
}
module.exports={activeTransactions,splitTransaction};

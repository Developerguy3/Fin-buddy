const {test}=require('node:test'),assert=require('node:assert/strict');
const {activeTransactions,splitTransaction}=require('./transaction-splits'),{summarize}=require('./workflow');
test('splits preserve signed cents, original metadata, and cash-flow totals',()=>{
  const original={id:'parent',date:'2026-06-01',description:'Purchase',source:'statement.csv',cents:-12345,category:'Shopping',currency:'CAD'};
  const parts=splitTransaction(original,[{description:'Office',cents:-10000,category:'Shopping'},{description:'Personal',cents:-2345,category:'Other'}],['Shopping','Other']);
  const db={transactions:[{...original,splitParts:parts}]},active=activeTransactions(db);assert.equal(active.length,2);assert.equal(active[0].source,original.source);assert.equal(active[0].parentId,'parent');assert.equal(active[0].originalCents,-12345);assert.equal(summarize(active).net,summarize([original]).net);
  assert.throws(()=>splitTransaction(original,[{description:'A',cents:-10000},{description:'B',cents:-2000}],[]),/exactly/);
  assert.throws(()=>splitTransaction(original,[{description:'A',cents:-13345},{description:'B',cents:1000}],[]),/direction/);
  delete db.transactions[0].splitParts;assert.equal(activeTransactions(db).length,1);assert.equal(activeTransactions(db)[0].id,'parent');
});

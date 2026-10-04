const test=require('node:test');
const assert=require('node:assert/strict');
const {keywordMatch,recognize,normalizedMerchant}=require('./recognition');
const {ruleCategories}=require('./review');
const row=(id,description,cents,extra={})=>({id,description,cents,date:'2026-05-20',currency:'CAD',account:{id:'a',owner:'Robi'},...extra});
const run=rows=>recognize(rows,[],{mode:'professional',transferCategory:'Transfers'},ruleCategories);
test('comma rules support phrases, numeric tokens and dotted abbreviations with OR/AND',()=>{
 assert.equal(keywordMatch('V.A. (NESEL)/VA TRANSP','V.A., NESEL, VA'),true);
 assert.equal(keywordMatch('Payment 0233','0233, unknown'),true);
 assert.equal(keywordMatch('Payment 0233','0233, unknown','all'),false);
 assert.equal(keywordMatch('VA TRANSP','VA, TRANSP','all'),true);
 assert.equal(keywordMatch('VALUE','VA'),false);
});
test('incoming e-transfers use signed direction and normalize changing references',()=>{
 const rows=[row('1','e-Transfer - Autodeposit JACK CAabcd123',500),row('2','e-Transfer sent JACK',-500)];run(rows);
 assert.equal(rows[0].category,'Income');assert.equal(rows[0].counterparty,'JACK');assert.equal(rows[1].category,undefined);
 assert.equal(normalizedMerchant('e-Transfer - Autodeposit JACK CAabcd123'),normalizedMerchant('e-Transfer - Autodeposit JACK CAxyz7890'));
});
test('one confirmed correction teaches repeated merchants but preserves conflicts and manual categories',()=>{
 const rows=[row('1','Corner vendor 12345',-500,{category:'Business supplies',categorySource:'user'}),row('2','Corner vendor 67890',-600),row('3','Corner vendor 99999',-700,{category:'Other',categorySource:'user'})];run(rows);assert.equal(rows[1].category,undefined);
 rows.pop();run(rows);assert.equal(rows[1].category,'Business supplies');assert.equal(rows[0].category,'Business supplies');
 const conflict=[row('4','Acme',100)];recognize(conflict,[{pattern:'acme',category:'Income'},{pattern:'acme',category:'Other'}],{transferCategory:'Transfers'},ruleCategories);assert.equal(conflict[0].category,undefined);
});
test('matching own-account transfer pairs are excluded from income',()=>{
 const rows=[row('1','Online banking transfer 0233',500),row('2','Online banking transfer 0233',-500,{account:{id:'b',owner:'Robi'}})];run(rows);assert.deepEqual(rows.map(r=>r.category),['Transfers','Transfers']);assert.equal(rows[0].counterparty,null);
});

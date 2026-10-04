const {test}=require('node:test'),assert=require('node:assert/strict');
const {merchantName,groups,matches,tripSuggestions,channel,ruleCategories,validateScope}=require('./review');
const row=(id,description,extra={})=>({id,description,date:'2026-09-01',cents:-500,currency:'CAD',account:{id:'business',label:'Business'},...extra});
test('merchant grouping normalizes store references and preserves account and direction distinctions',()=>{
  assert.equal(merchantName('POS STARBUCKS #1421'),'STARBUCKS');assert.equal(merchantName('STARBUCKS1421'),'STARBUCKS');
  assert.notEqual(merchantName('Online transfer - 1421'),merchantName('Online transfer - 1531'));
  const rows=[row('1','STARBUCKS #1421'),row('2','STARBUCKS1421'),row('3','STARBUCKS1421',{account:{id:'personal'}}),row('4','STARBUCKS1421',{cents:500}),row('5','STARBUCKS NEW YORK')];
  const result=groups(rows,{});assert.equal(result.length,4);assert.equal(result[0].count,2);assert.equal(rows[0].description,'STARBUCKS #1421');
  assert.equal(groups(rows,{merchantSplits:[{id:'split',name:'Business visit',ids:['2']}]}).length,5);
});
test('scoped rules match account, amount, dates, explicit location and channel',()=>{
  const t=row('1','Amazon Prime',{city:'Toronto',channel:'ecommerce'});
  assert.ok(matches(t,{pattern:'prime',account:'business',min:400,max:600,from:'2026-09-01',to:'2026-09-30',location:'Toronto',channel:'Online / recurring'}));
  assert.ok(!matches(t,{account:'personal'}));assert.ok(!matches(t,{min:501}));assert.equal(channel(row('2','ONLINE SHOP')),'Unknown');
  assert.deepEqual(ruleCategories(t,[{pattern:'amazon',category:'Shopping'},{pattern:'amazon',account:'business',min:400,category:'Business supplies'}]),['Business supplies']);
  assert.throws(()=>validateScope({from:'2026-02-30'}),/date/);assert.throws(()=>validateScope({min:600,max:400}),/range/);
});
test('trips require multiple explicit signals and never infer physical presence',()=>{
  const ts=[row('1','Hotel',{city:'Toronto',channel:'chip'}),row('2','Taxi',{city:'Toronto',date:'2026-09-02',channel:'contactless'}),row('3','Restaurant',{city:'Toronto',date:'2026-09-03'})];
  assert.equal(tripSuggestions(ts.slice(0,1)).length,0);assert.equal(tripSuggestions(ts).length,1);assert.equal(tripSuggestions(ts)[0].confidence,'High-confidence suggestion');
  assert.equal(tripSuggestions(ts,{homeCity:'Toronto'}).length,0);assert.equal(tripSuggestions(ts,{travelEnabled:false}).length,0);
  assert.equal(tripSuggestions(ts.map(t=>({...t,channel:'ecommerce'}))).length,0);assert.equal(tripSuggestions(ts.map(({city,...t})=>t)).length,0);
});
test('local AI rejects remote endpoints and filters invalid suggestions',async()=>{
  const {predict}=require('./local-ai');await assert.rejects(predict({endpoint:'https://example.com',model:'local'},[],[]),/loopback/);
  const server=require('node:http').createServer((req,res)=>{res.end(JSON.stringify({response:JSON.stringify({suggestions:[{id:'g',category:'Dining',confidence:'high'},{id:'g',category:'Invented'},{id:'missing',category:'Dining'}]})}));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));try{const result=await predict({endpoint:'http://127.0.0.1:'+server.address().port,model:'test'},[{id:'g',name:'Cafe',descriptions:['Cafe']}],['Dining']);assert.equal(result.length,1);assert.equal(result[0].category,'Dining');}finally{await new Promise(resolve=>server.close(resolve));}
});

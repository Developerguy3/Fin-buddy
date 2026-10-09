import {test} from 'node:test';import assert from 'node:assert/strict';import {LocalEngine} from './local-engine.js';
test('on-device ledger imports, learns comma rules, reports and isolates persisted profiles without a server',async()=>{
 const memory=new Map(),store={get:async k=>structuredClone(memory.get(k)),set:async(k,v)=>memory.set(k,structuredClone(v))};const engine=await new LocalEngine(store).init();
 const files=[new File(['Date,Description,Amount\n2026-10-01,e-transfer received Alice,100\n2026-10-02,e-transfer sent Bob,-20'], 'bank.csv')];let state=await engine.importFiles(files);assert.equal(state.added,2);assert.equal(state.transactions[0].category,'Income');
 state=await engine.request('/api/categorize',{id:state.transactions[1].id,category:'Other',remember:true,pattern:'e-transfer, alternate',matchMode:'any'});assert.ok(state.transactions.every(t=>t.category==='Other'));const report=await engine.request('/api/report?month=2026-10');assert.equal(report.net,8000);
 state=await engine.importFiles(files);assert.equal(state.added,0);const original=state.activeProfile;
 state=await engine.request('/api/profiles',{action:'create',name:'Company',mode:'professional'});assert.equal(state.transactions.length,0);const restarted=await new LocalEngine(store).init();assert.equal(restarted.snapshot().activeProfile,state.activeProfile);
 state=await restarted.request('/api/profiles',{action:'switch',id:original});assert.equal(state.transactions.length,2);assert.equal(state.rules[0].pattern,'e-transfer, alternate');
});
test('equivalent exports from the same identified account are held out without collapsing repeats within a statement',async()=>{
 const memory=new Map(),store={get:async k=>memory.get(k),set:async(k,v)=>memory.set(k,structuredClone(v))},engine=await new LocalEngine(store).init();
 const csv='Date,Description,Amount\n2026-10-01,Service charge,-5\n2026-10-01,Service charge,-5';
 let state=await engine.importFiles([new File([csv],'RBC-Statement-3185_2026.csv')]);assert.equal(state.transactions.length,2);
 state=await engine.importFiles([new File([csv.replaceAll('\n','\r\n')],'RBC-Statement-3185_2026-copy.csv')]);assert.equal(state.added,0);assert.equal(state.transactions.length,2);assert.equal(state.processing.possibleDuplicates,2);
});

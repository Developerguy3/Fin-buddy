const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function overview(rows,issues=[]){const context=vm.createContext({state:{issues,lastScan:null,transferCategory:'Transfers',merchantGroups:[]},month:'2026-06',scoped:()=>rows,esc:s=>String(s)});vm.runInContext(fs.readFileSync('public/home-ui.js','utf8'),context);return vm.runInContext('overviewCard()',context);}
test('overview excludes transfers and guards unfinished or mixed-currency totals',()=>{
  const rows=[{cents:10000,category:'Income',currency:'CAD'},{cents:-2000,category:'Dining',currency:'CAD'},{cents:-5000,category:'Transfers',currency:'CAD'}];
  const html=overview(rows);assert.ok(html.includes('CA$100.00'));assert.ok(html.includes('CA$20.00'));assert.ok(html.includes('CA$80.00'));assert.ok(html.includes('CA$2.00'));assert.ok(!html.includes('CA$70.00'));
  assert.ok(!overview([...rows,{cents:-100,category:null,currency:'CAD'}]).includes('CA$100.00'));assert.ok(overview(rows,[{message:'Bad statement'}]).includes('unlock these totals'));
  assert.ok(overview([...rows,{cents:500,category:'Income',currency:'USD'}]).includes('multiple currencies'));
});
test('home, ledger and review browser scripts have valid syntax',()=>{for(const file of ['public/home-ui.js','public/review-ui.js','public/ledger-ui.js'])new vm.Script(fs.readFileSync(file,'utf8'));});

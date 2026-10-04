function overviewCard(){
  const rows=scoped(),currencies=[...new Set(rows.map(t=>t.currency||'USD'))],unfinished=rows.filter(t=>!t.category).length;
  const ready=rows.length&&!unfinished&&!state.issues.length&&currencies.length===1;
  const money=n=>new Intl.NumberFormat(undefined,{style:'currency',currency:currencies[0]||'CAD'}).format(n/100);
  const activity=rows.filter(t=>t.category!==state.transferCategory&&!t.isTransfer);
  const income=activity.reduce((sum,t)=>sum+Math.max(0,t.cents),0),expense=activity.reduce((sum,t)=>sum+Math.max(0,-t.cents),0);
  return '<div class="row overview-heading"><div><h2>Monthly cash flow · '+esc(month)+'</h2><p class="muted">'+(state.lastScan?'Last refreshed '+esc(new Date(state.lastScan).toLocaleString()):'Add statement folders to get started')+'</p></div><button id="scan">↻ Refresh</button></div><div class="metrics"><div class="metric"><span class="muted">Income / money in</span><strong>'+ (ready?money(income):'—')+'</strong></div><div class="metric"><span class="muted">Expenses / money out</span><strong>'+(ready?money(expense):'—')+'</strong></div><div class="metric"><span class="muted">Net cash flow</span><strong>'+(ready?money(income-expense):'—')+'</strong></div></div><p class="muted">'+(ready?rows.length+' categorized transactions. Transfers excluded. Refunds are included in money in.':!rows.length?'No transactions imported for this month.':currencies.length>1?'This month contains multiple currencies. A combined report is unavailable.':unfinished+' transactions need review'+(state.issues.length?' and '+state.issues.length+' statements need attention':'')+'. Complete review to unlock these totals.')+'</p>'+(!ready&&rows.length?'<div class="locked-overview"><p>This month has '+rows.length+' imported transactions. Its totals are waiting for review, rather than missing.</p><button id="reviewMonth">Review '+unfinished+' unfinished transactions</button></div>':'')+'<details class="card savings"><summary><b>Suggestions</b></summary><p class="muted">Ideas based on this month’s categorized spending. Potential savings depend on what you choose to change.</p>'+savingsIdeas(rows,ready,money)+'</details>';
}
function savingsIdeas(rows,ready,money){
  if(!ready)return '<p>Complete your transaction review to get spending suggestions based on your categories.</p>';
  const outgoing=rows.filter(t=>t.cents<0&&!t.isTransfer&&t.category!==state.transferCategory),ideas=[];
  const fees=outgoing.filter(t=>/bank fees|service charges/i.test(t.category)||/monthly fee|service charge|pay-file fees/i.test(t.description)).reduce((sum,t)=>sum-t.cents,0);
  if(fees)ideas.push('<b>Review account fees.</b> Transactions categorized as bank and service fees total '+money(fees)+' this month. Check whether your account plan or payment method can reduce them.');
  for(const category of ['Dining','Entertainment','Shopping']){const total=outgoing.filter(t=>t.category===category).reduce((sum,t)=>sum-t.cents,0);if(total)ideas.push('<b>Set a '+esc(category.toLowerCase())+' budget.</b> Spending was '+money(total)+'. Reducing next month’s spending by 10% would save '+money(Math.round(total*.1))+', if this spending is discretionary.');}
  const recurring=[...new Set(state.merchantGroups.filter(g=>g.transactions.some(t=>t.date.startsWith(month)&&t.cents<0)&&new Set(g.transactions.filter(t=>t.cents<0).map(t=>t.date.slice(0,7))).size>=3&&!/TRANSFER|PAYMENT|LOAN|DEPOSIT|WITHDRAWAL|TAX|FEE|INTEREST/.test(g.name)).map(g=>g.name))].slice(0,3);
  if(recurring.length)ideas.push('<b>Check repeat purchases.</b> '+recurring.map(esc).join(', ')+' appear in at least three imported months. Review which purchases or subscriptions you still need; repetition alone does not prove a subscription.');
  if(!ideas.length)return '<p>No specific savings opportunity stands out from the current categories. Review recurring purchases and account fees as more statements are imported.</p>';
  return '<ul class="suggestion-list">'+ideas.map(i=>'<li>'+i+'</li>').join('')+'</ul>';
}
function openHelp(page){
  const pages={
    login:['Login','<p>You are using a local workspace on this computer. Fin Buddy currently has no online account or app login. There is no sign-in form or cloud synchronization.</p>'],
    security:['Security','<p>Your ledger and import cache are stored locally. Statement source files are preserved, and this server listens only on this computer’s loopback address.</p><p>The app has no password lock or built-in encryption. Your Windows account and disk protections control access to the files. Optional AI connections accept only a local loopback endpoint.</p>'],
    about:['About us','<p>Fin Buddy helps you import local statements, categorize transactions, and prepare monthly cash-flow reports. Unknown transactions and import problems require review before a report can be completed.</p>'],
    manual:['User manual','<ol><li><b>Add sources:</b> Open the profile icon → Statement folders, choose one or more folders, then Save & import. Nested folders are included.</li><li><b>Refresh:</b> Use Refresh on Overview to rescan saved sources for new statements. Existing transaction categories are retained.</li><li><b>Review:</b> Open Notifications or Transactions. Choose categories individually or through Merchant review.</li><li><b>Learn:</b> Open Categories & rules to rename categories and edit merchant matching phrases. Rules can apply to future imports.</li><li><b>Report:</b> Select a month and open Monthly report. Resolve all import issues and that month’s unknown transactions, then Generate report.</li></ol><button id="replayTour">Start guided tutorial</button>'],
    faq:['FAQ','<details open><summary>Why are my totals or report locked?</summary><p>A selected month needs complete categories, readable statements, and a single currency.</p></details><details><summary>Does Refresh read subfolders?</summary><p>Yes. All saved source folders and their nested folders are scanned. Duplicate files are skipped.</p></details><details><summary>Are my statements changed?</summary><p>No. Categories, corrections, merchant groups, and trips are saved separately in the local ledger.</p></details><details><summary>Can I add a category?</summary><p>Yes. Choose + Create new category while reviewing a transaction, or + Add category in Categories & rules.</p></details><details><summary>Is there a cloud login?</summary><p>No. This version uses a local workspace. Optional local AI needs an installed compatible model service.</p></details>']
  };
  const entry=pages[page];if(!entry)return;
  document.querySelector('#profileMenu').hidden=true;document.querySelector('#profileButton').setAttribute('aria-expanded','false');
  document.querySelector('#helpTitle').textContent=entry[0];document.querySelector('#helpBody').innerHTML=entry[1];document.querySelector('#helpDialog').showModal();
  document.querySelector('#replayTour')?.addEventListener('click',()=>{document.querySelector('#helpDialog').close();startTour()});
}
let tourStep=0,tourPrevious='overview';
const tourSteps=[
  {title:'Welcome to Fin Buddy',text:'Start with your statement folders. Everything stays in your local workspace. This short guide shows where to import, review, and report.',view:'overview'},
  {title:'1 · Add your statement folders',text:'Open the profile icon next to Fin Buddy, then Statement folders. Use the folder icon to browse, or enter a folder path. Add multiple sources with + Add source. Save & import reads each source and all its subfolders.',view:'settings'},
  {title:'2 · Review your transactions',text:'Transactions holds the monthly ledger. Categories & rules holds bulk Merchant review. Expand a bank to choose its accounts. Use Notifications to find unknown transactions or statement problems. Create categories and save merchant rules as you review.',view:'tasks'},
  {title:'3 · Refresh and report',text:'Overview shows income, expenses, and savings ideas once review is complete. Refresh rescans your saved folders. Monthly report lets you generate and print a report after every unknown transaction and import issue is resolved.',view:'overview'}
];
function showTourStep(){const step=tourSteps[tourStep];view=step.view;render();document.querySelector('#profileMenu').hidden=tourStep!==1;document.querySelector('#profileButton').setAttribute('aria-expanded',String(tourStep===1));document.querySelector('#tourTitle').textContent=step.title;document.querySelector('#tourText').textContent=step.text;document.querySelector('#tourCount').textContent=(tourStep+1)+' of '+tourSteps.length;document.querySelector('#tourBack').disabled=tourStep===0;document.querySelector('#tourNext').textContent=tourStep===tourSteps.length-1?'Finish':'Next';}
function startTour(){tourPrevious=view;tourStep=0;showTourStep();document.querySelector('#tourDialog').showModal()}
function finishTour(){try{localStorage.setItem('finbuddy.tutorial.complete','1')}catch{}document.querySelector('#tourDialog').close();document.querySelector('#profileMenu').hidden=true;document.querySelector('#profileButton').setAttribute('aria-expanded','false');view=tourPrevious;render()}
function initHome(){
  const button=document.querySelector('#profileButton'),menu=document.querySelector('#profileMenu');
  button.onclick=()=>{menu.hidden=!menu.hidden;button.setAttribute('aria-expanded',String(!menu.hidden))};
  menu.querySelectorAll('[data-help]').forEach(b=>b.onclick=()=>openHelp(b.dataset.help));
  document.querySelector('#profileSources').onclick=()=>{menu.hidden=true;button.setAttribute('aria-expanded','false');view='settings';render()};
  document.querySelector('#profileSettings').onclick=()=>{menu.hidden=true;button.setAttribute('aria-expanded','false');view='settings';render()};
  document.querySelector('#helpClose').onclick=()=>document.querySelector('#helpDialog').close();
  document.querySelector('#tourNext').onclick=()=>{if(tourStep===tourSteps.length-1)finishTour();else{tourStep++;showTourStep()}};
  document.querySelector('#tourBack').onclick=()=>{if(tourStep){tourStep--;showTourStep()}};
  document.querySelector('#tourSkip').onclick=finishTour;
  document.querySelector('#tourDialog').addEventListener('cancel',e=>{e.preventDefault();finishTour()});
  document.addEventListener('click',e=>{if(!e.target.closest('.profile-area')&&!document.querySelector('#tourDialog').open){menu.hidden=true;button.setAttribute('aria-expanded','false')}});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'){menu.hidden=true;button.setAttribute('aria-expanded','false')}});
  let seen=false;try{seen=localStorage.getItem('finbuddy.tutorial.complete')==='1'}catch{}if(!seen)startTour();
}

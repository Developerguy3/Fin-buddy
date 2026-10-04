function keywordTerms(value){return [...new Set(String(value||'').split(',').map(s=>s.trim().toLowerCase()).filter(Boolean))];}
function keywordMatch(description,value,mode='any'){
  const terms=keywordTerms(value);if(!terms.length)return false;
  const text=String(description).toLowerCase(),normalized=text.replace(/([a-z])\.(?=[a-z]|\b)/g,'$1');const test=term=>{if(/^[a-z0-9]{1,3}$/i.test(term))return new RegExp('(^|[^a-z0-9])'+term+'([^a-z0-9]|$)','i').test(normalized);return text.includes(term)||normalized.includes(term.replace(/\./g,''));};
  return mode==='all'?terms.every(test):terms.some(test);
}
function normalizedMerchant(description){
  return String(description).toUpperCase().replace(/\be[ -]?transfer\s*(?:-\s*)?(?:autodeposit|received|sent)?\s*/ig,'ETRANSFER ').replace(/\bCA[A-Z0-9]{5,}\b/g,'').replace(/\b(?:POS|PURCHASE|DEBIT PURCHASE)\s+/g,'').replace(/\b\d{4,}\b/g,'').replace(/[^A-Z0-9 '&]/g,' ').replace(/\s+/g,' ').trim();
}
function counterparty(t){
  return /\be[ -]?transfer(?:\s*-\s*)?\s*(?:autodeposit|received|sent)?\s+(.+)/i.exec(t.description)?.[1]?.replace(/\s+CA[A-Z0-9]{5,}\b.*$/i,'').trim()||null;
}
function exactKnowledgeKey(t){return [t.account?.id||'',t.currency||'USD',Math.sign(t.cents),normalizedMerchant(t.description)].join('|');}
function recognize(rows,rules,profile,ruleCategories){
  let count=0;const counts={rules:0,direction:0,merchant:0,knowledge:0};
  const knowledge=new Map();
  for(const t of rows)if(t.category&&(!t.categorySource||t.categorySource==='user')){const k=exactKnowledgeKey(t);if(!knowledge.has(k))knowledge.set(k,new Set());knowledge.get(k).add(t.category);}
  for(const t of rows){
    t.counterparty=counterparty(t);t.transactionKind=/\be[ -]?transfer/i.test(t.description)?'E-transfer':/transfer|\btfr\b/i.test(t.description)?'Transfer':/deposit/i.test(t.description)?'Deposit':'Purchase / payment';
    if(t.category)continue;
    const cats=ruleCategories(t,rules);
    if(cats.length>1){t.recognition={layer:'rules',confidence:'conflict',reason:'Matching rules disagree; review required.'};continue;}
    let category,layer,reason;
    if(cats.length===1){category=cats[0];layer='rules';reason='Matches your saved keyword rule.';}
    else if(!t.counterparty&&/transfer|\btfr\b/i.test(t.description)&&rows.some(other=>other.id!==t.id&&!counterparty(other)&&other.account?.id!==t.account?.id&&other.account?.owner&&other.account.owner===t.account?.owner&&other.currency===t.currency&&other.cents===-t.cents&&Math.abs(Date.parse(other.date)-Date.parse(t.date))<=86400000&&/transfer|\btfr\b/i.test(other.description))){category=profile.transferCategory;layer='direction';reason='Matching opposite amounts between two imported accounts for the same owner: internal transfer.';}
    else if(t.cents>0){category='Income';layer='direction';reason='Positive signed amount: money received'+(t.counterparty?' from '+t.counterparty:'')+'.';}
    else {const known=knowledge.get(exactKnowledgeKey(t));if(known?.size===1){category=[...known][0];layer='knowledge';reason='Same normalized merchant, account and money direction as a prior confirmed transaction.';}
      else {const patterns=[['Bank fees',/monthly\s*fee|service charges?|pay[ -]?file fees?/i],['Utilities',/enbridge|sudbury\s*utl|hydro|electric|sunwire|rogers|bell canada/i],['Transport',/nesel|va\s*transp|ford credit|shell|petro.canada|esso|fuel|taxi|uber|parking/i],['Property taxes',/commercial taxes|property tax|sudbury tax/i],['Insurance',/insurance|gore mutual/i],['Dining',/restaurant|starbucks|tim hortons|mcdonald|pizza|coffee/i],['Groceries',/grocery|supermarket|metro\b|sobeys|loblaws|no frills/i]];
        const hit=patterns.find(([,re])=>re.test(t.description));if(hit){category=hit[0];layer='merchant';reason='Recognized merchant or payment phrase.';}
        if(/staples|office depot/i.test(t.description)){category=profile.mode==='professional'?'Business supplies':'Shopping';layer='merchant';reason='Recognized office retailer, classified using your selected profile.';}
      }
    }
    if(category){t.category=category;t.categorySource=layer;t.recognition={layer,confidence:'high',reason};t.isTransfer=category===profile.transferCategory;counts[layer]++;count++;}
    else t.recognition={layer:'unresolved',confidence:'unknown',reason:'No reliable rule or merchant match; local-model review may help.'};
  }
  return {count,...counts};
}
module.exports={keywordTerms,keywordMatch,normalizedMerchant,counterparty,recognize};

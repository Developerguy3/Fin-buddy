import re
from datetime import date
from decimal import Decimal

M={s.lower():i+1 for i,s in enumerate(['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'])}
N=re.compile(r'^-?\$?[\d,]+\.\d{2}$')
def money(s): return int(Decimal(s.replace('$','').replace(',',''))*100)
def lines(page):
    result=[]
    for w in sorted(page.extract_words(x_tolerance=2),key=lambda w:(round(w['top']/3),w['x0'])):
        if not result or abs(result[-1][0]['top']-w['top'])>3: result.append([w])
        else: result[-1].append(w)
    for line in result: line.sort(key=lambda w:w['x0'])
    return result
def row(d,desc,c,**kwargs): return {'date':d,'description':desc.strip(),'cents':c,'currency':'CAD',**kwargs}
def ucu(pages,text):
    match=re.search(r'ucubiz\s+Basic\s+(\d+)',text,re.I)
    if not match: raise ValueError('UCU account number could not be read.')
    result=[]; pending=None; checks=[]
    for p in pages:
        ls=lines(p); header=next((l for l in ls if 'Debits' in [w['text'] for w in l] and 'Credits' in [w['text'] for w in l]),None)
        if not header: continue
        x=lambda s:next(w['x0'] for w in header if w['text']==s)
        debit,credit,balance=x('Debits'),x('Credits'),x('Balance')
        for l in ls:
            if l[0]['top']<=header[0]['top']:continue
            d=re.fullmatch(r'(\d{2})-([A-Za-z]{3})-(\d{4})',l[0]['text'])
            if d:
                amounts=[(w['x0'],money(w['text'])) for w in l if N.fullmatch(w['text']) and w['x0']>debit-45]
                out=[v for x,v in amounts if x<credit-30]; inc=[v for x,v in amounts if credit-30<=x<balance-40]; bal=[v for x,v in amounts if x>=balance-40]
                if len(out+inc)!=1 or len(bal)!=1:raise ValueError('UCU transaction columns are ambiguous.')
                desc=' '.join(w['text'] for w in l[1:] if w['x0']<debit-45)
                owner="Robi's" if re.search(r"Robi.s Legacy",text,re.I) else 'KCC' if re.search(r'K\.?C\.?C\.?',text) else ''
                pending=row(date(int(d[3]),M[d[2].lower()],int(d[1])).isoformat(),desc,inc[0] if inc else -out[0],accountNumber=match[1],accountType='Chequing',bank='UCU',balanceCents=bal[0],owner=owner)
                result.append(pending)
            elif pending:
                desc=' '.join(w['text'] for w in l if 80<w['x0']<debit-45)
                if re.fullmatch(r'\d+\s+of\s+\d+',desc):continue
                if desc:pending['description']+=' '+desc
    if not result:return []
    for newer,older in zip(result,result[1:]):
        if newer['balanceCents']!=older['balanceCents']+newer['cents']:raise ValueError('UCU running balances do not reconcile.')
    return result
def visa(pages,text):
    period=re.search(r'STATEMENT FROM ([A-Z]{3}) (\d+)(?:, \d{4})? TO ([A-Z]{3}) (\d+), (\d{4})',text)
    if not period:raise ValueError('Visa statement period could not be read.')
    sm,sd,em,ed,y=period.groups();end=date(int(y),M[em.lower()],int(ed));start=date(end.year-(M[sm.lower()]>end.month),M[sm.lower()],int(sd))
    number=re.search(r'4516\s+\d+\*+\s+\*+\s+(\d{4})',text)
    result=[]
    for p in pages:
        for l in lines(p):
            left=' '.join(w['text'] for w in l if w['x0']<365)
            m=re.match(r'^([A-Z]{3}) (\d{1,2}) ([A-Z]{3}) (\d{1,2}) (.+?) (-?\$[\d,]+\.\d{2})$',left)
            if not m:continue
            mon,day,pm,pd,desc,amount=m.groups();year=end.year-(M[mon.lower()]>end.month);d=date(year,M[mon.lower()],int(day))
            if d<start.replace(day=1) or d>end:raise ValueError('Visa date falls outside expected period.')
            result.append(row(d.isoformat(),desc,-money(amount),bank='RBC',accountType='Credit card',accountNumber=number[1] if number else '',postedDate=date(end.year-(M[pm.lower()]>end.month),M[pm.lower()],int(pd)).isoformat(),**({'category':'Transfers'} if re.search(r'PAYMENT.*THANK',desc,re.I) else {})))
    def total(label):
        m=re.search(label+r'\s+(-?\$[\d,]+\.\d{2})',text,re.I)
        if not m:raise ValueError('Visa summary could not be read.')
        return money(m[1])
    opening=total('PREVIOUS STATEMENT BALANCE');closing=total('NEW BALANCE')
    if opening-sum(r['cents'] for r in result)!=closing:raise ValueError('Visa transactions do not reconcile with opening and new balances.')
    return result
def loan(pages,text):
    endmatch=re.search(r'Statement Date:\s+([A-Za-z]+) (\d+), (\d{4})',text)
    if not endmatch:raise ValueError('Loan statement date is unreadable.')
    end=date(int(endmatch[3]),M[endmatch[1][:3].lower()],int(endmatch[2]))
    number=re.search(r'Loan Account Number:\s*([\d ]+)',text)
    result=[];previous=None
    for p in pages:
        for l in lines(p):
            words=[w['text'] for w in l];joined=' '.join(words)
            if 'Opening Principal Balance' in joined and words[-1].startswith('$'):previous=money(words[-1]);continue
            if not re.match(r'^[A-Za-z]{3} \d{2}',joined) or len(words)<4:continue
            amounts=[w for w in l if N.fullmatch(w['text']) and w['x0']>340]
            if len(amounts)!=2:continue
            desc=' '.join(w['text'] for w in l if 175<w['x0']<340)
            change,balance=money(amounts[0]['text']),money(amounts[1]['text'])
            interest='interest' in desc.lower();d=date(end.year-(M[words[0].lower()]>end.month),M[words[0].lower()],int(words[1]))
            if previous is None or balance!=previous+(0 if interest else change):raise ValueError('Loan principal running balances do not reconcile.')
            previous=balance
            result.append(row(d.isoformat(),desc,change,bank='RBC',accountType='Operating loan',accountNumber=re.sub(r'\s','',number[1]) if number else '',balanceCents=balance,category='Bank fees' if interest else 'Transfers'))
    summary=re.search(r'Closing Principal Balance\s+\$([\d,]+\.\d{2})',text)
    if not result or not summary or previous!=money(summary[1]):raise ValueError('Loan closing balance does not reconcile.')
    return result
def online(pages,text):
    result=[];current=None;pending=None;daily=[];number=re.search(r'Current Account\s*\((\d+)\)',text)
    for p in pages:
        for l in lines(p):
            joined=' '.join(w['text'] for w in l)
            if re.match(r'Showing\s+\d+|Sign-up with|Enjoy a rebate|Get Offer',joined):pending=None;current=None;continue
            d=re.match(r'^([A-Za-z]{3}) (\d{1,2}), (\d{4})',joined)
            if d:
                current=date(int(d[3]),M[d[1].lower()],int(d[2])).isoformat();pending=None
                amounts=[w for w in l if N.fullmatch(w['text']) and w['x0']>500]
                if amounts:daily.append([current,money(amounts[-1]['text']),0])
                continue
            amounts=[w for w in l if N.fullmatch(w['text']) and 300<w['x0']<500]
            if current and amounts:
                if len(amounts)>1 and l[0]['top']<200:continue
                if len(amounts)!=1:raise ValueError('Online banking amount is ambiguous.')
                pending=row(current,'',money(amounts[0]['text']),bank='RBC',accountType='Chequing',accountNumber=number[1] if number else '')
                result.append(pending)
                if daily:daily[-1][2]+=pending['cents']
            elif pending:
                desc=' '.join(w['text'] for w in l if w['x0']<300)
                if 'Royal Bank of Canada Website' in desc:continue
                if desc:pending['description']+=' '+desc
    if not result or any(not r['description'].strip() for r in result):raise ValueError('Online banking transactions were not fully readable.')
    for newer,older in zip(daily,daily[1:]):
        if newer[1]!=older[1]+newer[2]:raise ValueError('Online banking daily balances do not reconcile.')
    return result

"""Extract and reconcile bank account statements locally."""
import json, re, sys
from datetime import date
from decimal import Decimal
import pdfplumber
import pdf_layouts

MONTHS = {m.lower(): i + 1 for i, m in enumerate(['January','February','March','April','May','June','July','August','September','October','November','December'])}
SHORT = {m[:3]: n for m, n in MONTHS.items()}
NUMBER = re.compile(r'^-?\d[\d,]*\.\d{2}$')
def cents(s):
    return int(Decimal(s.replace(',', '').replace('$', '').replace('+','').replace('=','').strip()) * 100)

def parse(filename):
    with pdfplumber.open(filename) as pdf:
        pages = [p.dedupe_chars() for p in pdf.pages]
        text = '\n'.join(p.extract_text() or '' for p in pages)
        if len(text.strip())<20:
            import importlib.util,tempfile
            from pathlib import Path
            spec=importlib.util.spec_from_file_location('document_reader',Path(__file__).with_name('document-import.py'))
            reader=importlib.util.module_from_spec(spec);spec.loader.exec_module(reader)
            rows=[]
            with tempfile.TemporaryDirectory() as temp:
                for i,p in enumerate(pages):
                    image=Path(temp)/f'page-{i}.png';p.to_image(resolution=150).save(image);rows.extend(reader.ocr_image(image))
            if not rows:raise ValueError('Scanned PDF contains no validated dated transactions. Review it as a summary or use a transaction export.')
            return rows
        compact = re.sub(r'\s+', '', text)
        owner_header=compact.split('AccountSummary')[0][:650]
        owner='KCC' if re.search(r'K\.?C\.?C\.?INV',owner_header,re.I) else "Robi's" if 'ROBI' in owner_header.upper() else ''
        if 'UkrainianCreditUnion' in compact:return pdf_layouts.ucu(pages,text)
        if 'MonthlyRoyalBusinessOperatingLoanStatement' in compact:return pdf_layouts.loan(pages,text)
        if 'AnnualRoyalBusinessOperatingLoanStatement' in compact:return []
        if 'STATEMENTFROM' in compact and 'Visa' in text:return pdf_layouts.visa(pages,text)
        if 'TransactionsFrom' in compact and 'CurrentAccount' in compact:return pdf_layouts.online(pages,text)
        if 'BusinessAccountStatement' not in compact or 'ROYALBANKOFCANADA' not in compact:
            raise ValueError('Not a supported RBC business account statement. Review this file separately or exclude it if it is not a statement.')
        period = re.search(r'([A-Za-z]+)(\d{1,2}),(\d{4})to([A-Za-z]+)(\d{1,2}),(\d{4})', compact)
        if not period:
            raise ValueError('Statement period was not readable.')
        sm, sd, sy, em, ed, ey = period.groups()
        start, end = date(int(sy), MONTHS[sm.lower()], int(sd)), date(int(ey), MONTHS[em.lower()], int(ed))
        def summary(pattern):
            m = re.search(pattern, compact)
            if not m: raise ValueError('Statement summary was not readable; import stopped for verification.')
            return m.groups()
        opening = cents(summary(r'Openingbalanceon[A-Za-z]+\d{1,2},\d{4}\$(-?[\d,]+\.\d{2})')[0])
        closing = cents(summary(r'Closingbalanceon[A-Za-z]+\d{1,2},\d{4}=\$(-?[\d,]+\.\d{2})')[0])
        credit_count, credit_total = summary(r'Totaldeposits&credits\((\d+)\)\+([\d,]+\.\d{2})')
        debit_count, debit_total = summary(r'Totalcheques&debits\((\d+)\)-([\d,]+\.\d{2})')
        rows, parts, current_date, running = [], [], None, opening
        for page in pages:
            words = page.extract_words(x_tolerance=2)
            lines = []
            for w in sorted(words, key=lambda w: (round(w['top']/3), w['x0'])):
                if not lines or abs(lines[-1][0]['top'] - w['top']) > 3: lines.append([w])
                else: lines[-1].append(w)
            header = next((line for line in lines if any('Cheques&Debits' in w['text'] for w in line) and any('Deposits&Credits' in w['text'] for w in line)), None)
            if header is None: continue
            pos = lambda term: next(w['x0'] for w in header if term in w['text'])
            desc_x, debit_x, credit_x, balance_x = pos('Description'), pos('Cheques&Debits'), pos('Deposits&Credits'), pos('Balance')
            for line in lines:
                if line[0]['top'] <= header[0]['top']: continue
                line.sort(key=lambda w: w['x0'])
                desc = ' '.join(w['text'] for w in line if desc_x - 2 <= w['x0'] < debit_x and not NUMBER.match(w['text']))
                if re.search(r'Closing\s*balance|Account\s*Fees', desc, re.I): break
                if re.search(r'Opening\s*balance', desc, re.I): continue
                date_text = ''.join(w['text'] for w in line if w['x0'] < desc_x - 2)
                dm = re.fullmatch(r'(\d{1,2})([A-Za-z]{3})', date_text)
                if dm:
                    day, mon = int(dm[1]), SHORT.get(dm[2].lower())
                    candidates = [date(y, mon, day) for y in range(start.year, end.year + 1)]
                    current_date = next((d.isoformat() for d in candidates if start <= d <= end), None)
                    if not current_date: raise ValueError('Activity date falls outside statement period.')
                elif date_text and desc:
                    raise ValueError('Unreadable transaction date; import stopped.')
                amounts = [(w['x0'], cents(w['text'])) for w in line if NUMBER.match(w['text']) and w['x0'] >= debit_x - 2]
                debit = [v for x,v in amounts if x < credit_x - 2]
                credit = [v for x,v in amounts if credit_x - 2 <= x < balance_x - 40]
                balance = [v for x,v in amounts if x >= balance_x - 40]
                if desc: parts.append(desc)
                if debit or credit:
                    if not current_date or (debit and credit) or len(debit + credit) != 1: raise ValueError('Ambiguous transaction amount or date.')
                    amount = credit[0] if credit else -debit[0]
                    if not parts: raise ValueError('Missing transaction description.')
                    running += amount
                    if balance and (len(balance) != 1 or balance[0] != running): raise ValueError('Running balance does not reconcile; import stopped.')
                    account=re.search(r'Accountnumber:([\d-]+)',compact)
                    rows.append({'date':current_date,'description':' '.join(parts),'cents':amount,'currency':'CAD','bank':'RBC','accountType':'Chequing','accountNumber':account[1] if account else '', 'owner':owner})
                    parts = []
        credits = [r for r in rows if r['cents'] > 0]
        debits = [r for r in rows if r['cents'] < 0]
        if len(credits) != int(credit_count) or len(debits) != int(debit_count) or sum(r['cents'] for r in credits) != cents(credit_total) or -sum(r['cents'] for r in debits) != cents(debit_total) or running != closing:
            raise ValueError('Extracted transactions do not reconcile with statement totals. No rows imported from this file.')
        return rows

if __name__ == '__main__':
    result = []
    for filename in json.loads(sys.stdin.read()):
        try: result.append({'file':filename,'rows':parse(filename)})
        except Exception as e: result.append({'file':filename,'error':str(e)})
    print(json.dumps(result))

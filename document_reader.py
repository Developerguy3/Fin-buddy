"""Read document content locally; separate financial documents from ledger entries."""
from pathlib import Path
import re,zipfile,json
import xml.etree.ElementTree as ET

def inspect_document(filename):
    path=Path(filename);raw=path.read_bytes();ext=path.suffix.lower();text='';pages=0
    if raw.startswith(b'%PDF'):
        import pdfplumber
        with pdfplumber.open(path) as pdf:
            pages=len(pdf.pages);text='\n\n'.join(page.extract_text(layout=False) or '' for page in pdf.pages)
    elif zipfile.is_zipfile(path):
        with zipfile.ZipFile(path) as z:
            names=z.namelist()
            if 'word/document.xml' in names:
                root=ET.fromstring(z.read('word/document.xml'));text=' '.join(e.text or '' for e in root.iter() if e.tag.endswith('}t'))
            elif 'content.xml' in names:text=' '.join(ET.fromstring(z.read('content.xml')).itertext())
            elif 'xl/workbook.xml' in names:
                import openpyxl
                book=openpyxl.load_workbook(path,read_only=True,data_only=True)
                try:text='\n'.join(sheet.title+'\n'+'\n'.join(' | '.join(str(v or '') for v in row) for row in sheet.values) for sheet in book)
                finally:book.close()
            else:raise ValueError('Archive is not a recognized financial document container.')
    elif ext in ['.png','.jpg','.jpeg','.tif','.tiff','.bmp','.webp']:
        import subprocess,os,tempfile
        from PIL import Image
        if os.name!='nt':raise ValueError('Image OCR requires Windows.')
        with tempfile.TemporaryDirectory() as temp:
            converted=Path(temp)/'document.png'
            with Image.open(path) as image:image.convert('RGB').save(converted)
            r=subprocess.run(['powershell.exe','-NoProfile','-ExecutionPolicy','Bypass','-File',str(Path(__file__).with_name('image-ocr.ps1')),'-ImagePath',str(converted)],capture_output=True,text=True,encoding='utf-8',timeout=90)
            if r.returncode:raise ValueError('OCR could not read the image.')
            text=json.loads(r.stdout)['text']
    elif b'\x00' not in raw[:4000]:
        text=raw.decode('utf-8-sig',errors='replace')
        if ext=='.html' or ext=='.htm':text=re.sub('<[^>]+>',' ',text)
        if ext=='.rtf':text=re.sub(r'\\[a-z]+\d* ?|[{}]',' ',text)
    else:raise ValueError('Binary format cannot be read by the installed document readers.')
    if not text.strip():raise ValueError('No readable text. A scanned PDF needs OCR or a searchable export.')
    lower=text.lower()
    export_header=bool(re.search(r'date[^\n]*description[^\n]*(amount|debit|credit)',lower))
    financial=export_header or bool(re.search(r'\b(statement|invoice|receipt|account balance|bank|credit union|withdrawals|deposits|tax|payment|subtotal|amount due)\b',lower))
    kind='statement' if export_header or re.search(r'\bstatement\b|opening balance|closing balance|account summary',lower) else 'invoice' if 'invoice' in lower else 'receipt' if 'receipt' in lower else 'tax document' if re.search(r'\btax\b',lower) else 'financial document' if financial else 'non-financial document'
    currency='CAD' if re.search(r'\bCAD\b|RBC|Ukrainian Credit|Canadian',text,re.I) else 'USD' if re.search(r'\bUSD\b',text) else None
    totals=re.findall(r'(?:total|amount due|balance)\s*[: ]*\$?\s*([\d,]+\.\d{2})',text,re.I)
    return {'kind':kind,'financial':financial,'pages':pages or 1,'currency':currency,'amounts':totals[-10:],'text':text[:200000],'truncated':len(text)>200000,'charactersRead':len(text)}

def generic_pdf_table(filename):
    import pdfplumber
    records=[]
    with pdfplumber.open(filename) as pdf:
        for page in pdf.pages:
            for table in page.extract_tables():
                header=None
                for row in table:
                    cells=[re.sub(r'\s+',' ',str(v or '')).strip() for v in row];names=[c.lower() for c in cells]
                    if any(n in ['date','transaction date','posted date'] for n in names) and any(n in ['description','merchant','memo','payee'] for n in names):header=cells;continue
                    if header and any(cells):records.append(dict(zip(header,cells)))
    return records

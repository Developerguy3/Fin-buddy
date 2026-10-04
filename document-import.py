import csv,io,json,sys,zipfile,re
from pathlib import Path
from datetime import datetime,date
import xml.etree.ElementTree as ET
from html.parser import HTMLParser
from pdf_import import parse as pdf_parse
from document_reader import inspect_document,generic_pdf_table
import subprocess,tempfile,os
import pdf_layouts
sys.path.insert(0,str(Path(__file__).parent/'vendor'/'python'))

def ocr_image(filename):
    if os.name!='nt':raise ValueError('Image statements need the Windows OCR runtime.')
    result=subprocess.run(['powershell.exe','-NoProfile','-ExecutionPolicy','Bypass','-File',str(Path(__file__).with_name('image-ocr.ps1')),'-ImagePath',str(Path(filename).resolve())],capture_output=True,text=True,encoding='utf-8',timeout=90)
    if result.returncode:raise ValueError('Image text could not be read by Windows OCR. Use a searchable PDF or transaction export.')
    info=json.loads(result.stdout)
    if 'Account Name' in info['text'] and 'Login ID' in info['text']:
        return []
    class Page:
        def extract_words(self,**kwargs):return info['words']
    if 'Ukrainian' in info['text'] and 'Credit Union' in info['text']:
        return pdf_layouts.ucu([Page()],info['text'])
    raise ValueError('Image text was extracted, but its transaction layout could not be validated. Use a supported export.')

def csv_data(rows):
    buffer=io.StringIO();w=csv.writer(buffer)
    for r in rows:w.writerow([v.isoformat()[:10] if isinstance(v,(date,datetime)) else '' if v is None else v for v in r])
    return buffer.getvalue()
def table_rows(rows):
    for i,r in enumerate(rows):
        headers=[str(x or '').lower().strip() for x in r]
        if any(h in ['date','transaction date','posting date','posted date'] for h in headers) and any(h in ['description','merchant','payee','memo'] for h in headers):return csv_data(rows[i:])
    raise ValueError('Could not locate Date, Description and Amount columns.')
class Tables(HTMLParser):
    def __init__(self):super().__init__();self.rows=[];self.row=None;self.cell=None
    def handle_starttag(self,tag,attrs):
        if tag=='tr':self.row=[]
        if tag in ['th','td']:self.cell=''
    def handle_data(self,data):
        if self.cell is not None:self.cell+=data
    def handle_endtag(self,tag):
        if tag in ['th','td'] and self.cell is not None:
            if self.row is not None:self.row.append(self.cell.strip())
            self.cell=None
        if tag=='tr' and self.row:self.rows.append(self.row);self.row=None
def parse_file(filename):
    ext=Path(filename).suffix.lower()
    with open(filename,'rb') as stream:signature=stream.read(5)
    if ext=='.pdf' or signature==b'%PDF-':return {'rows':pdf_parse(filename)}
    if ext in ['.png','.jpg','.jpeg','.tif','.tiff','.bmp','.webp']:
        from PIL import Image
        with tempfile.TemporaryDirectory() as temp:
            converted=Path(temp)/'statement.png'
            with Image.open(filename) as image:image.convert('RGB').save(converted)
            rows=ocr_image(converted)
            return {'rows':rows,**({'note':'Account overview screenshot: balances only, no dated transactions.'} if not rows else {})}
    if ext in ['.xlsx','.xlsm']:
        import openpyxl
        book=openpyxl.load_workbook(filename,read_only=True,data_only=True)
        try:
            records=[]
            for sheet in book:
                try:records.extend(csv.DictReader(io.StringIO(table_rows(list(sheet.values)))))
                except ValueError:continue
            if records:return {'records':records}
        finally:book.close()
        raise ValueError('No transaction table found in workbook.')
    if ext=='.ods':
        with zipfile.ZipFile(filename) as z:root=ET.fromstring(z.read('content.xml'))
        ns={'t':'urn:oasis:names:tc:opendocument:xmlns:table:1.0','x':'urn:oasis:names:tc:opendocument:xmlns:text:1.0','o':'urn:oasis:names:tc:opendocument:xmlns:office:1.0'}
        rows=[]
        for r in root.findall('.//t:table-row',ns):
            cells=[]
            for c in r.findall('t:table-cell',ns):
                v=c.get('{'+ns['o']+'}date-value') or c.get('{'+ns['o']+'}value') or ' '.join(c.itertext()).strip()
                repeat=min(200,int(c.get('{'+ns['t']+'}number-columns-repeated','1')));cells.extend([v]*repeat)
            if any(cells):rows.append(cells)
        return {'csv':table_rows(rows)}
    if ext in ['.html','.htm']:
        parser=Tables();parser.feed(Path(filename).read_text(encoding='utf-8-sig'));return {'csv':table_rows(parser.rows)}
    if ext in ['.xml','.xls']:
        raw=Path(filename).read_bytes()
        if ext=='.xls' and not raw.lstrip().startswith(b'<'):
            import xlrd
            book=xlrd.open_workbook(filename)
            for sheet in book.sheets():
                rows=[]
                for i in range(sheet.nrows):rows.append([xlrd.xldate.xldate_as_datetime(c.value,book.datemode) if c.ctype==xlrd.XL_CELL_DATE else c.value for c in sheet.row(i)])
                try:return {'csv':table_rows(rows)}
                except ValueError:continue
            raise ValueError('No transaction table found in legacy Excel workbook.')
        if not raw.lstrip().startswith(b'<'):raise ValueError('XML statement could not be read.')
        root=ET.fromstring(raw);rows=[];records=[]
        for element in root.iter():
            if element.tag.split('}')[-1].lower()=='row':rows.append([''.join(c.itertext()).strip() for c in element])
            if element.tag.split('}')[-1].lower() in ['transaction','stmttrn']:records.append({c.tag.split('}')[-1]:c.text for c in element})
        return {'records':records} if records else {'csv':table_rows(rows)}
    if ext=='.docx':
        with zipfile.ZipFile(filename) as z:root=ET.fromstring(z.read('word/document.xml'))
        ns={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
        rows=[[''.join(cell.itertext()).strip() for cell in r.findall('w:tc',ns)] for r in root.findall('.//w:tr',ns)]
        return {'csv':table_rows(rows)}
    raise ValueError('No readable transaction table in this format.')
if __name__=='__main__':
    result=[]
    for filename in json.loads(sys.stdin.read()):
        try:result.append({'file':filename,**parse_file(filename)})
        except Exception as e:
            try:
                document=inspect_document(filename)
                if Path(filename).suffix.lower()=='.pdf' and document['kind']=='statement':
                    records=generic_pdf_table(filename)
                    if records:result.append({'file':filename,'records':records,'document':document});continue
                if document['kind']=='statement':result.append({'file':filename,'error':str(e),'document':document})
                else:result.append({'file':filename,'rows':[],'document':document,'note':document['kind'].capitalize()+' indexed separately; no payment inferred from document totals.'})
            except Exception as read_error:result.append({'file':filename,'error':str(e)+' Text reader: '+str(read_error)})
    print(json.dumps(result))

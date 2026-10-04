import unittest,tempfile,zipfile,importlib.util
from pathlib import Path
from datetime import date
spec=importlib.util.spec_from_file_location('importer',Path(__file__).with_name('document-import.py'))
importer=importlib.util.module_from_spec(spec);spec.loader.exec_module(importer)
class Formats(unittest.TestCase):
    def test_excel_and_html(self):
        import openpyxl
        with tempfile.TemporaryDirectory() as folder:
            f=Path(folder)/'bank.xlsx';book=openpyxl.Workbook();book.active.append(['Date','Description','Amount']);book.active.append([date(2026,6,1),'Shop',-12.34]);book.save(f)
            self.assertIn('2026-06-01,Shop,-12.34',importer.parse_file(str(f))['csv'])
            f=Path(folder)/'bank.html';f.write_text('<table><tr><th>Date</th><th>Description</th><th>Amount</th></tr><tr><td>2026-06-01</td><td>Shop</td><td>-12.34</td></tr></table>')
            self.assertIn('2026-06-01,Shop,-12.34',importer.parse_file(str(f))['csv'])
    def test_xml_records_and_ods(self):
        with tempfile.TemporaryDirectory() as folder:
            f=Path(folder)/'bank.xml';f.write_text('<transactions><transaction><date>2026-06-01</date><description>Shop</description><amount>-12.34</amount></transaction></transactions>')
            self.assertEqual(importer.parse_file(str(f))['records'][0]['amount'],'-12.34')
            f=Path(folder)/'bank.ods'
            xml='<root xmlns:t="urn:oasis:names:tc:opendocument:xmlns:table:1.0">'+''.join('<t:table-row>'+''.join('<t:table-cell>'+v+'</t:table-cell>' for v in r)+'</t:table-row>' for r in [['Date','Description','Amount'],['2026-06-01','Shop','-12.34']])+'</root>'
            with zipfile.ZipFile(f,'w') as z:z.writestr('content.xml',xml)
            self.assertIn('2026-06-01,Shop,-12.34',importer.parse_file(str(f))['csv'])
if __name__=='__main__':unittest.main()

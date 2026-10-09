import {PDFDocument,StandardFonts,rgb} from 'pdf-lib';
export async function reportPDF(report,profileName){
 const pdf=await PDFDocument.create(),font=await pdf.embedFont(StandardFonts.Helvetica),bold=await pdf.embedFont(StandardFonts.HelveticaBold),currency=report.currency||'CAD';let page,y;
 const newPage=()=>{page=pdf.addPage([595,842]);y=794;};newPage();
 const clean=value=>[...String(value)].map(char=>{try{font.encodeText(char);return char;}catch{return '?';}}).join('');
 const money=cents=>(cents<0?'-':'')+currency+' '+(Math.abs(cents)/100).toFixed(2);
 const line=(text,strong=false)=>{const selected=strong?bold:font;let part='';for(const char of clean(text)){if(part&&selected.widthOfTextAtSize(part+char,10)>515){if(y<60)newPage();page.drawText(part,{x:40,y,size:10,font:selected,color:rgb(.13,.22,.18)});y-=18;part='';}part+=char;}if(y<60)newPage();page.drawText(part,{x:40,y,size:10,font:selected,color:rgb(.13,.22,.18)});y-=18;};
 line('Fin Buddy - '+report.month,true);line(profileName||'Local workspace');line('Income: '+money(report.income));line('Expenses: '+money(report.expenses));line('Net cash flow: '+money(report.net),true);line('Transfers are excluded from cash flow. This is not a tax statement.');y-=12;
 line('Category breakdown',true);for(const [category,cents] of Object.entries(report.categories))line(category+': '+money(cents));y-=12;line('Monthly transactions',true);
 for(const row of report.transactions){const heading=row.date+'  '+money(row.cents)+'  '+(row.category||'Uncategorized');line(heading,true);line(row.description);y-=6;}
 const pages=pdf.getPages();pages.forEach((p,i)=>p.drawText('Fin Buddy | '+(i+1)+' / '+pages.length,{x:40,y:28,size:8,font}));return pdf.save();
}

import * as XLSX from 'xlsx';
import {unzipSync,strFromU8} from 'fflate';
import {createWorker} from 'tesseract.js';
import formats from '../statement-formats.js';
import {documentKind,positionedStatement,tableRecords} from './document-tables.js';
let ocrWorker;
const progress=message=>{if(typeof window!=='undefined')window.dispatchEvent(new CustomEvent('device-reader-progress',{detail:message}));};
async function ocr(image){let timer;try{return await Promise.race([(async()=>{ocrWorker||=await createWorker('eng',1,{workerPath:'/document-runtime/worker.min.js',corePath:'/document-runtime/core',langPath:'/document-runtime/language',gzip:true,logger:event=>progress('Reading document locally: '+event.status+' '+Math.round((event.progress||0)*100)+'%')});return (await ocrWorker.recognize(image,{}, {text:true,blocks:true})).data;})(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Local OCR timed out. Try a clearer image or correct the extracted transactions.')),120000);})]);}finally{clearTimeout(timer);}}
function grouped(words,tolerance=3){const lines=[];for(const w of words.sort((a,b)=>a.y-b.y||a.x-b.x)){let line=lines.find(l=>Math.abs(l[0].y-w.y)<=tolerance);if(!line){line=[];lines.push(line);}line.push(w);}return lines.map(l=>l.sort((a,b)=>a.x-b.x));}
function ocrLines(data){const words=(data.blocks||[]).flatMap(b=>(b.paragraphs||[]).flatMap(p=>(p.lines||[]).flatMap(l=>(l.words||[]).map(w=>({text:w.text,x:w.bbox.x0,y:w.bbox.y0})))));if(!words.length)throw Error('OCR text has no usable column positions.');return grouped(words,10);}
const info=text=>({kind:documentKind(text),financial:documentKind(text)!=='non-financial document',pages:1,currency:/\bCAD\b/i.test(text)?'CAD':/\bUSD\b/i.test(text)?'USD':null,amounts:[...text.matchAll(/(?:total|amount due|balance)\s*[: ]*\$?\s*([\d,]+\.\d{2})/ig)].map(m=>m[1]).slice(-10),charactersRead:text.length});
function pdfWords(items,height){return items.flatMap(item=>[...item.str.matchAll(/\S+/g)].map(match=>({text:match[0],x:item.transform[4]+item.width*match.index/Math.max(1,item.str.length),y:height-item.transform[5]})));}
async function decodedText(file){const bytes=new Uint8Array(await file.arrayBuffer());return new TextDecoder(bytes[0]===255&&bytes[1]===254?'utf-16le':bytes[0]===254&&bytes[1]===255?'utf-16be':'utf-8').decode(bytes);}
export async function readDocument(file){
 progress('Reading '+file.name+' on this device…');
 if(file.size>50*1024*1024)throw Error('Document exceeds the 50 MB reader limit. Split it into smaller files.');
 const extension=file.name.split('.').pop().toLowerCase();
 if(['csv','tsv','txt','json','ofx','qfx','qif'].includes(extension))return {rows:formats.parseExport(await decodedText(file),'.'+extension)};
 if(['xlsx','xlsm','xls','ods','html','htm'].includes(extension)){
  const book=XLSX.read(await file.arrayBuffer(),{type:'array',cellDates:true});let records=[];for(const name of book.SheetNames){const matrix=XLSX.utils.sheet_to_json(book.Sheets[name],{header:1,defval:''}),preamble=matrix.slice(0,matrix.findIndex(row=>row.some(v=>/^date$/i.test(String(v))))).flat().join(' ');if(/invoice|receipt/i.test(preamble))return {rows:[],document:info(XLSX.utils.sheet_to_csv(book.Sheets[name]))};records.push(...tableRecords(matrix));}
  if(records.length)return {rows:formats.recordsToRows(records)};const text=book.SheetNames.map(n=>XLSX.utils.sheet_to_csv(book.Sheets[n])).join('\n');if(documentKind(text)!=='statement')return {rows:[],document:info(text)};throw Error('No recognized transaction table found in workbook.');
 }
 if(extension==='docx'){
  const files=unzipSync(new Uint8Array(await file.arrayBuffer()),{filter:entry=>entry.name==='word/document.xml'&&entry.originalSize<=20*1024*1024}),raw=files['word/document.xml'];if(!raw)throw Error('Word document content is missing or exceeds the reader limit.');const dom=new DOMParser().parseFromString(strFromU8(raw),'application/xml'),text=[...dom.getElementsByTagNameNS('*','t')].map(e=>e.textContent).join(' ');
  if(documentKind(text)==='invoice'||documentKind(text)==='receipt')return {rows:[],document:info(text)};
  const records=tableRecords([...dom.getElementsByTagNameNS('*','tr')].map(tr=>[...tr.getElementsByTagNameNS('*','tc')].map(tc=>tc.textContent)));
  if(records.length)return {rows:formats.recordsToRows(records)};if(documentKind(text)!=='statement')return {rows:[],document:info(text)};throw Error('No recognized transaction table in Word document.');
 }
 if(extension==='xml'){
  const dom=new DOMParser().parseFromString(await decodedText(file),'application/xml');if(dom.getElementsByTagName('parsererror').length)throw Error('XML document is invalid.');
  const entries=[...dom.getElementsByTagName('*')].filter(e=>['transaction','stmttrn'].includes(e.localName.toLowerCase()));
  if(entries.length)return {rows:formats.recordsToRows(entries.map(e=>Object.fromEntries([...e.children].map(c=>[c.localName,c.textContent]))))};
  const records=tableRecords([...dom.getElementsByTagName('*')].filter(e=>e.localName.toLowerCase()==='row').map(r=>[...r.children].map(c=>c.textContent)));if(records.length)return {rows:formats.recordsToRows(records)};return {rows:[],document:info(dom.documentElement.textContent)};
 }
 let pages=[],text='';
 if(extension==='pdf'){
  const pdfjs=await import('pdfjs-dist/build/pdf.mjs');pdfjs.GlobalWorkerOptions.workerSrc='/document-runtime/pdf.worker.min.mjs';const loading=pdfjs.getDocument({data:new Uint8Array(await file.arrayBuffer()),isEvalSupported:false,standardFontDataUrl:'/document-runtime/standard_fonts/',cMapUrl:'/document-runtime/cmaps/',cMapPacked:true,wasmUrl:'/document-runtime/pdf-wasm/'}),pdf=await loading.promise;
  try{if(pdf.numPages>100)throw Error('Document exceeds the 100-page reader limit.');for(let n=1;n<=pdf.numPages;n++){const page=await pdf.getPage(n),content=await page.getTextContent();if(content.items.some(i=>i.str?.trim())){const viewport=page.getViewport({scale:1});const lines=grouped(pdfWords(content.items.filter(i=>i.str?.trim()),viewport.height));pages.push(lines);text+=lines.map(l=>l.map(w=>w.text).join(' ')).join('\n')+'\n';}else{const viewport=page.getViewport({scale:1.5}),canvas=document.createElement('canvas');canvas.width=viewport.width;canvas.height=viewport.height;await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;const data=await ocr(canvas);pages.push(ocrLines(data));text+=data.text+'\n';canvas.width=canvas.height=0;}page.cleanup();}}finally{await loading.destroy();}
 }else if(['png','jpg','jpeg','bmp','webp','tif','tiff'].includes(extension)){const data=await ocr(file);text=data.text;pages=[ocrLines(data)];}
 else{const raw=await decodedText(file);if(raw.includes('\x00'))throw Error('Unrecognized binary document.');text=raw;}
 const document=info(text);document.pages=pages.length||1;
 if(/Account\s*Name/i.test(text)&&/Login\s*ID/i.test(text)&&!/Transactions\s*From/i.test(text))return {rows:[],document:{...document,kind:'account overview'}};
 if(document.kind!=='statement')return {rows:[],document};
 try{const rows=positionedStatement(pages,text),accountNumber=/Account\s*number:\s*([\d-]+)/i.exec(text)?.[1]||/ucubiz\s+Basic\s+(\d+)/i.exec(text)?.[1]||/4516\s+\d+\*+\s+\*+\s+(\d{4})/.exec(text)?.[1]||'',header=text.split(/Account\s*Summary|Transactions\s*From|Date\s+Description|Debits\s+Credits/i)[0].slice(0,1000),owner=/(?:Account\s*(?:Name|Holder|Owner)|Customer\s*Name)\s*:\s*([^\n]+)/i.exec(header)?.[1]?.trim()||(/Robi.?s\s+Legacy/i.test(header)?"Robi's":/K\.?C\.?C\.?\s*INV/i.test(header)?'KCC':'');return {rows:rows.map(r=>({...r,accountNumber:r.accountNumber||accountNumber,owner,bank:r.bank||(/Ukrainian\s+Credit\s+Union/i.test(text)?'UCU':/RBC|Royal Bank/i.test(text)?'RBC':undefined)})),document};}catch(e){e.document={...document,text:text.slice(0,100000)};throw e;}
}

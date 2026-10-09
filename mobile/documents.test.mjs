import test from 'node:test';import assert from 'node:assert/strict';import * as XLSX from 'xlsx';
import {positionedStatement,tableRecords,documentKind} from './document-tables.js';import {readDocument} from './document-reader.js';
const line=(y,columns)=>columns.map(([x,text])=>({x,y,text}));
test('positioned bank columns preserve direction and enforce running balances',()=>{
 const page=[line(20,[[10,'Date'],[80,'Description'],[300,'Debits'],[400,'Credits'],[500,'Balance']]),line(40,[[10,'01-Oct-2026'],[80,'Customer payment'],[400,'100.00'],[500,'1,100.00']]),line(60,[[10,'02-Oct-2026'],[80,'Shop'],[300,'25.00'],[500,'1,075.00']])];
 const text='CAD account statement Opening balance 1,000.00 Closing balance 1,075.00';const rows=positionedStatement([page],text);assert.deepEqual(rows.map(r=>r.cents),[10000,-2500]);assert.equal(rows[0].date,'2026-10-01');
 page[2].at(-1).text='1,080.00';assert.throws(()=>positionedStatement([page],text),/reconcile/);
});
test('partial bank dates spanning December and January use the statement period rather than footer years',()=>{const page=[line(20,[[10,'Date'],[80,'Description'],[300,'Debits'],[400,'Credits'],[500,'Balance']]),line(40,[[10,'31Dec'],[80,'Customer'],[400,'100.00'],[500,'1,100.00']]),line(60,[[10,'02Jan'],[80,'Shop'],[300,'25.00'],[500,'1,075.00']])];const rows=positionedStatement([page],'CAD account statement December 15, 2026 to January 15, 2027 Opening balance 1,000.00 Closing balance 1,075.00 Copyright 2025');assert.deepEqual(rows.map(r=>r.date),['2026-12-31','2027-01-02']);});
test('credit card signs and summary reconciliation do not confuse payments with spending',()=>{
 const page=[line(20,[[10,'OCT 01 OCT 02 Shop $25.00']]),line(40,[[10,'OCT 03 OCT 04 PAYMENT THANK YOU -$50.00']])];
 const rows=positionedStatement([page],'RBC STATEMENT FROM SEP 30 TO OCT 31, 2026 PREVIOUS STATEMENT BALANCE $100.00 NEW BALANCE $75.00');assert.deepEqual(rows.map(r=>r.cents),[-2500,5000]);assert.equal(rows[1].category,'Transfers');
});
test('invoices are separate documents and every recognized worksheet is read locally',async()=>{
 assert.equal(documentKind('Invoice Acme Amount due $100.00'),'invoice');const book=XLSX.utils.book_new();for(let i=1;i<=2;i++)XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['Date','Description','Amount','Currency'],['2026-10-0'+i,'Shop',-i,'CAD']]),'Account '+i);
 const file=new File([XLSX.write(book,{type:'array',bookType:'xlsx'})],'statement.xlsx');const result=await readDocument(file);assert.equal(result.rows.length,2);assert.deepEqual(result.rows.map(r=>r.cents),[-100,-200]);
 assert.equal(tableRecords([['Unrelated notes']]).length,0);
});

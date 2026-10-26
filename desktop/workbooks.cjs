'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const ExcelJS=require('exceljs');
const JSZip=require('jszip');
const C=require('../shared/core.js');
const {digest}=require('./store.cjs');
const VERSION='1';
const SPECS={
  'Products':{kind:'products',columns:['ID','Revision','SKU','Name','Category','HSN','Unit','Case Pack','Price','Cost','GST Rate','Taxability','Cess Rate','Inclusive','Favourite','Stock Enabled','Opening Stock','Licence','Batch Enabled','Source','Verified By','Verified Date'],keys:['id','revision','sku','name','category','hsn','unit','casePack','price','cost','gstRate','taxability','cessRate','inclusive','favourite','stockEnabled','openingStock','licence','batchEnabled','source','verifiedBy','verifiedDate']},
  'Customers':{kind:'parties',columns:['ID','Revision','Name','GSTIN','Billing Address','Shipping Address','State Code','Phone','Email','Payment Terms'],keys:['id','revision','name','gstin','billingAddress','shippingAddress','stateCode','phone','email','paymentTerms']},
  'Buyer Prices':{kind:'buyerPrices',columns:['ID','Revision','Product ID','Customer ID','Price'],keys:['id','revision','productId','partyId','price']},
  'Settings':{kind:'settings',columns:['Key','Value'],keys:['key','value']},
  'Tax Rules':{kind:'taxRules',columns:['ID','Revision','Product ID','HSN','Rate','Effective From','Effective To','Source','Verified By','Verified Date'],keys:['id','revision','productId','hsn','rate','effectiveFrom','effectiveTo','source','verifiedBy','verifiedDate']},
  'Invoices':{columns:['Document ID','Number','Type','Date','Status','Customer ID','Customer','Taxable','CGST','SGST or UTGST','IGST','Cess','Total','Outstanding','Original ID','Round Off','Reverse Charge']},
  'Invoice Items':{columns:['Document ID','Line ID','Product ID','Name','HSN','Taxability','Quantity','Unit','Unit Price','GST Rate','Taxable','CGST','SGST or UTGST','IGST','Cess','Total']},
  'Payments':{columns:['Payment ID','Date','Customer ID','Customer','Amount','Method','Reference','Voided','Invoice ID','Allocation']},
  'Credits':{columns:['Document ID','Number','Date','Original ID','Customer','Taxable','Tax','Total','Status']},
  'HSN Summary':{columns:['HSN','Taxability','GST Rate','Taxable','CGST','SGST or UTGST','IGST','Cess','Calculated Tax','Reverse Charge']},
  'Monthly Sales':{columns:['Month','Taxable','Output Tax','Total','Recipient Tax']}
};
const BOOL_KEYS=new Set(['inclusive','favourite','stockEnabled','batchEnabled']);
const DEC_KEYS=new Set(['casePack','price','cost','gstRate','cessRate','openingStock','rate']);
const SETTINGS=new Set(['defaultTerms','defaultRate','ewayThreshold','invoiceNotes','prefix']);
function preflight(buffer){
  if(buffer.length>10*1024*1024)throw Error('Workbook is larger than 10 MB. Split the input file.');
  let eocd=-1;for(let i=buffer.length-22;i>=Math.max(0,buffer.length-65557);i--)if(buffer.readUInt32LE(i)===0x06054b50){eocd=i;break;}
  if(eocd<0)throw Error('Not a valid XLSX ZIP file.');
  const count=buffer.readUInt16LE(eocd+10),offset=buffer.readUInt32LE(eocd+16);
  if(count>2000||count===0xffff||offset===0xffffffff)throw Error('Workbook archive has too many entries or uses unsupported ZIP64.');
  let pos=offset,total=0;for(let i=0;i<count;i++){
    if(pos+46>buffer.length||buffer.readUInt32LE(pos)!==0x02014b50)throw Error('Malformed workbook archive.');
    const size=buffer.readUInt32LE(pos+24),nameLen=buffer.readUInt16LE(pos+28),extra=buffer.readUInt16LE(pos+30),comment=buffer.readUInt16LE(pos+32);const name=buffer.subarray(pos+46,pos+46+nameLen).toString();
    total+=size;if(size>25*1024*1024||total>50*1024*1024)throw Error('Workbook expands beyond the supported limit.');
    if(/vbaProject|externalLinks|\.bin$/i.test(name)||name.includes('..')||name.startsWith('/'))throw Error('Macros, external workbook links and unsafe archive paths are not supported.');
    pos+=46+nameLen+extra+comment;
  }
}
function cellValue(cell){
  if(cell.type===ExcelJS.ValueType.Formula||cell.value&&typeof cell.value==='object'&&('formula' in cell.value||'sharedFormula' in cell.value))throw Error('Formulas are not allowed in imported data. Paste plain values.');
  if(cell.value instanceof Date)return cell.value.toISOString().slice(0,10);
  if(cell.value&&typeof cell.value==='object'){if(cell.value.richText)return cell.value.richText.map(r=>r.text).join('');if('text' in cell.value)return String(cell.value.text);throw Error('Use plain text, numbers or dates.');}
  return cell.value===null||cell.value===undefined?'':cell.value;
}
function convert(key,value){
  if(BOOL_KEYS.has(key)){if(!['',true,false,0,1,'true','false','TRUE','FALSE','Yes','No'].includes(value))throw Error(`${key}: use TRUE/FALSE.`);return [true,1,'true','TRUE','Yes'].includes(value);}
  if(key==='revision'){const n=Number(value||0);if(!Number.isInteger(n)||n<0)throw Error('Revision must be a nonnegative integer.');return n;}
  if(DEC_KEYS.has(key)){if(value==='')return '';C.decimal(value,key);return String(value);}
  if(['hsn','stateCode','gstin','sku','id','productId','partyId'].includes(key)&&typeof value==='number'){
    if(key==='hsn'||key==='stateCode')throw Error(`${key}: format as Text to preserve leading zeros.`);
  }
  return String(value).trim();
}
async function previewWorkbook(store,buffer){
  preflight(buffer);
  // ExcelJS expects unprefixed element names. Standards-compliant exports may
  // use x:workbook/x:worksheet; normalise those tags in memory, retaining the input.
  const zip=await JSZip.loadAsync(buffer);let namespaced=false;
  for(const entry of Object.values(zip.files).filter(e=>/\.xml$/.test(e.name)&&!e.dir)){
    let xml=await entry.async('string');
    const prefixes=[...xml.matchAll(/xmlns:([A-Za-z_][\w.-]*)=["']http:\/\/schemas\.openxmlformats\.org\/spreadsheetml\/2006\/main["']/g)].map(m=>m[1]);
    for(const prefix of prefixes){xml=xml.replace(new RegExp('(<\\/?)'+prefix.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+':','g'),'$1');namespaced=true;}
    if(prefixes.length)zip.file(entry.name,xml);
  }
  const book=new ExcelJS.Workbook();try{await book.xlsx.load(namespaced?await zip.generateAsync({type:'nodebuffer'}):buffer);}catch{throw Error('The workbook XML is malformed or unsupported. Save a new .xlsx copy and preview it again.');}
  const readme=book.getWorksheet('Read Me');if(!readme||cellValue(readme.getCell('A1'))!=='Invoice Studio Workbook'||String(cellValue(readme.getCell('B2')))!==VERSION)throw Error('Unsupported workbook version. Export the current template from Invoice Studio.');
  const records=[],errors=[],skipped=[];let updates=0,additions=0;
  const profile=store.profile();
  for(const [name,spec]of Object.entries(SPECS)){
    const sheet=book.getWorksheet(name);if(!sheet||!spec.kind)continue;
    if(sheet.rowCount>10001)throw Error(`${name}: use at most 10,000 rows.`);
    for(let c=0;c<spec.columns.length;c++)if(String(cellValue(sheet.getRow(1).getCell(c+1)))!==spec.columns[c])throw Error(`${name}: column ${c+1} must be ${spec.columns[c]}.`);
    const seen=new Set();const current=spec.kind==='settings'?[]:store.entities(spec.kind);
    for(let row=2;row<=sheet.rowCount;row++){
      try{
        const vals=spec.keys.map((k,i)=>convert(k,cellValue(sheet.getRow(row).getCell(i+1))));
        if(vals.every(x=>x===''||x===false||x===0))continue;
        const record=Object.fromEntries(spec.keys.map((k,i)=>[k,vals[i]]));
        const id=spec.kind==='settings'?record.key:record.id;
        if(!id)throw Error('ID is required. New records also need a stable ID.');if(seen.has(id))throw Error(`Duplicate ID ${id}.`);seen.add(id);
        if(spec.kind==='settings'){
          if(!SETTINGS.has(record.key))throw Error('This setting is not importable. Edit business/bank/security settings in the app.');
          if(record.key==='prefix'&&!/^[A-Z0-9]{1,2}$/.test(record.value))throw Error('Prefix must be 1–2 uppercase letters/digits.');
          if(['defaultRate','ewayThreshold'].includes(record.key)&&record.value!=='')C.decimal(record.value,record.key);
          if(record.value===String(profile[record.key]??'')){skipped.push({sheet:name,row,id,reason:'Unchanged'});continue;}
          records.push({kind:'settings',record,sheet:name,row,action:'update',expectedRevision:profile.revision});updates++;continue;
        }
        const old=current.find(r=>r.id===id);
        const merged={...(old||{}),...record};
        const same=old&&spec.keys.filter(k=>k!=='revision').every(k=>String(old[k]??'')===String(merged[k]??''));
        if(same){skipped.push({sheet:name,row,id,reason:'Unchanged'});continue;}
        if((old?.revision||0)!==record.revision)throw Error('Conflict: this record changed after export. Export again and reconcile your edits.');
        // A workbook never confirms tax verification. It must be reviewed in the app.
        if(['products','taxRules'].includes(spec.kind))merged.verified=false;
        if(spec.kind!=='buyerPrices')store.validateEntity(spec.kind,merged,{skipLinks:true});
        records.push({kind:spec.kind,record:merged,sheet:name,row,action:old?'update':'add'});if(old)updates++;else additions++;
      }catch(e){errors.push({sheet:name,row,message:e.message});}
    }
  }
  const productIds=new Set([...store.entities('products').map(x=>x.id),...records.filter(r=>r.kind==='products').map(r=>r.record.id)]);
  const partyIds=new Set([...store.entities('parties').map(x=>x.id),...records.filter(r=>r.kind==='parties').map(r=>r.record.id)]);
  for(let i=records.length-1;i>=0;i--){const r=records[i];if(r.kind==='buyerPrices'&&(!productIds.has(r.record.productId)||!partyIds.has(r.record.partyId))||r.kind==='taxRules'&&r.record.productId&&!productIds.has(r.record.productId)){errors.push({sheet:r.sheet,row:r.row,message:'Linked product/customer ID does not exist in the database or this import.'});records.splice(i,1);if(r.action==='add')additions--;else updates--;}}
  return {id:randomUUID(),kind:'workbook',hash:digest(buffer),records,errors,skipped,additions,updates,hasTaxReview:records.some(r=>r.kind==='taxRules'),createdAt:Date.now()};
}
async function commitWorkbook(store,preview){
  if(Date.now()-preview.createdAt>15*60*1000)throw Error('Import preview expired. Preview the file again.');
  await store.backup('before-workbook-import');
  return store.tx(()=>{
    const settings=preview.records.filter(r=>r.kind==='settings');
    if(settings.length){const p=store.profile();if(settings.some(r=>r.expectedRevision!==p.revision))throw Error('Settings changed since preview. Preview again.');for(const r of settings)p[r.record.key]=r.record.value;p.revision++;store.db.prepare('UPDATE business_profiles SET revision=?,payload=? WHERE id=?').run(p.revision,JSON.stringify(p),'business');}
    for(const kind of ['products','parties','taxRules','buyerPrices'])for(const r of preview.records.filter(r=>r.kind===kind))store.upsertEntity(kind,r.record,true);
    store.db.prepare('INSERT INTO import_history VALUES(?,?,?,?,?)').run(randomUUID(),new Date().toISOString(),preview.hash,'workbook',JSON.stringify({additions:preview.additions,updates:preview.updates,skipped:preview.skipped.length,errors:preview.errors.length}));store.audit('workbook-imported',preview.id,{hash:preview.hash,count:preview.records.length});return {imported:preview.records.length,skipped:preview.skipped.length+preview.errors.length};
  });
}
function addSheet(book,name,columns,rows){
  const s=book.addWorksheet(name,{views:[{state:'frozen',ySplit:1,showGridLines:false}]});
  s.columns=columns.map(h=>({header:h,key:h,width:/Address|Name|Customer|Source|Reference/.test(h)?32:/ID|HSN|SKU|Date|Terms/.test(h)?23:18}));
  s.getRow(1).font={name:'Arial',size:10,bold:true,color:{argb:'FFFFFFFF'}};s.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF0F766E'}};s.getRow(1).height=30;s.getRow(1).alignment={vertical:'middle',horizontal:'center',wrapText:true};
  for(const values of rows)s.addRow(values.map(v=>v===undefined||v===null?'':v));
  for(let row=2;row<=s.rowCount;row++){s.getRow(row).font={name:'Arial',size:10};s.getRow(row).height=24;s.getRow(row).alignment={vertical:'middle'};s.getRow(row).eachCell((cell,col)=>{if(/HSN|ID|SKU|Code|GSTIN|Reference/.test(columns[col-1]))cell.numFmt='@';if(typeof cell.value==='number')cell.numFmt=/Revision|Quantity/.test(columns[col-1])?'0.######':'#,##0.00';});}
  s.autoFilter={from:{row:1,column:1},to:{row:Math.max(1,s.rowCount),column:columns.length}};return s;
}
async function exportWorkbook(state,{template=false}={}){
  const book=new ExcelJS.Workbook();book.creator='Invoice Studio';book.created=new Date();
  const readme=book.addWorksheet('Read Me',{views:[{showGridLines:false}]});readme.columns=[{width:38},{width:110}];
  readme.addRows([['Invoice Studio Workbook',''],['Workbook Version',VERSION],['Exported At',new Date().toISOString()],['Purpose',template?'Template with fictitious examples. Remove examples before importing live data.':'SQLite is authoritative. Exported invoices/payments/credits are report-only.'],['IDs','Keep IDs and revisions unchanged. New catalogue/customer records require new stable IDs.'],['Import','Preview additions, updates, conflicts and errors before committing. Invalid rows are skipped only after review.'],['Tax review','Imported classifications/rates stay unverified. Confirm official evidence and dates in the app.'],['Plain values','Do not enter formulas, macros or external workbook links. Store HSN, state codes and identifiers as Text.'],['Editable sheets','Products, Customers, Buyer Prices, allowlisted Settings and reviewed Tax Rules.'],['Reports','Invoices, Invoice Items, Payments, Credits, HSN Summary and Monthly Sales cannot overwrite issued history.'],['Rounding','Amounts are INR, rounded half-up per line/component to paise. Unit prices and quantities support six decimal places.']]);
  readme.getRow(1).font={name:'Arial',size:16,bold:true};for(let i=2;i<=readme.rowCount;i++){readme.getRow(i).font={name:'Arial',size:10};readme.getRow(i).height=34;readme.getRow(i).alignment={wrapText:true,vertical:'middle'};}
  const p=state.profile;const sampleProducts=[{id:'EXAMPLE-PRODUCT',revision:0,sku:'DEMO-001',name:'Fictitious sample product',category:'Example',hsn:'001234',unit:'NOS',casePack:'12',price:'100.25',cost:'70',gstRate:'5',taxability:'taxable',cessRate:'0',inclusive:false,favourite:true,stockEnabled:false,openingStock:'0',licence:'',batchEnabled:false,source:'',verifiedBy:'',verifiedDate:''}];
  const sampleParties=[{id:'EXAMPLE-CUSTOMER',revision:0,name:'Fictitious Example Customer',gstin:'',billingAddress:'Example Road, Mumbai',shippingAddress:'Example Road, Mumbai',stateCode:'27',phone:'',email:'',paymentTerms:'Net 15 Days'}];
  for(const [name,spec]of Object.entries(SPECS).filter(([,s])=>s.kind)){
    let records=spec.kind==='settings'?[...SETTINGS].map(key=>({key,value:String(p[key]??'')})):state[spec.kind]||[];
    if(template)records=spec.kind==='products'?sampleProducts:spec.kind==='parties'?sampleParties:spec.kind==='buyerPrices'?[{id:'EXAMPLE-PRICE',revision:0,productId:'EXAMPLE-PRODUCT',partyId:'EXAMPLE-CUSTOMER',price:'95.50'}]:spec.kind==='settings'?records:[];
    const sheet=addSheet(book,name,spec.columns,records.map(r=>spec.keys.map(k=>BOOL_KEYS.has(k)?!!r[k]:k==='revision'?Number(r[k]||0):DEC_KEYS.has(k)&&r[k]!==''&&r[k]!=null?Number(r[k]):r[k]??'')));
    if(name==='Products'){for(let r=2;r<=1001;r++){sheet.getCell(r,12).dataValidation={type:'list',allowBlank:true,formulae:['"taxable,nil,exempt,nonGST"']};for(const c of [14,15,16,19])sheet.getCell(r,c).dataValidation={type:'list',allowBlank:true,formulae:['"TRUE,FALSE"']};}}
  }
  const report=C.reports(state);const docs=template?[]:state.documents.filter(d=>d.snapshot);
  addSheet(book,'Invoices',SPECS.Invoices.columns,docs.map(d=>{const s=d.snapshot,t=s.totals;return[d.id,d.invoiceNumber,d.documentType,d.date,d.status,s.document.retailerId,s.document.retailerName,t.taxable/100,t.cgst/100,t.sgst/100,t.igst/100,t.cess/100,t.total/100,(report.ledger.find(x=>x.documentId===d.id)?.outstanding||0)/100,s.document.originalDocumentId||'',t.roundOff/100,!!s.document.reverseCharge];}));
  addSheet(book,'Invoice Items',SPECS['Invoice Items'].columns,docs.flatMap(d=>d.snapshot.totals.lines.map(l=>[d.id,l.id,l.productId,l.name,String(l.hsn),l.taxability,Number(l.quantity),l.unit,Number(l.unitRate),Number(l.gstRate),l.taxable/100,l.cgst/100,l.sgst/100,l.igst/100,l.cess/100,l.total/100])));
  addSheet(book,'Payments',SPECS.Payments.columns,template?[]:state.payments.flatMap(p=>{const aa=state.allocations.filter(a=>a.paymentId===p.id);return(aa.length?aa:[{documentId:'',amount:0}]).map((a,i)=>[p.id,p.date,p.partyId,p.partyName||'',i===0?p.amount/100:0,p.method,p.reference,p.voided,a.documentId,a.amount/100]);}));
  addSheet(book,'Credits',SPECS.Credits.columns,docs.filter(d=>d.documentType==='CREDIT NOTE').map(d=>[d.id,d.invoiceNumber,d.date,d.snapshot.document.originalDocumentId,d.snapshot.document.retailerName,d.snapshot.totals.taxable/100,d.snapshot.totals.tax/100,d.snapshot.totals.total/100,d.status]));
  addSheet(book,'HSN Summary',SPECS['HSN Summary'].columns,template?[]:report.hsn.map(g=>[String(g.hsn),g.taxability,Number(g.gstRate),g.taxable/100,g.cgst/100,g.sgst/100,g.igst/100,g.cess/100,g.tax/100,g.reverseCharge]));
  addSheet(book,'Monthly Sales',SPECS['Monthly Sales'].columns,template?[]:report.monthly.map(g=>[g.month,g.taxable/100,g.tax/100,g.total/100,g.recipientTax/100]));
  return Buffer.from(await book.xlsx.writeBuffer());
}
function csvCell(value){const s=String(value??'');const safe=typeof value!=='number'&&/^[\s]*[=+\-@\t\r]/.test(s)?"'"+s:s;return '"'+safe.replace(/"/g,'""')+'"';}
function exportCSV(state){
  const rows=[['Reconciliation export - not an official GST portal import file'],['Number','Date','Type','Customer','GSTIN','HSN','Taxability','GST Rate','Taxable INR','CGST INR','SGST/UTGST INR','IGST INR','Cess INR','Line Total INR','Document Round Off INR','Document Total INR','Reverse Charge']];
  for(const d of state.documents.filter(d=>d.status==='finalised'&&['TAX INVOICE','BILL OF SUPPLY','CREDIT NOTE'].includes(d.documentType))){
    const sign=d.documentType==='CREDIT NOTE'?-1:1;
    d.snapshot.totals.lines.forEach((l,index)=>rows.push([d.invoiceNumber,d.date,d.documentType,d.snapshot.document.retailerName,d.snapshot.document.retailerGstin,l.hsn,l.taxability,l.gstRate,...['taxable','cgst','sgst','igst','cess','total'].map(k=>Number((sign*l[k]/100).toFixed(2))),index===0?sign*d.snapshot.totals.roundOff/100:'',index===0?sign*d.snapshot.totals.total/100:'',!!d.snapshot.document.reverseCharge]));
  }
  return Buffer.from('\ufeff'+rows.map(r=>r.map(csvCell).join(',')).join('\r\n'),'utf8');
}
function atomicExport(filename,buffer){const temp=path.join(path.dirname(filename),`.studio-export-${randomUUID()}.tmp`);try{fs.writeFileSync(temp,buffer,{flag:'wx'});fs.renameSync(temp,filename);}catch(e){fs.rmSync(temp,{force:true});if(['EBUSY','EACCES','EPERM'].includes(e.code))throw Error('The workbook/file is open or the folder is read-only. Close it and retry, or use Save As. The existing file was preserved.');throw e;}return digest(buffer);}
module.exports={VERSION,SPECS,SETTINGS,previewWorkbook,commitWorkbook,exportWorkbook,exportCSV,atomicExport,preflight,csvCell};

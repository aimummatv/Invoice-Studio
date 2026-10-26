'use strict';
const {randomUUID}=require('node:crypto');
const C=require('../shared/core.js');
const {digest}=require('./store.cjs');
function parseLegacy(buffer){
  if(buffer.length>10*1024*1024)throw Error('Legacy input exceeds 10 MB.');
  let source=buffer.toString('utf8').replace(/^\uFEFF/,'').trim();
  if(!source.startsWith('{')){const match=source.match(/^(?:\s*\/\/[^\n]*\n)*\s*const\s+INITIAL_DATA\s*=\s*([\s\S]*?);?\s*$/);if(!match)throw Error('Choose an exported JSON file or an original INITIAL_DATA data file.');source=match[1].replace(/;\s*$/,'');}
  let data;try{data=JSON.parse(source);}catch{throw Error('Legacy data is not valid JSON. No JavaScript was executed.');}
  if(!data||!Array.isArray(data.orders)||!Array.isArray(data.contacts))throw Error('Legacy data must contain orders and contacts.');return data;
}
function previewLegacy(store,buffer){
  const data=parseLegacy(buffer),hash=digest(buffer),records=[],errors=[],skipped=[];let additions=0,updates=0;
  for(const [key,kind]of [['products','products'],['contacts','parties'],['orders','documents'],['payments','legacyPayment'],['documents','legacyAttachment']]){
    const seen=new Set();for(const original of data[key]||[]){try{
      if(!original.id)throw Error(`${key} row has no stable ID.`);if(seen.has(original.id))throw Error(`Duplicate legacy ID ${original.id}.`);seen.add(original.id);
      const already=store.db.prepare('SELECT content_hash FROM legacy_records WHERE source_hash=? AND record_type=? AND record_id=?').get(hash,key,original.id);
      if(already?.content_hash===digest(original)){skipped.push({sheet:key,id:original.id,reason:'Already imported'});continue;}
      let record=original;const old=kind==='documents'?store.getDocument(original.id):['products','parties'].includes(kind)?store.entities(kind).find(x=>x.id===original.id):null;
      if(old){errors.push({sheet:key,id:original.id,message:'Conflict with an existing ID. Existing data is protected; reconcile in a separate export.'});continue;}
      if(kind==='products')record={...original,revision:0,sku:original.sku||original.id,unit:'NOS',price:String(original.price??original.mrp??'0'),cost:String(original.cost??original.baseMfgCost??'0'),gstRate:original.gstRate===undefined?'':String(Number(original.gstRate)<=1?Number(original.gstRate)*100:original.gstRate),taxability:'taxable',hsn:String(original.hsn||''),verified:false,stockEnabled:false};
      if(kind==='parties')record={...original,revision:0,gstin:original.gstin||'',billingAddress:original.billingAddress||original.address||'',shippingAddress:original.shippingAddress||original.billingAddress||original.address||''};
      // Legacy source is retained verbatim. Malformed historical GSTINs do not prevent recovery.
      records.push({kind,key,record,original,action:'add'});additions++;
    }catch(e){errors.push({sheet:key,message:e.message});}}
  }
  return{id:randomUUID(),kind:'legacy',hash,records,errors,skipped,additions,updates,createdAt:Date.now(),sourceCounts:Object.fromEntries(['products','contacts','orders','payments','documents'].map(k=>[k,(data[k]||[]).length]))};
}
async function commitLegacy(store,preview){
  if(Date.now()-preview.createdAt>15*60*1000)throw Error('Legacy preview expired. Preview again.');
  await store.backup('before-legacy-migration');
  return store.tx(()=>{
    for(const entry of preview.records){const {kind,record:r,original,key}=entry;
      if(kind==='products'||kind==='parties'){
        const table=kind==='products'?'products':'parties';if(store.db.prepare(`SELECT id FROM ${table} WHERE id=?`).get(r.id))throw Error('A migration ID changed after preview. Preview again.');r.revision=1;store.db.prepare(`INSERT INTO ${table} VALUES(?,?,?)`).run(r.id,1,JSON.stringify(r));
      }else if(kind==='documents'){
        if(store.getDocument(r.id))throw Error('A migration document appeared after preview. Preview again.');
        const d={...C.newDraft(C.TYPES.includes(r.documentType)?r.documentType:'TAX INVOICE',store.profile(),r.id),...r,revision:1,status:'finalised',invoiceNumber:r.invoiceNumber||`LEGACY-${r.id}`,documentType:C.TYPES.includes(r.documentType)?r.documentType:'TAX INVOICE',items:r.items||[]};
        const amount=k=>C.cents(String(Number(r[k]||0)));
        const totals={lines:(r.items||[]).map((l,i)=>({...l,id:l.lineId||`${r.id}-line-${i+1}`,hsn:String(l.hsn||''),quantity:String(l.quantity||0),unitRate:String(l.unitRate||0),gstRate:l.gstRate===undefined?'':String(l.gstRate),taxability:l.taxability||'taxable',base:C.cents(String(l.totalAmount||0)),discount:0,charges:0,taxable:C.cents(String(l.totalAmount||0)),cgst:0,sgst:0,igst:0,cess:0,tax:0,total:C.cents(String(l.totalAmount||0))})),taxGroups:[],taxable:amount('taxableSubtotal'),cgst:amount('cgstAmount'),sgst:amount('sgstAmount'),igst:amount('igstAmount'),cess:0,discount:0,charges:0,roundOff:0,total:amount('totalInvoiceAmount'),secondaryTaxLabel:'SGST'};totals.tax=totals.cgst+totals.sgst+totals.igst;
        const snapshot={version:1,legacy:true,issuedAt:new Date().toISOString(),profile:C.clone(store.profile()),document:C.clone(d),totals,originalRecord:C.clone(original),reviewWarnings:[{message:'Legacy totals and missing tax fields were preserved without repricing. Historical payment balances require reconciliation.'}]};
        store.writeDocument(d,snapshot);
      }
      store.db.prepare('INSERT INTO legacy_records VALUES(?,?,?,?,?)').run(preview.hash,key,String(r.id),digest(original),JSON.stringify(original));
    }
    const counts={imported:preview.records.length,skipped:preview.errors.length+preview.skipped.length,sourceCounts:preview.sourceCounts};
    store.db.prepare('INSERT INTO import_history VALUES(?,?,?,?,?)').run(randomUUID(),new Date().toISOString(),preview.hash,'legacy',JSON.stringify(counts));store.audit('legacy-imported',preview.id,counts);store.verify();return counts;
  });
}
module.exports={parseLegacy,previewLegacy,commitLegacy};

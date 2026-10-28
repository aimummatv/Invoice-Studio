(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    let Decimal;
    try { Decimal = require('decimal.js'); } catch { Decimal = require('../lib/decimal.js'); }
    module.exports = factory(Decimal);
  }
  else root.StudioCore = factory(root.Decimal);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Decimal) {
  'use strict';
  Decimal.set({ precision: 32, rounding: Decimal.ROUND_HALF_UP });
  const TYPES = ['TAX INVOICE', 'PROFORMA INVOICE', 'ADVANCE RECEIPT', 'DELIVERY CHALLAN', 'CREDIT NOTE', 'BILL OF SUPPLY'];
  const SERIES = { 'TAX INVOICE': 'TI', 'PROFORMA INVOICE': 'PI', 'ADVANCE RECEIPT': 'AR', 'DELIVERY CHALLAN': 'DC', 'CREDIT NOTE': 'CN', 'BILL OF SUPPLY': 'BS' };
  const STATES = { '01':'Jammu & Kashmir','02':'Himachal Pradesh','03':'Punjab','04':'Chandigarh','05':'Uttarakhand','06':'Haryana','07':'Delhi','08':'Rajasthan','09':'Uttar Pradesh','10':'Bihar','11':'Sikkim','12':'Arunachal Pradesh','13':'Nagaland','14':'Manipur','15':'Mizoram','16':'Tripura','17':'Meghalaya','18':'Assam','19':'West Bengal','20':'Jharkhand','21':'Odisha','22':'Chhattisgarh','23':'Madhya Pradesh','24':'Gujarat','26':'Dadra & Nagar Haveli and Daman & Diu','27':'Maharashtra','29':'Karnataka','30':'Goa','31':'Lakshadweep','32':'Kerala','33':'Tamil Nadu','34':'Puducherry','35':'Andaman & Nicobar Islands','36':'Telangana','37':'Andhra Pradesh','38':'Ladakh','97':'Other Territory','96':'Outside India' };
  const UTGST = new Set(['04','26','31','35','38','97']);
  const TAXABILITIES = ['taxable', 'nil', 'exempt', 'nonGST'];
  const TREATMENTS = ['domestic', 'exportLUT', 'exportTax', 'SEZLUT', 'SEZTax'];
  const clone = value => JSON.parse(JSON.stringify(value));
  const dateToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year:'numeric',month:'2-digit',day:'2-digit' }).format(new Date());
  function validDate(value) { return /^\d{4}-\d{2}-\d{2}$/.test(String(value)) && !isNaN(Date.parse(value)) && new Date(value + 'T12:00:00Z').toISOString().slice(0,10) === value; }
  function addDays(value, days) { if (!validDate(value)) return ''; const d = new Date(value + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + Number(days)); return d.toISOString().slice(0,10); }
  function dueDate(date, terms, fallback = 15) { const match = String(terms || '').match(/(?:net|within)\s*(\d+)\s*(?:days?)?/i); return addDays(date, match ? Number(match[1]) : /immediate|on receipt|advance/i.test(terms || '') ? 0 : fallback); }
  function fy(date) { if (!validDate(date)) throw Error('Enter a valid document date.'); const y=Number(date.slice(0,4))-(Number(date.slice(5,7))<4?1:0); return `${y}-${String(y+1).slice(2)}`; }
  function decimal(value, name='Number', opts={}) {
    if (value === '' || value === undefined || value === null) value = '0';
    const raw = String(value);
    if (!/^-?\d+(?:\.\d{1,6})?$/.test(raw) || raw.length>24) throw Error(`${name} must be a plain decimal with up to 6 decimal places.`);
    const d = new Decimal(raw);
    if (!d.isFinite() || (!opts.signed && d.isNegative())) throw Error(`${name} cannot be negative.`);
    if (d.abs().gt('90000000000')) throw Error(`${name} exceeds the supported amount.`);
    return d;
  }
  function roundedCents(value) { const n = new Decimal(value).times(100).toDecimalPlaces(0).toNumber(); if(!Number.isSafeInteger(n)) throw Error('Amount exceeds safe storage.'); return n; }
  function cents(value) { return roundedCents(decimal(value,'Amount',{signed:true})); }
  const money = n => new Intl.NumberFormat('en-IN', {style:'currency',currency:'INR',minimumFractionDigits:2}).format((Number(n)||0)/100);
  function gstinValid(input) {
    const s = String(input || '').trim().toUpperCase();
    if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(s) || !STATES[s.slice(0,2)] || s.startsWith('96')) return false;
    const chars='0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'; let factor=2,sum=0;
    for(let i=13;i>=0;i--){const p=chars.indexOf(s[i])*factor;sum+=Math.floor(p/36)+p%36;factor=factor===2?1:2;}
    return chars[(36-sum%36)%36]===s[14];
  }
  const DEFAULT_TERMS = `E.& O.E.
1. Goods once sold will not be taken back.
2. Interest @ 18% p.a. will be charged if the payment is not made with in the stipulated time.
3. Subject to 'Delhi' Jurisdiction only.`;
  function emptyProfile() { return { id:'business', brandName:'Magic Roots', legalName:'Magic Roots Enterprises', tagline:'Pure & Natural', address:'Unit 14, Sunrise Industrial Estate, Kanjurmarg West', city:'Mumbai', stateCode:'27', pincode:'400078', gstin:'27AAACA9876Q1ZM', pan:'AAACA9876Q', registered:true, composition:false, phone:'+91 98201 44552', email:'billing@magicroots.in', fssai:'11523998000421', bankName:'HDFC Bank Ltd', accountNumber:'50200088991122', ifsc:'HDFC0000128', upiId:'magicroots@hdfcbank', logoData:'', invoiceNotes:DEFAULT_TERMS, prefix:'MR', defaultTerms:'Net 15 Days', defaultRate:'', ewayThreshold:'50000', einvoiceApplicable:false, stockEnabled:false, backupRetention:30, autoExport:false, secondaryBackupEnabled:false, currency:'INR', revision:0 }; }
  function defaultAppearance(preset='Detailed') {
    return { preset, bank:true, terms:true, transport:preset==='Transport', shipTo:preset!=='Simple', batch:false, hsnSummary:preset!=='Simple', words:true, discount:preset!=='Simple', balance:true, signature:true, qr:true, cases:preset==='Transport', density:'normal', copyLabel:'Original for Recipient', copies:1, showHsn:true };
  }
  function newDraft(type='TAX INVOICE', profile=emptyProfile(), id) {
    const date=dateToday();
    return { id:id || crypto.randomUUID(), revision:0, status:'draft', documentType:type, invoiceNumber:'', date, paymentTerms:profile.defaultTerms||'Net 15 Days', dueDate:dueDate(date,profile.defaultTerms), dueDateOverride:false, retailerId:'', retailerName:'', retailerGstin:'', customerPhone:'', billingAddress:'', shippingAddress:'', buyerStateCode:'', placeOfSupply:profile.stateCode||'', supplyTreatment:'domestic', reverseCharge:false, items:[], discountPercent:'0', freight:'0', packing:'0', roundOff:'0', originalDocumentId:'', creditReason:'', amountReceived:'', paymentMode:'UPI', utrNumber:'', transporterName:'', lrNumber:'', vehicleNumber:'', driverName:'', ewayBillNumber:'', irn:'', ackNumber:'', ackDate:'', lutReference:'', exportPort:'', shippingBill:'', customNotes:'', appearance:defaultAppearance(), linkedChallanId:'', readinessReviewed:false };
  }
  function newLine(product, profile=emptyProfile(), id) {
    product=product||{};
    return { id:id||crypto.randomUUID(), productId:product.id||'', name:product.name||'', sku:product.sku||'', hsn:String(product.hsn||''), unit:product.unit||'NOS', quantity:'1', unitRate:String(product.price??''), gstRate:String(product.gstRate??profile.defaultRate??''), taxability:product.taxability||'taxable', cessRate:String(product.cessRate||'0'), discountPercent:'0', inclusive:!!product.inclusive, casePack:String(product.casePack||'1'), batch:'', mfgDate:'', expiryDate:'', licence:product.licence||'', verified:!!product.verified, source:product.source||'', cost:String(product.cost||'0'), favourite:!!product.favourite, originalLineId:'' };
  }
  function allocate(total, weights) {
    if (!weights.length) return [];
    const sum=weights.reduce((a,b)=>a.plus(b),new Decimal(0));
    const safe=sum.isZero()?weights.map(()=>new Decimal(1)):weights;
    const denominator=sum.isZero()?new Decimal(weights.length):sum;
    const shares=safe.map((w,i)=>{const exact=new Decimal(total).times(w).div(denominator); return {i,whole:exact.floor().toNumber(),rest:exact.minus(exact.floor())};});
    let left=total-shares.reduce((a,b)=>a+b.whole,0);
    const ranked=[...shares].sort((a,b)=>b.rest.cmp(a.rest)||a.i-b.i);
    for(let i=0;i<left;i++) ranked[i%ranked.length].whole++;
    return shares.map(x=>x.whole);
  }
  function percent(value,name) { const n=decimal(value,name); if(n.gt(100))throw Error(`${name} must be between 0 and 100.`); return n; }
  function calculate(doc, profile=emptyProfile()) {
    if (!TYPES.includes(doc.documentType)) throw Error('Unsupported document type.');
    if (!Array.isArray(doc.items) || doc.items.length>1000) throw Error('Use at most 1,000 line items.');
    if (!TREATMENTS.includes(doc.supplyTreatment||'domestic')) throw Error('Invalid supply treatment.');
    const noTax=doc.documentType==='BILL OF SUPPLY';
    const receipt=doc.documentType==='ADVANCE RECEIPT';
    if(receipt) { const total=cents(doc.amountReceived||'0'); if(total<0)throw Error('Receipt amount cannot be negative.'); return {lines:[],taxGroups:[],taxable:0,discount:0,charges:0,cgst:0,sgst:0,igst:0,cess:0,tax:0,roundOff:0,total,secondaryTaxLabel:'SGST'}; }
    const interstate=(doc.supplyTreatment||'domestic')!=='domestic' || String(doc.placeOfSupply)!==String(profile.stateCode);
    const zeroRated=/LUT$/.test(doc.supplyTreatment||'');
    const secondaryTaxLabel=UTGST.has(String(profile.stateCode))?'UTGST':'SGST';
    const docDiscount=percent(doc.discountPercent||'0','Document discount');
    const prelim=doc.items.filter(x=>!x.isOptional).map((item,index)=>{
      if(!TAXABILITIES.includes(item.taxability||'taxable'))throw Error(`Line ${index+1}: invalid tax category.`);
      const qty=decimal(item.quantity,'Quantity'), price=decimal(item.unitRate,'Unit price');
      const rawRate=percent(item.gstRate||'0','GST rate'), rawCess=percent(item.cessRate||'0','Cess rate');
      const taxed=!noTax && !zeroRated && (item.taxability||'taxable')==='taxable';
      const rate=taxed?rawRate:new Decimal(0), cessRate=taxed?rawCess:new Decimal(0);
      const gross=qty.times(price), lineDiscount=percent(item.discountPercent||'0','Line discount');
      const discounted=gross.times(new Decimal(1).minus(lineDiscount.div(100))).times(new Decimal(1).minus(docDiscount.div(100)));
      const exclusive=item.inclusive?discounted.div(new Decimal(1).plus(rate.plus(cessRate).div(100))):discounted;
      const discount=item.inclusive?gross.minus(discounted).div(new Decimal(1).plus(rate.plus(cessRate).div(100))):gross.minus(discounted);
      return {item,index,qty,price,rate,cessRate,base:roundedCents(exclusive),discount:roundedCents(discount),weight:exclusive};
    });
    const charges=cents(doc.freight||'0')+cents(doc.packing||'0');
    if(charges<0)throw Error('Freight and packing cannot be negative.');
    const allocations=allocate(charges,prelim.map(x=>x.weight));
    if(charges&&!prelim.length)throw Error('Add a line before adding freight or packing.');
    const totals={taxable:0,discount:0,charges,cgst:0,sgst:0,igst:0,cess:0,tax:0,roundOff:cents(doc.roundOff||'0'),total:0,secondaryTaxLabel};
    if(Math.abs(totals.roundOff)>10000)throw Error('Round-off must be within ₹100.');
    const groups=new Map();
    const lines=prelim.map(x=>{
      const taxable=x.base+allocations[x.index];
      const taxBase=new Decimal(taxable);
      const cgst=interstate?0:taxBase.times(x.rate).div(200).toDecimalPlaces(0).toNumber();
      const sgst=cgst;
      const igst=interstate?taxBase.times(x.rate).div(100).toDecimalPlaces(0).toNumber():0;
      const cess=taxBase.times(x.cessRate).div(100).toDecimalPlaces(0).toNumber();
      const tax=cgst+sgst+igst+cess;
      const line={...clone(x.item),quantity:x.qty.toString(),unitRate:x.price.toString(),gstRate:x.rate.toString(),cessRate:x.cessRate.toString(),base:x.base,discount:x.discount,charges:allocations[x.index],taxable,cgst,sgst,igst,cess,tax,total:taxable+(doc.reverseCharge?0:tax)};
      for(const key of ['taxable','discount','cgst','sgst','igst','cess','tax'])totals[key]+=line[key];
      const key=[String(line.hsn||''),line.taxability||'taxable',line.gstRate,line.cessRate].join('|');
      if(!groups.has(key))groups.set(key,{hsn:String(line.hsn||''),taxability:line.taxability||'taxable',gstRate:line.gstRate,cessRate:line.cessRate,taxable:0,cgst:0,sgst:0,igst:0,cess:0,tax:0});
      for(const k of ['taxable','cgst','sgst','igst','cess','tax'])groups.get(key)[k]+=line[k];
      return line;
    });
    totals.total=totals.taxable+(doc.reverseCharge?0:totals.tax)+totals.roundOff;
    if(totals.total<0)throw Error('Round-off cannot make the document total negative.');
    if(!Number.isSafeInteger(totals.total)||Math.abs(totals.total)>9000000000000)throw Error('Document total exceeds supported storage.');
    return {...totals,lines,taxGroups:[...groups.values()]};
  }
  function health(doc, profile, catalogue=[], rules=[]) {
    const issues=[];
    const add=(level,field,message)=>issues.push({level,field,message});
    if(!profile.legalName||!profile.address)add('error','business','Complete your business name and address.');
    if(profile.registered && !gstinValid(profile.gstin))add('error','business','Enter a valid supplier GSTIN, or select unregistered business.');
    if(!STATES[profile.stateCode]||profile.stateCode==='96')add('error','business','Choose the supplier state.');
    if(!doc.retailerName||!doc.billingAddress)add('error','buyer','Enter the buyer name and billing address.');
    if(doc.retailerGstin&&!gstinValid(doc.retailerGstin))add('error','retailerGstin','Buyer GSTIN format/checksum is invalid.');
    if(!validDate(doc.date))add('error','date','Enter a valid document date.');
    if(validDate(doc.date)&&doc.date>dateToday())add('warning','date','The document date is in the future.');
    if(doc.dueDate&&(!validDate(doc.dueDate)||doc.dueDate<doc.date))add('error','dueDate','Due date must be valid and on or after the document date.');
    if(!STATES[doc.placeOfSupply])add('error','placeOfSupply','Choose the Place of Supply independently of the buyer GSTIN.');
    if(doc.retailerGstin&&doc.placeOfSupply!==doc.retailerGstin.slice(0,2))add('warning','placeOfSupply','Place of Supply differs from the GSTIN state. Review bill-to/ship-to treatment.');
    if((!profile.registered||profile.composition)&&doc.documentType==='TAX INVOICE')add('error','documentType','Use Bill of Supply for an unregistered/composition business.');
    if(doc.documentType==='BILL OF SUPPLY'&&!profile.composition&&profile.registered&&(doc.items||[]).some(l=>(l.taxability||'taxable')==='taxable'))add('error','items','A registered business cannot issue a Bill of Supply for ordinary taxable lines. Choose exempt/nil/non-GST or review the business scheme.');
    if(doc.documentType==='ADVANCE RECEIPT') {
      if(!(Number(doc.amountReceived)>0))add('error','amountReceived','Enter a positive amount actually received.');
      add('warning','receipt','Advance receipt records cash received. GST timing on advances requires separate review; no automatic advance tax filing is generated.');
    } else {
      if(!doc.items?.length)add('error','items','Add at least one product or service.');
      const ids=new Set();
      (doc.items||[]).forEach((l,i)=>{
        if(doc.documentType==='CREDIT NOTE'&&Number(l.quantity)===0)return;
        const name=`Line ${i+1}`;
        if(!l.id||ids.has(l.id))add('error','items',`${name}: line IDs must be unique.`); ids.add(l.id);
        if(!l.name||!(Number(l.quantity)>0)||Number(l.unitRate)<0||l.unitRate==='')add('error','items',`${name}: enter a description, positive quantity and nonnegative price.`);
        if(!(Number(l.casePack||1)>0))add('error','items',`${name}: units per case must be positive.`);
        if(!/^\d{4,8}$/.test(String(l.hsn||'')))add('error','items',`${name}: enter the full HSN/SAC (4–8 digits). Reporting requirements need business review.`);
        if((l.taxability||'taxable')==='taxable'&&doc.documentType!=='BILL OF SUPPLY'&&(l.gstRate===''||l.gstRate==null))add('error','items',`${name}: enter a GST rate; none is assumed.`);
        if(!l.verified)add('warning','items',`${name}: classification/rate is unverified.`);
        const p=catalogue.find(p=>p.id===l.productId);
        if(p&&String(p.hsn)!==String(l.hsn))add('warning','items',`${name}: HSN differs from the catalogue.`);
        if(p&&Number(p.price)>0&&Math.abs(Number(l.unitRate)-Number(p.price))/Number(p.price)>0.2)add('warning','items',`${name}: price differs from the catalogue by more than 20%.`);
        if(l.expiryDate&&(!validDate(l.expiryDate)||l.expiryDate<doc.date))add('warning','items',`${name}: expiry is invalid or before supply.`);
        if(l.mfgDate&&(!validDate(l.mfgDate)||(l.expiryDate&&l.mfgDate>l.expiryDate)))add('error','items',`${name}: manufacture/expiry dates are inconsistent.`);
        if(l.cost&&Number(l.unitRate)<Number(l.cost))add('warning','items',`${name}: price is below recorded cost; check tax-inclusive assumptions.`);
        const candidates=rules.filter(r=>(r.productId===l.productId||(!r.productId&&String(r.hsn)===String(l.hsn)))&&(!r.effectiveFrom||r.effectiveFrom<=doc.date)&&(!r.effectiveTo||r.effectiveTo>=doc.date));
        if(candidates.some(r=>String(r.rate)!==String(l.gstRate)))add('warning','items',`${name}: effective tax rule differs from this line. Review supply/payment transition dates.`);
      });
    }
    if(doc.documentType==='CREDIT NOTE'&&!(doc.items||[]).some(l=>Number(l.quantity)>0))add('error','items','Enter at least one positive credit quantity.');
    if(doc.documentType==='CREDIT NOTE'&&!doc.originalDocumentId)add('error','originalDocumentId','Select the original issued invoice.');
    if(doc.documentType==='CREDIT NOTE'&&!doc.creditReason)add('error','creditReason','Enter the credit reason.');
    if((doc.supplyTreatment||'domestic')!=='domestic') {
      add('warning','supplyTreatment','Export/SEZ eligibility, endorsements and return reporting require review.');
      if(/LUT$/.test(doc.supplyTreatment)&&!doc.lutReference)add('error','lutReference','Enter the LUT/bond reference for supply without payment of tax.');
    }
    if(doc.supplyDate&&doc.supplyDate!==doc.date||doc.paymentDate&&doc.paymentDate!==doc.date)add('warning','date','Supply/payment dates differ. Review tax transition and time-of-supply rules.');
    if(profile.einvoiceApplicable&&!doc.irn&&doc.documentType==='TAX INVOICE')add('warning','irn','E-invoice applicability is enabled. No IRN has been generated; the connected service is unavailable.');
    try { const c=calculate(doc,profile); if(c.total>cents(profile.ewayThreshold||'50000')&&!doc.ewayBillNumber&&doc.documentType!=='ADVANCE RECEIPT')add('warning','ewayBillNumber','Value exceeds your configured e-way review threshold. Check applicability and exceptions; no e-way bill is generated.'); } catch(e) {add('error','calculation',e.message);}
    if(doc.appearance?.showHsn===false&&['TAX INVOICE','CREDIT NOTE','BILL OF SUPPLY'].includes(doc.documentType))add('error','appearance','HSN/SAC must remain visible in this document mode.');
    if(doc.appearance?.signature===false&&['TAX INVOICE','CREDIT NOTE','BILL OF SUPPLY','DELIVERY CHALLAN'].includes(doc.documentType))add('error','appearance','Keep the signature area visible for this document. Any statutory electronic-document exemption requires separate review.');
    if(doc.appearance?.shipTo===false&&doc.shippingAddress&&doc.shippingAddress.trim()!==doc.billingAddress.trim()&&['TAX INVOICE','CREDIT NOTE','BILL OF SUPPLY','DELIVERY CHALLAN'].includes(doc.documentType))add('error','appearance','The delivery address differs from billing. Keep the ship-to section visible.');
    return issues;
  }
  function suggestTax(name) {
    const s=String(name||'').toLowerCase();
    const out=[];
    if(/pickle|achaar|achar|preserved/.test(s))out.push({hsn:'2001',label:'Vegetables/fruit preserved by vinegar or acetic acid',confidence:'Medium'});
    if(/sauce|chutney|condiment/.test(s))out.push({hsn:'2103',label:'Sauces and preparations; mixed condiments',confidence:'Medium'});
    if(/juice|drink/.test(s))out.push({hsn:'2009',label:'Fruit/vegetable juices; formulation may change classification',confidence:'Low'});
    if(/service|consult/.test(s))out.push({hsn:'9983',label:'Professional/technical services; choose the full SAC',confidence:'Low'});
    return out.map(x=>({...x,status:'Suggested — verify',rate:null}));
  }
  function numberWords(amount) {
    const paise=Math.abs(Math.round(Number(amount)||0)); const whole=Math.floor(paise/100), fraction=paise%100;
    const ones=['Zero','One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen'];
    const tens=['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'];
    function word(n){if(n<20)return ones[n];if(n<100)return tens[Math.floor(n/10)]+(n%10?' '+ones[n%10]:'');if(n<1000)return word(Math.floor(n/100))+' Hundred'+(n%100?' '+word(n%100):'');for(const [v,label] of [[10000000,'Crore'],[100000,'Lakh'],[1000,'Thousand']])if(n>=v)return word(Math.floor(n/v))+' '+label+(n%v?' '+word(n%v):'');}
    return `${amount<0?'Minus ':''}${word(whole)} Rupees${fraction?' and '+word(fraction)+' Paise':''} Only`;
  }
  function reports(state, from='', to='', asOf=dateToday()) {
    const issued=state.documents.filter(d=>d.status==='finalised'&&d.snapshot);
    const sales=issued.filter(d=>['TAX INVOICE','BILL OF SUPPLY','CREDIT NOTE'].includes(d.documentType));
    const period=sales.filter(d=>(!from||d.date>=from)&&(!to||d.date<=to));
    const ledger=new Map();
    for(const d of issued.filter(d=>['TAX INVOICE','BILL OF SUPPLY'].includes(d.documentType))){
      const payments=(state.allocations||[]).filter(a=>a.documentId===d.id && !(state.payments||[]).find(p=>p.id===a.paymentId)?.voided).reduce((s,a)=>s+a.amount,0);
      const credit=issued.filter(c=>c.documentType==='CREDIT NOTE'&&c.snapshot.document.originalDocumentId===d.id).reduce((s,c)=>s+c.snapshot.totals.total,0);
      const outstanding=d.snapshot.totals.total-payments-credit;
      const days=Math.max(0,Math.floor((Date.parse(asOf+'T12:00:00Z')-Date.parse((d.snapshot.document.dueDate||d.date)+'T12:00:00Z'))/86400000));
      ledger.set(d.id,{documentId:d.id,number:d.invoiceNumber,partyId:d.snapshot.document.retailerId||'',party:d.snapshot.document.retailerName,dueDate:d.snapshot.document.dueDate||d.date,total:d.snapshot.totals.total,paid:payments,credits:credit,outstanding,days,bucket:days===0?'Current':days<=30?'1–30':days<=60?'31–60':days<=90?'61–90':'90+'});
    }
    const monthly=new Map(),hsn=new Map(); let turnover=0,tax=0,recipientTax=0;
    for(const d of period){
      const sign=d.documentType==='CREDIT NOTE'?-1:1,t=d.snapshot.totals,rcm=!!d.snapshot.document.reverseCharge;
      turnover+=sign*t.total;tax+=sign*(rcm?0:t.tax);recipientTax+=sign*(rcm?t.tax:0);
      const month=d.date.slice(0,7);if(!monthly.has(month))monthly.set(month,{month,taxable:0,tax:0,total:0,recipientTax:0});
      const m=monthly.get(month);m.taxable+=sign*t.taxable;m.total+=sign*t.total;m.tax+=sign*(rcm?0:t.tax);m.recipientTax+=sign*(rcm?t.tax:0);
      for(const g of t.taxGroups||[]){const key=[g.hsn,g.taxability,g.gstRate,g.cessRate,rcm].join('|');if(!hsn.has(key))hsn.set(key,{...g,reverseCharge:rcm,taxable:0,cgst:0,sgst:0,igst:0,cess:0,tax:0});for(const k of ['taxable','cgst','sgst','igst','cess','tax'])hsn.get(key)[k]+=sign*g[k];}
    }
    const parties=new Map();for(const row of ledger.values()){const key=row.partyId||row.party;if(!parties.has(key))parties.set(key,{party:row.party,outstanding:0,Current:0,'1–30':0,'31–60':0,'61–90':0,'90+':0});parties.get(key).outstanding+=row.outstanding;parties.get(key)[row.bucket]+=row.outstanding;}
    return {turnover,tax,recipientTax,outstanding:[...ledger.values()].reduce((s,r)=>s+r.outstanding,0),monthly:[...monthly.values()].sort((a,b)=>a.month.localeCompare(b.month)),hsn:[...hsn.values()],ledger:[...ledger.values()],parties:[...parties.values()]};
  }
  return {TYPES,SERIES,STATES,TAXABILITIES,TREATMENTS,DEFAULT_TERMS,clone,dateToday,validDate,addDays,dueDate,fy,decimal,cents,money,gstinValid,emptyProfile,defaultAppearance,newDraft,newLine,allocate,calculate,health,suggestTax,numberWords,reports};
});

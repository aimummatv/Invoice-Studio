'use strict';
const { DatabaseSync, backup } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const C = require('../shared/core.js');
const SCHEMA_VERSION = 1;
const ENTITY_TABLES = { products:'products', parties:'parties', buyerPrices:'buyer_prices', taxRules:'tax_rules', presets:'appearance_presets' };
const digest = x => createHash('sha256').update(typeof x==='string'?x:JSON.stringify(x)).digest('hex');
const json = value => JSON.stringify(value);
const parse = value => value ? JSON.parse(value) : null;
function bounded(value, max=2000000) { const text=json(value); if(!text||text.length>max)throw Error('The record is too large.'); return text; }
function assertId(id) { if(typeof id!=='string'||!/^[\w.-]{1,100}$/.test(id))throw Error('Use an ID of 1–100 letters, digits, underscores, dots or hyphens.'); }
function errorMessage(e) { if(/SQLITE_BUSY|locked/i.test(e.message))return 'The database is busy. Close other instances and retry.';if(/readonly|read-only|EACCES|EPERM/i.test(e.message))return 'The data folder is read-only or locked. Choose a writable folder.';if(/SQLITE_FULL|ENOSPC/i.test(e.message))return 'The disk is full. Free space and retry; the previous saved data is intact.';return e.message; }

class Store {
  constructor(folder,{mustExist=false}={}) {
    this.folder=path.resolve(folder); this.filename=path.join(this.folder,'InvoiceStudio.db');
    if(mustExist&&(!fs.existsSync(this.folder)||!fs.existsSync(this.filename)))throw Error('The configured data folder/database is unavailable. Reconnect it or choose the existing database in recovery. No empty database was created.');
    if(!mustExist)fs.mkdirSync(this.folder,{recursive:true});
    fs.accessSync(this.folder,fs.constants.R_OK|fs.constants.W_OK);
    this.open();
  }
  open() {
    this.db=new DatabaseSync(this.filename);
    this.db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
    const v=this.db.prepare('PRAGMA user_version').get().user_version;
    if(v>SCHEMA_VERSION){this.db.close();throw Error('This database needs a newer version of Invoice Studio.');}
    if(v===0)this.migrate();
    this.verify();
    this.lastAutoBackup=0;
  }
  migrate() {
    // Version 1 is the only release schema. Later migrations must run after a consistent pre-upgrade backup.
    this.db.exec(`BEGIN IMMEDIATE;
      CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL);
      CREATE TABLE business_profiles(id TEXT PRIMARY KEY,revision INTEGER NOT NULL,payload TEXT NOT NULL);
      CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE products(id TEXT PRIMARY KEY,revision INTEGER NOT NULL,payload TEXT NOT NULL);
      CREATE TABLE parties(id TEXT PRIMARY KEY,revision INTEGER NOT NULL,payload TEXT NOT NULL);
      CREATE TABLE buyer_prices(id TEXT PRIMARY KEY,revision INTEGER NOT NULL,product_id TEXT REFERENCES products(id),party_id TEXT REFERENCES parties(id),payload TEXT NOT NULL,UNIQUE(product_id,party_id));
      CREATE TABLE tax_rules(id TEXT PRIMARY KEY,revision INTEGER NOT NULL,payload TEXT NOT NULL);
      CREATE TABLE appearance_presets(id TEXT PRIMARY KEY,revision INTEGER NOT NULL,payload TEXT NOT NULL);
      CREATE TABLE documents(id TEXT PRIMARY KEY,revision INTEGER NOT NULL,status TEXT NOT NULL CHECK(status IN('draft','finalised','cancelled')),document_type TEXT NOT NULL,invoice_number TEXT UNIQUE,date TEXT NOT NULL,party_id TEXT,payload TEXT NOT NULL,snapshot TEXT,snapshot_hash TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
      CREATE TABLE document_lines(document_id TEXT NOT NULL REFERENCES documents(id),line_id TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(document_id,line_id));
      CREATE TABLE tax_breakdowns(document_id TEXT NOT NULL REFERENCES documents(id),group_key TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(document_id,group_key));
      CREATE TABLE number_series(business_id TEXT NOT NULL,financial_year TEXT NOT NULL,document_type TEXT NOT NULL,last_number INTEGER NOT NULL,PRIMARY KEY(business_id,financial_year,document_type));
      CREATE TABLE payments(id TEXT PRIMARY KEY,revision INTEGER NOT NULL,party_id TEXT,date TEXT NOT NULL,amount INTEGER NOT NULL CHECK(amount>0),method TEXT NOT NULL,reference TEXT NOT NULL,voided INTEGER NOT NULL DEFAULT 0,payload TEXT NOT NULL);
      CREATE TABLE payment_allocations(id TEXT PRIMARY KEY,payment_id TEXT NOT NULL REFERENCES payments(id),document_id TEXT NOT NULL REFERENCES documents(id),amount INTEGER NOT NULL CHECK(amount>0));
      CREATE TABLE audit_events(id TEXT PRIMARY KEY,at TEXT NOT NULL,kind TEXT NOT NULL,record_id TEXT NOT NULL,payload TEXT NOT NULL);
      CREATE TABLE import_history(id TEXT PRIMARY KEY,at TEXT NOT NULL,source_hash TEXT NOT NULL,kind TEXT NOT NULL,payload TEXT NOT NULL);
      CREATE TABLE export_history(id TEXT PRIMARY KEY,at TEXT NOT NULL,path TEXT NOT NULL,hash TEXT NOT NULL,kind TEXT NOT NULL);
      CREATE TABLE backup_history(id TEXT PRIMARY KEY,at TEXT NOT NULL,path TEXT NOT NULL,hash TEXT NOT NULL,reason TEXT NOT NULL);
      CREATE TABLE legacy_records(source_hash TEXT NOT NULL,record_type TEXT NOT NULL,record_id TEXT NOT NULL,content_hash TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(source_hash,record_type,record_id));
      CREATE TABLE product_batches(id TEXT PRIMARY KEY,product_id TEXT REFERENCES products(id),payload TEXT NOT NULL);
      CREATE TABLE stock_movements(id TEXT PRIMARY KEY,product_id TEXT NOT NULL REFERENCES products(id),document_id TEXT REFERENCES documents(id),quantity TEXT NOT NULL,kind TEXT NOT NULL,at TEXT NOT NULL,payload TEXT NOT NULL);
      CREATE INDEX document_date_idx ON documents(date,status,document_type);
      CREATE INDEX allocations_document_idx ON payment_allocations(document_id);
      PRAGMA user_version=1;`);
    this.db.prepare('INSERT INTO schema_migrations VALUES(?,?)').run(1,new Date().toISOString());
    this.db.prepare('INSERT INTO business_profiles VALUES(?,?,?)').run('business',1,json({...C.emptyProfile(),revision:1}));
    for(const name of ['Simple','Detailed','Transport'])this.db.prepare('INSERT INTO appearance_presets VALUES(?,?,?)').run(name,1,json({id:name,revision:1,...C.defaultAppearance(name)}));
    this.db.exec('COMMIT');
  }
  tx(fn) { this.db.exec('BEGIN IMMEDIATE');try{const out=fn();this.db.exec('COMMIT');return out;}catch(e){this.db.exec('ROLLBACK');throw Error(errorMessage(e));} }
  audit(kind,id,payload={}){this.db.prepare('INSERT INTO audit_events VALUES(?,?,?,?,?)').run(randomUUID(),new Date().toISOString(),kind,id,bounded(payload));}
  profile(){
    const row = this.db.prepare('SELECT payload FROM business_profiles WHERE id=?').get('business');
    if(!row) return C.emptyProfile();
    const p = parse(row.payload);
    const def = C.emptyProfile();
    if(!p.invoiceNotes || !p.invoiceNotes.trim()) p.invoiceNotes = def.invoiceNotes;
    if(p.legalName === 'Amrit Ras Consumer Products LLP') p.legalName = def.legalName;
    if(!p.brandName) p.brandName = def.brandName;
    if(p.logoData === undefined) p.logoData = '';
    if(p.pan === undefined) p.pan = def.pan;
    if(p.tagline === undefined) p.tagline = def.tagline;
    return p;
  }
  entities(kind){const table=ENTITY_TABLES[kind];if(!table)throw Error('Unsupported collection.');return this.db.prepare(`SELECT payload FROM ${table} ORDER BY rowid`).all().map(r=>parse(r.payload));}
  getDocument(id){assertId(id);const r=this.db.prepare('SELECT * FROM documents WHERE id=?').get(id);return r?{...parse(r.payload),id:r.id,revision:r.revision,status:r.status,invoiceNumber:r.invoice_number||'',documentType:r.document_type,date:r.date,snapshot:parse(r.snapshot),snapshotHash:r.snapshot_hash}:null;}
  state(){
    const documents=this.db.prepare('SELECT id FROM documents ORDER BY created_at DESC').all().map(r=>this.getDocument(r.id));
    const payments=this.db.prepare('SELECT * FROM payments ORDER BY date DESC,rowid DESC').all().map(r=>({...parse(r.payload),id:r.id,revision:r.revision,partyId:r.party_id,date:r.date,amount:r.amount,method:r.method,reference:r.reference,voided:!!r.voided}));
    const allocations=this.db.prepare('SELECT id,payment_id AS paymentId,document_id AS documentId,amount FROM payment_allocations').all();
    return {profile:this.profile(),products:this.entities('products'),parties:this.entities('parties'),buyerPrices:this.entities('buyerPrices'),taxRules:this.entities('taxRules'),presets:this.entities('presets'),documents,payments,allocations,dataFolder:this.folder,schemaVersion:SCHEMA_VERSION,lastBackup:this.db.prepare('SELECT at,path,reason FROM backup_history ORDER BY at DESC LIMIT 1').get()||null,lastExport:this.db.prepare('SELECT at,path,kind FROM export_history ORDER BY at DESC LIMIT 1').get()||null,importHistory:this.db.prepare('SELECT at,kind,payload FROM import_history ORDER BY at DESC LIMIT 10').all().map(r=>({...r,payload:parse(r.payload)}))};
  }
  saveProfile(input){
    const current=this.profile();if(Number(input.revision)!==current.revision)throw Error('Business details changed elsewhere. Reload before saving.');
    const allowed=Object.keys(C.emptyProfile());const p={};for(const k of allowed)p[k]=input[k]??current[k];
    p.id='business';p.revision=current.revision+1;p.stockEnabled=!!p.stockEnabled;p.registered=!!p.registered;p.composition=!!p.composition;
    if(!/^[A-Z0-9]{1,2}$/.test(p.prefix))throw Error('Number prefix must be 1–2 uppercase letters/digits.');
    if(!C.STATES[p.stateCode]||p.stateCode==='96')throw Error('Select a valid supplier state.');
    C.decimal(p.ewayThreshold,'E-way review threshold');
    if(!Number.isInteger(Number(p.backupRetention))||Number(p.backupRetention)<1||Number(p.backupRetention)>365)throw Error('Backup retention must be 1–365 backups.');
    return this.tx(()=>{this.db.prepare('UPDATE business_profiles SET revision=?,payload=? WHERE id=?').run(p.revision,bounded(p),'business');this.audit('business-updated','business',{revision:p.revision});return p;});
  }
  validateEntity(kind,input,{skipLinks=false}={}){
    const r=C.clone(input);assertId(r.id);
    if(['products','parties'].includes(kind)&&(!r.name||String(r.name).length>500))throw Error('Enter a name of at most 500 characters.');
    if(kind==='products'){
      if(!r.sku)throw Error('Product SKU is required.');
      if(r.hsn&&!/^\d{4,8}$/.test(String(r.hsn)))throw Error('HSN/SAC must contain 4–8 digits and remains text.');
      r.hsn=String(r.hsn||'');C.decimal(r.price,'Selling price');C.decimal(r.cost||'0','Cost');
      if(r.gstRate!==''&&r.gstRate!=null&&(C.decimal(r.gstRate,'GST rate').gt(100)))throw Error('GST rate must be between 0 and 100.');
      if(!C.TAXABILITIES.includes(r.taxability||'taxable'))throw Error('Select a valid tax category.');
      if(Number(r.casePack||1)<=0)throw Error('Case pack must be positive.');
      if(this.entities('products').some(p=>p.id!==r.id&&String(p.sku).toLowerCase()===String(r.sku).toLowerCase()))throw Error('Another product already uses that SKU.');
      if(r.verified&&(!r.source||!r.verifiedBy||!C.validDate(r.verifiedDate)))throw Error('Verification requires a source, reviewer and valid date.');
    }
    if(kind==='parties'){
      r.gstin=String(r.gstin||'').trim().toUpperCase();if(r.gstin&&!C.gstinValid(r.gstin))throw Error('Customer GSTIN format/checksum is invalid.');
      if(r.stateCode&&!C.STATES[r.stateCode])throw Error('Select a valid customer state.');
    }
    if(kind==='buyerPrices'){
      if(!this.entities('products').some(p=>p.id===r.productId)||!this.entities('parties').some(p=>p.id===r.partyId))throw Error('Select an existing product and customer.');
      C.decimal(r.price,'Agreed price');
    }
    if(kind==='taxRules'){
      if(r.rate===''||r.rate===undefined||r.rate===null)throw Error('Enter an explicit tax rule rate.');
      if(!skipLinks&&r.productId&&!this.entities('products').some(p=>p.id===r.productId))throw Error('Tax rule product ID does not exist.');
      if(!/^\d{4,8}$/.test(String(r.hsn||'')))throw Error('Tax rule requires a full HSN/SAC.');
      if(C.decimal(r.rate,'Tax rate').gt(100))throw Error('Tax rate must be between 0 and 100.');
      if(!C.validDate(r.effectiveFrom)||r.effectiveTo&&(!C.validDate(r.effectiveTo)||r.effectiveTo<r.effectiveFrom))throw Error('Enter valid, ordered effective dates.');
      if(r.verified&&(!/^https:\/\//.test(r.source||'')||!r.verifiedBy||!C.validDate(r.verifiedDate)))throw Error('Confirmed tax rules require an HTTPS source URL, reviewer and verification date.');
    }
    bounded(r,100000);return r;
  }
  upsertEntity(kind,input,withinTransaction=false){
    const table=ENTITY_TABLES[kind];if(!table)throw Error('Unsupported collection.');const r=this.validateEntity(kind,input);
    const old=this.db.prepare(`SELECT revision FROM ${table} WHERE id=?`).get(r.id);
    if((old?.revision||0)!==Number(r.revision||0))throw Error('This record changed since you opened it. Reload and review your edits.');
    r.revision=(old?.revision||0)+1;
    const perform=()=>{if(kind==='buyerPrices')this.db.prepare('INSERT INTO buyer_prices(id,revision,product_id,party_id,payload) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,product_id=excluded.product_id,party_id=excluded.party_id,payload=excluded.payload').run(r.id,r.revision,r.productId,r.partyId,bounded(r));else this.db.prepare(`INSERT INTO ${table}(id,revision,payload) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,payload=excluded.payload`).run(r.id,r.revision,bounded(r));this.audit(`${kind}-saved`,r.id,{revision:r.revision});return r;};return withinTransaction?perform():this.tx(perform);
  }
  saveDraft(input){
    const d=C.clone(input);delete d.snapshot;delete d.snapshotHash;assertId(d.id);
    if(!C.TYPES.includes(d.documentType))throw Error('Unsupported document type.');
    if(!Array.isArray(d.items)||d.items.length>1000)throw Error('Use at most 1,000 lines.');
    const old=this.getDocument(d.id);
    if(old&&old.status!=='draft')throw Error('Issued documents are immutable. Duplicate into a new draft or issue a credit note.');
    if((old?.revision||0)!==Number(d.revision||0))throw Error('This draft changed in another request. Reload before overwriting it.');
    d.revision=(old?.revision||0)+1;d.status='draft';d.invoiceNumber='';
    return this.tx(()=>{this.writeDocument(d,null);this.audit('draft-saved',d.id,{revision:d.revision});return this.getDocument(d.id);});
  }
  writeDocument(d,snapshot){
    const now=new Date().toISOString();const text=snapshot?bounded(snapshot):null;
    this.db.prepare(`INSERT INTO documents(id,revision,status,document_type,invoice_number,date,party_id,payload,snapshot,snapshot_hash,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,status=excluded.status,document_type=excluded.document_type,invoice_number=excluded.invoice_number,date=excluded.date,party_id=excluded.party_id,payload=excluded.payload,snapshot=excluded.snapshot,snapshot_hash=excluded.snapshot_hash,updated_at=excluded.updated_at`).run(d.id,d.revision,d.status,d.documentType,d.invoiceNumber||null,d.date||'',d.retailerId||null,bounded(d),text,text?digest(text):null,now,now);
    if(snapshot){for(const l of snapshot.totals.lines)this.db.prepare('INSERT INTO document_lines VALUES(?,?,?)').run(d.id,l.id,bounded(l));for(const g of snapshot.totals.taxGroups)this.db.prepare('INSERT INTO tax_breakdowns VALUES(?,?,?)').run(d.id,[g.hsn,g.taxability,g.gstRate,g.cessRate].join('|'),bounded(g));}
  }
  allocateNumber(type,date,profile){
    const year=C.fy(date);const row=this.db.prepare('SELECT last_number FROM number_series WHERE business_id=? AND financial_year=? AND document_type=?').get(profile.id,year,type);let next=(row?.last_number||0)+1;
    while(next<=9999&&this.db.prepare('SELECT id FROM documents WHERE invoice_number=?').get(`${profile.prefix}/${C.SERIES[type]}/${year.slice(2)}/${String(next).padStart(4,'0')}`))next++;
    if(next>9999)throw Error('This financial-year series is full. Configure a new business number series before issuing more documents.');
    this.db.prepare('INSERT INTO number_series VALUES(?,?,?,?) ON CONFLICT(business_id,financial_year,document_type) DO UPDATE SET last_number=excluded.last_number').run(profile.id,year,type,next);
    const number=`${profile.prefix}/${C.SERIES[type]}/${year.slice(2)}/${String(next).padStart(4,'0')}`;
    if(number.length>16)throw Error('The generated document number exceeds 16 characters.');return number;
  }
  creditTotals(d,profile){
    const original=this.getDocument(d.originalDocumentId);
    if(!original||original.status!=='finalised'||!['TAX INVOICE','BILL OF SUPPLY'].includes(original.documentType))throw Error('Choose an active, issued invoice as the credit source.');
    if(original.snapshot.legacy)throw Error('Legacy invoices need original line/tax reconciliation before a credit can be issued.');
    if(d.retailerId!==original.snapshot.document.retailerId||d.retailerName!==original.snapshot.document.retailerName)throw Error('A credit note must use the original invoice buyer.');
    if(d.date<original.date)throw Error('Credit date cannot be before the original invoice.');
    const prior=this.state().documents.filter(c=>c.status==='finalised'&&c.documentType==='CREDIT NOTE'&&c.snapshot.document.originalDocumentId===original.id);
    const used=new Map();for(const credit of prior)for(const l of credit.snapshot.totals.lines){const key=l.originalLineId;const x=used.get(key)||{quantity:C.decimal('0'),taxable:0,cgst:0,sgst:0,igst:0,cess:0};x.quantity=x.quantity.plus(l.quantity);for(const k of ['taxable','cgst','sgst','igst','cess'])x[k]+=l[k];used.set(key,x);}
    const seen=new Set();const lines=[];
    for(const input of d.items){
      if(!(Number(input.quantity)>0))continue;
      const source=original.snapshot.totals.lines.find(l=>l.id===input.originalLineId);
      if(!source||seen.has(source.id))throw Error('Credit lines must link uniquely to original invoice lines.');seen.add(source.id);
      const qty=C.decimal(input.quantity,'Credit quantity'),origQty=C.decimal(source.quantity,'Original quantity'),prev=used.get(source.id);
      if(qty.plus(prev?.quantity||0).gt(origQty))throw Error(`Credit quantity exceeds the remaining quantity for ${source.name}.`);
      const l={...C.clone(source),id:input.id,originalLineId:source.id,quantity:qty.toString(),discount:0,charges:0};
      assertId(l.id);
      for(const k of ['taxable','cgst','sgst','igst','cess']){l[k]=qty.plus(prev?.quantity||0).eq(origQty)?source[k]-(prev?.[k]||0):C.decimal(String(source[k]),k).times(qty).div(origQty).toDecimalPlaces(0).toNumber();if(l[k]+(prev?.[k]||0)>source[k])l[k]=source[k]-(prev?.[k]||0);}
      l.base=l.taxable;l.tax=l.cgst+l.sgst+l.igst+l.cess;l.total=l.taxable+(original.snapshot.document.reverseCharge?0:l.tax);lines.push(l);
    }
    if(!lines.length)throw Error('Enter at least one positive credit quantity.');
    const totals={lines,taxGroups:[],taxable:0,discount:0,charges:0,cgst:0,sgst:0,igst:0,cess:0,tax:0,roundOff:0,total:0,secondaryTaxLabel:original.snapshot.totals.secondaryTaxLabel};
    const groups=new Map();for(const l of lines){for(const k of ['taxable','cgst','sgst','igst','cess','tax','total'])totals[k]+=l[k];const key=[l.hsn,l.taxability,l.gstRate,l.cessRate].join('|');if(!groups.has(key))groups.set(key,{hsn:l.hsn,taxability:l.taxability,gstRate:l.gstRate,cessRate:l.cessRate,taxable:0,cgst:0,sgst:0,igst:0,cess:0,tax:0});for(const k of ['taxable','cgst','sgst','igst','cess','tax'])groups.get(key)[k]+=l[k];}
    const credited=prior.reduce((s,c)=>s+c.snapshot.totals.total,0),remaining=original.snapshot.totals.total-credited;
    const priorRound=prior.reduce((s,c)=>s+c.snapshot.totals.roundOff,0),originalRound=original.snapshot.totals.roundOff||0;
    const allConsumed=original.snapshot.totals.lines.every(source=>{const l=lines.find(x=>x.originalLineId===source.id);return C.decimal(l?.quantity||'0').plus(used.get(source.id)?.quantity||0).eq(source.quantity);});
    totals.roundOff=allConsumed?originalRound-priorRound:original.snapshot.totals.taxable?C.decimal(String(originalRound),'Round-off',{signed:true}).times(totals.taxable).div(original.snapshot.totals.taxable).toDecimalPlaces(0).toNumber():0;
    if(originalRound>=0)totals.roundOff=Math.min(totals.roundOff,originalRound-priorRound);else totals.roundOff=Math.max(totals.roundOff,originalRound-priorRound);
    totals.total+=totals.roundOff;
    if(totals.total>remaining)throw Error('Credit value exceeds the remaining original invoice value.');
    totals.taxGroups=[...groups.values()];d.reverseCharge=original.snapshot.document.reverseCharge;d.supplyTreatment=original.snapshot.document.supplyTreatment;d.placeOfSupply=original.snapshot.document.placeOfSupply;
    return totals;
  }
  finalise(input){
    const saved=this.getDocument(input.id);if(!saved)throw Error('Save the draft before issuing it.');
    if(saved.status==='finalised')return saved;
    if(saved.status!=='draft')throw Error('Cancelled documents cannot be issued again.');
    if(saved.revision!==input.revision)throw Error('The draft changed. Save and review it again before issuing.');
    const profile=this.profile();const d=C.clone(saved);delete d.snapshot;delete d.snapshotHash;
    const issues=C.health(d,profile,this.entities('products'),this.entities('taxRules'));const errors=issues.filter(i=>i.level==='error');if(errors.length)throw Error(errors.map(e=>e.message).join('\n'));
    return this.tx(()=>{
      if(!d.retailerId){const party=this.upsertEntity('parties',{id:randomUUID(),revision:0,name:d.retailerName,gstin:d.retailerGstin||'',billingAddress:d.billingAddress,shippingAddress:d.shippingAddress||d.billingAddress,stateCode:d.buyerStateCode||d.placeOfSupply,phone:d.customerPhone||'',paymentTerms:d.paymentTerms},true);d.retailerId=party.id;}
      if(!this.entities('parties').some(p=>p.id===d.retailerId))throw Error('The selected customer no longer exists. Select or save the buyer again.');
      const totals=d.documentType==='CREDIT NOTE'?this.creditTotals(d,profile):C.calculate(d,profile);
      if(d.linkedChallanId){const challan=this.getDocument(d.linkedChallanId);if(!challan||challan.documentType!=='DELIVERY CHALLAN'||challan.status!=='finalised')throw Error('The linked delivery challan is unavailable.');if(this.state().documents.some(x=>x.status==='finalised'&&x.snapshot.document.linkedChallanId===d.linkedChallanId))throw Error('This challan has already been converted to an invoice.');const before=challan.snapshot.totals.lines.map(l=>[l.productId||l.name,String(l.quantity)]).sort().map(x=>JSON.stringify(x));const after=totals.lines.map(l=>[l.productId||l.name,String(l.quantity)]).sort().map(x=>JSON.stringify(x));if(JSON.stringify(before)!==JSON.stringify(after)||d.retailerName!==challan.snapshot.document.retailerName)throw Error('A linked challan conversion must preserve dispatched products, quantities and buyer. Create a separate invoice for changes.');}
      d.invoiceNumber=this.allocateNumber(d.documentType,d.date,profile);d.status='finalised';d.revision++;
      let advance=null,advanceAmount=0;
      if(d.advancePaymentId&&['TAX INVOICE','BILL OF SUPPLY'].includes(d.documentType)){
        const state=this.state();advance=state.payments.find(p=>p.id===d.advancePaymentId&&!p.voided);advanceAmount=C.cents(d.advanceAllocation||'0');
        if(!advance||advanceAmount<=0||advanceAmount>advance.amount-state.allocations.filter(a=>a.paymentId===advance.id).reduce((s,a)=>s+a.amount,0)||advanceAmount>totals.total)throw Error('Advance allocation is invalid or exceeds the available payment/invoice amount.');
        if((advance.partyId||'')!==(d.retailerId||'')||(!advance.partyId&&advance.partyName!==d.retailerName))throw Error('The advance payment belongs to a different buyer.');
      }
      const snapshot={version:1,issuedAt:new Date().toISOString(),document:C.clone(d),profile:C.clone(profile),totals,settlement:{paid:advanceAmount,balance:totals.total-advanceAmount,reference:advance?.reference||''},reviewWarnings:issues.filter(i=>i.level==='warning'),signatureNote:'Visual signature/seal only; not a cryptographic signature.'};
      this.writeDocument(d,snapshot);
      if(advance){this.applyAllocations(advance,[{documentId:d.id,amount:advanceAmount}]);this.db.prepare('UPDATE payments SET revision=revision+1 WHERE id=?').run(advance.id);this.audit('advance-applied',d.id,{paymentId:advance.id,amount:advanceAmount});}
      if(d.documentType==='ADVANCE RECEIPT')this.recordPaymentInternal({id:randomUUID(),partyId:d.retailerId,partyName:d.retailerName,date:d.date,amount:totals.total,method:d.paymentMode||'UPI',reference:d.utrNumber||'',receiptId:d.id,allocations:[]});
      this.recordStock(d,totals);this.audit('document-finalised',d.id,{number:d.invoiceNumber,total:totals.total,snapshotHash:digest(snapshot)});return this.getDocument(d.id);
    });
  }
  duplicate(id,type){
    const source=this.getDocument(id);if(!source)throw Error('Document not found.');
    const d=C.clone(source.snapshot?.document||source);d.id=randomUUID();d.revision=0;d.status='draft';d.invoiceNumber='';d.date=C.dateToday();d.dueDate=C.dueDate(d.date,d.paymentTerms);d.documentType=type||d.documentType;delete d.snapshot;delete d.snapshotHash;d.amountReceived='';d.utrNumber='';d.irn='';d.ackNumber='';d.ackDate='';d.ewayBillNumber='';d.originalDocumentId='';d.creditReason='';
    if(source.documentType==='DELIVERY CHALLAN'&&d.documentType==='TAX INVOICE')d.linkedChallanId=source.id;else d.linkedChallanId='';
    d.advancePaymentId='';d.advanceAllocation='';d.items.forEach(l=>{l.id=randomUUID();l.originalLineId='';});return this.saveDraft(d);
  }
  createCredit(id){const source=this.getDocument(id);if(!source?.snapshot||source.status!=='finalised'||!['TAX INVOICE','BILL OF SUPPLY'].includes(source.documentType))throw Error('Select an issued invoice.');const d=C.clone(source.snapshot.document);d.id=randomUUID();d.revision=0;d.status='draft';d.documentType='CREDIT NOTE';d.invoiceNumber='';d.originalDocumentId=id;d.originalInvoiceNumber=source.invoiceNumber;d.date=C.dateToday();d.dueDate=d.date;d.creditReason='';d.irn='';d.ewayBillNumber='';d.amountReceived='';d.utrNumber='';d.items=source.snapshot.totals.lines.map(l=>({...C.clone(l),id:randomUUID(),originalLineId:l.id,quantity:'0'}));return this.saveDraft(d);}
  cancel(id,revision,reason){
    if(!reason||reason.trim().length<3)throw Error('Enter a cancellation reason.');const d=this.getDocument(id);if(!d||d.revision!==revision)throw Error('Document changed. Reload before cancelling.');if(d.status!=='finalised')throw Error('Only issued documents can be cancelled.');
    if(this.db.prepare('SELECT id FROM payment_allocations WHERE document_id=? LIMIT 1').get(id))throw Error('Reverse payment allocations before cancelling this invoice.');
    if(this.state().documents.some(c=>c.status==='finalised'&&c.snapshot.document.originalDocumentId===id))throw Error('Cancel linked credit notes before cancelling their original invoice.');
    if(this.state().documents.some(c=>c.status==='finalised'&&c.snapshot.document.linkedChallanId===id))throw Error('Cancel the converted invoice before cancelling its delivery challan.');
    const receiptPayment=this.state().payments.find(p=>p.receiptId===id&&!p.voided);if(receiptPayment)throw Error('Void the receipt payment before cancelling its voucher.');
    return this.tx(()=>{this.db.prepare("UPDATE documents SET status='cancelled',revision=revision+1,updated_at=? WHERE id=?").run(new Date().toISOString(),id);this.audit('document-cancelled',id,{reason});const moves=this.db.prepare('SELECT * FROM stock_movements WHERE document_id=?').all(id);for(const m of moves)this.db.prepare('INSERT INTO stock_movements VALUES(?,?,?,?,?,?,?)').run(randomUUID(),m.product_id,id,C.decimal(m.quantity,'Quantity',{signed:true}).negated().toString(),'cancellation',new Date().toISOString(),json({reversalOf:m.id}));return this.getDocument(id);});
  }
  recordPaymentInternal(input){
    assertId(input.id);if(!Number.isSafeInteger(input.amount)||input.amount<=0)throw Error('Enter a positive payment amount.');
    if(!C.validDate(input.date))throw Error('Enter a valid payment date.');
    const p={...C.clone(input),revision:1,voided:false};delete p.allocations;
    if(!p.partyId){if(!p.partyName)throw Error('Choose a customer or enter the payment customer name.');const party=this.upsertEntity('parties',{id:randomUUID(),revision:0,name:p.partyName,gstin:'',billingAddress:'',shippingAddress:'',stateCode:''},true);p.partyId=party.id;}
    if(!this.entities('parties').some(x=>x.id===p.partyId))throw Error('Select an existing payment customer.');
    this.db.prepare('INSERT INTO payments VALUES(?,?,?,?,?,?,?,?,?)').run(p.id,1,p.partyId||null,p.date,p.amount,p.method||'Other',p.reference||'',0,bounded(p));
    this.applyAllocations(p,input.allocations||[]);this.audit('payment-recorded',p.id,{amount:p.amount});return p;
  }
  applyAllocations(payment,allocations){
    if(!Array.isArray(allocations)||allocations.length>1000)throw Error('Invalid payment allocations.');const seen=new Set();let total=0;
    for(const a of allocations){assertId(a.documentId);if(seen.has(a.documentId))throw Error('Duplicate payment allocation.');seen.add(a.documentId);if(!Number.isSafeInteger(a.amount)||a.amount<=0)throw Error('Allocation amounts must be positive paise.');total+=a.amount;}
    if(total>payment.amount)throw Error('Allocations exceed the payment amount.');
    const report=C.reports(this.state());for(const a of allocations){const d=this.getDocument(a.documentId);if(!d||d.status!=='finalised'||!['TAX INVOICE','BILL OF SUPPLY'].includes(d.documentType))throw Error('Allocate only to active issued sales invoices.');if((payment.partyId||'')!==(d.snapshot.document.retailerId||'')||(!payment.partyId&&payment.partyName!==d.snapshot.document.retailerName))throw Error('Payment and invoice must belong to the same customer.');const balance=report.ledger.find(r=>r.documentId===d.id).outstanding;if(a.amount>balance)throw Error(`Allocation exceeds the outstanding amount for ${d.invoiceNumber}.`);this.db.prepare('INSERT INTO payment_allocations VALUES(?,?,?,?)').run(randomUUID(),payment.id,d.id,a.amount);}
  }
  recordPayment(input){return this.tx(()=>this.recordPaymentInternal({...input,id:input.id||randomUUID(),amount:C.cents(input.amount)}));}
  reallocatePayment(input){return this.tx(()=>{const p=this.state().payments.find(p=>p.id===input.id);if(!p||p.voided||p.revision!==input.revision)throw Error('Payment changed or was voided. Reload it.');this.db.prepare('DELETE FROM payment_allocations WHERE payment_id=?').run(p.id);this.applyAllocations(p,input.allocations);this.db.prepare('UPDATE payments SET revision=revision+1 WHERE id=?').run(p.id);this.audit('payment-reallocated',p.id,{allocations:input.allocations});return true;});}
  voidPayment(id,revision,reason){return this.tx(()=>{const p=this.state().payments.find(p=>p.id===id);if(!p||p.revision!==revision||p.voided)throw Error('Payment changed or already voided.');if(!reason||reason.trim().length<3)throw Error('Enter the payment correction reason.');this.db.prepare('DELETE FROM payment_allocations WHERE payment_id=?').run(id);this.db.prepare('UPDATE payments SET voided=1,revision=revision+1 WHERE id=?').run(id);this.audit('payment-voided',id,{reason});return true;});}
  recordStock(d,totals){
    if(!this.profile().stockEnabled)return;
    let sign=0;if(['TAX INVOICE','BILL OF SUPPLY','DELIVERY CHALLAN'].includes(d.documentType))sign=-1;if(d.documentType==='CREDIT NOTE'&&d.returnToStock)sign=1;if(d.linkedChallanId)sign=0;
    if(!sign)return;for(const l of totals.lines){if(!l.productId||!this.entities('products').some(p=>p.id===l.productId&&p.stockEnabled))continue;this.db.prepare('INSERT INTO stock_movements VALUES(?,?,?,?,?,?,?)').run(randomUUID(),l.productId,d.id,C.decimal(l.quantity,'Quantity').times(sign).toString(),d.documentType,new Date().toISOString(),json({batch:l.batch||''}));}
  }
  adjustStock(input){if(!this.profile().stockEnabled)throw Error('Enable optional stock tracking first.');if(!this.entities('products').some(p=>p.id===input.productId&&p.stockEnabled))throw Error('Enable stock tracking for this product.');const qty=C.decimal(input.quantity,'Adjustment',{signed:true});if(qty.isZero()||!input.reason)throw Error('Enter a nonzero quantity and reason.');return this.tx(()=>{const id=randomUUID();this.db.prepare('INSERT INTO stock_movements VALUES(?,?,?,?,?,?,?)').run(id,input.productId,null,qty.toString(),'adjustment',new Date().toISOString(),bounded({reason:input.reason,batch:input.batch||''}));this.audit('stock-adjustment',id,input);return true;});}
  stock(){return this.entities('products').filter(p=>p.stockEnabled).map(p=>({id:p.id,name:p.name,unit:p.unit||'NOS',balance:this.db.prepare('SELECT quantity FROM stock_movements WHERE product_id=?').all(p.id).reduce((a,m)=>a.plus(m.quantity),C.decimal(p.openingStock||'0','Opening stock')).toString()}));}
  verify(){
    const result=this.db.prepare('PRAGMA integrity_check').all();if(result.length!==1||result[0].integrity_check!=='ok')throw Error('Database integrity check failed. Restore a verified backup.');
    if(this.db.prepare('PRAGMA foreign_key_check').all().length)throw Error('Database references are inconsistent. Restore a verified backup.');
    for(const r of this.db.prepare('SELECT snapshot,snapshot_hash FROM documents WHERE snapshot IS NOT NULL').all())if(digest(r.snapshot)!==r.snapshot_hash)throw Error('An issued document snapshot failed its integrity check.');
    return {integrity:'ok',schemaVersion:SCHEMA_VERSION,documents:this.db.prepare('SELECT count(*) AS n FROM documents').get().n};
  }
  async backup(reason='manual',targetFolder){
    const dir=targetFolder||path.join(this.folder,'Backups');fs.mkdirSync(dir,{recursive:true});const name=`InvoiceStudio-${new Date().toISOString().replace(/[:.]/g,'-')}-${randomUUID().slice(0,6)}.db`;const dest=path.join(dir,name);
    await backup(this.db,dest);
    const probe=new DatabaseSync(dest,{readOnly:true});try{if(probe.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw Error('Backup integrity check failed.');}finally{probe.close();}
    const hash=digest(fs.readFileSync(dest));this.db.prepare('INSERT INTO backup_history VALUES(?,?,?,?,?)').run(randomUUID(),new Date().toISOString(),dest,hash,reason);this.lastAutoBackup=Date.now();
    if(!targetFolder){const retention=Number(this.profile().backupRetention)||30;const files=fs.readdirSync(dir).filter(f=>/^InvoiceStudio-.*\.db$/.test(f)).sort().reverse();for(const f of files.slice(retention))fs.unlinkSync(path.join(dir,f));}
    const secondary=parse(this.db.prepare('SELECT value FROM settings WHERE key=?').get('secondaryBackupFolder')?.value);
    if(secondary&&!targetFolder){fs.accessSync(secondary,fs.constants.W_OK);fs.copyFileSync(dest,path.join(secondary,name));}
    return {path:dest,hash,at:new Date().toISOString()};
  }
  async restore(source){
    if(path.resolve(source)===this.filename)throw Error('Choose a backup file rather than the open database.');
    if(fs.statSync(source).size>500*1024*1024)throw Error('Backup exceeds the 500 MB restore limit.');
    const stage=path.join(this.folder,`restore-${randomUUID()}.db`);fs.copyFileSync(source,stage);
    let probe;try{probe=new DatabaseSync(stage,{readOnly:true});if(probe.prepare('PRAGMA integrity_check').get().integrity_check!=='ok'||probe.prepare('PRAGMA foreign_key_check').all().length)throw Error('Backup integrity/references are invalid.');if(probe.prepare('PRAGMA user_version').get().user_version!==SCHEMA_VERSION)throw Error('Unsupported backup schema version.');for(const r of probe.prepare('SELECT snapshot,snapshot_hash FROM documents WHERE snapshot IS NOT NULL').all())if(digest(r.snapshot)!==r.snapshot_hash)throw Error('Backup document snapshot is corrupt.');if(!probe.prepare("SELECT payload FROM business_profiles WHERE id='business'").get())throw Error('Backup has no business profile.');}catch(e){fs.rmSync(stage,{force:true});throw e;}finally{probe?.close();}
    await this.backup('before-restore');
    // SQLite's backup API replaces the destination transactionally and supports open
    // WAL connections. Renaming an open database is neither safe nor reliable on Windows.
    const restored=new DatabaseSync(stage,{readOnly:true});
    try{await backup(restored,this.filename);this.verify();this.audit('backup-restored','business',{sourceHash:digest(fs.readFileSync(source))});}
    finally{restored.close();fs.rmSync(stage,{force:true});}
    return this.state();
  }
  history(){return this.db.prepare('SELECT * FROM audit_events ORDER BY at DESC LIMIT 300').all().map(r=>({...r,payload:parse(r.payload)}));}
  close(){this.db.close();}
}
module.exports={Store,SCHEMA_VERSION,ENTITY_TABLES,digest,errorMessage,assertId};

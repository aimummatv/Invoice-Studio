'use strict';
const {app,BrowserWindow,ipcMain,protocol,dialog,shell,session,Menu}=require('electron');
const fs=require('node:fs');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {Store,digest,errorMessage}=require('./store.cjs');
const C=require('../shared/core.js');
const V=require('../shared/invoice-view.js');
const W=require('./workbooks.cjs');
const L=require('./legacy.cjs');
const QR=require('../lib/qrcode.js');
// An explicit Chromium profile isolates diagnostic runs from an interactive app.
const diagnosticProfile=app.commandLine.getSwitchValue('user-data-dir');
if(diagnosticProfile){if(!path.isAbsolute(diagnosticProfile))throw Error('The diagnostic profile path must be absolute.');fs.mkdirSync(diagnosticProfile,{recursive:true});app.setPath('userData',diagnosticProfile);}
protocol.registerSchemesAsPrivileged([{scheme:'studio',privileges:{standard:true,secure:true,supportFetchAPI:true,stream:true}}]);
let mainWindow,store,configPath,activePortableMarker,lastExport='',queue=Promise.resolve(),closing=false;
const previews=new Map(),printPages=new Map();
const root=path.resolve(__dirname,'..');
const CSP="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'";
function enqueue(fn){const next=queue.then(fn);queue=next.catch(()=>{});return next;}
function notice(message,level='error'){mainWindow?.webContents.send('studio:notice',{message,level});}
function readConfig(){
  configPath=path.join(app.getPath('userData'),'studio-config.json');
  const explicitFolder=app.commandLine.getSwitchValue('data-folder');
  if(explicitFolder){if(!path.isAbsolute(explicitFolder))throw Error('The explicit data folder must be an absolute path.');return{folder:explicitFolder,mustExist:!app.commandLine.hasSwitch('new-data-folder'),test:true};}
  if(!app.isPackaged&&process.env.INVOICE_STUDIO_TEST_DATA)return{folder:path.resolve(process.env.INVOICE_STUDIO_TEST_DATA),test:true,mustExist:fs.existsSync(path.join(process.env.INVOICE_STUDIO_TEST_DATA,'InvoiceStudio.db'))};
  const portableDir=process.env.PORTABLE_EXECUTABLE_DIR;
  if(portableDir){const marker=path.join(portableDir,'InvoiceStudio.portable.json');if(fs.existsSync(marker)){const p=JSON.parse(fs.readFileSync(marker,'utf8'));if(p.portable===true){activePortableMarker=marker;const folder=p.folder||path.join(portableDir,'Invoice Studio Data');if(!path.isAbsolute(folder))throw Error('Portable data folder must be absolute.');return{folder,mustExist:!!p.initialized,portable:true,marker};}}}
  if(fs.existsSync(configPath)){const c=JSON.parse(fs.readFileSync(configPath,'utf8'));if(typeof c.folder!=='string'||!path.isAbsolute(c.folder))throw Error('Data folder configuration is invalid. Restore studio-config.json or choose your existing data folder.');return{...c,mustExist:true};}
  return{folder:path.join(app.getPath('userData'),'Data'),mustExist:false};
}
function saveConfig(config){if(config.test)return;const marker=config.marker||activePortableMarker;if(marker){const local=path.join(path.dirname(marker),'Invoice Studio Data');fs.writeFileSync(marker,JSON.stringify({portable:true,initialized:true,...(config.folder!==local?{folder:config.folder}:{})},null,2));return;}fs.mkdirSync(path.dirname(configPath),{recursive:true});const tmp=configPath+'.tmp';fs.writeFileSync(tmp,JSON.stringify({folder:config.folder},null,2));fs.renameSync(tmp,configPath);}
function secureWindow(win){
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',event=>event.preventDefault());win.webContents.on('will-attach-webview',event=>event.preventDefault());
}
function setupProtocol(){
  protocol.handle('studio',request=>{
    try{
      const url=new URL(request.url);if(url.host!=='app')return new Response('Forbidden',{status:403});
      const decoded=decodeURIComponent(url.pathname);if(decoded.startsWith('/print/')){const html=printPages.get(decoded.slice(7));return html?new Response(html,{headers:{'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':CSP}}):new Response('Expired print document',{status:404});}
      const rel=decoded==='/'?'index.html':decoded.slice(1);if(!/^(index\.html|(?:css|js|shared|assets|lib)\/[\w./-]+)$/.test(rel)||rel.split('/').some(s=>s==='..'||s.startsWith('.')))return new Response('Not found',{status:404});
      if(rel.startsWith('lib/')&&!['lib/lucide.min.js','lib/qrcode.js','lib/decimal.js'].includes(rel))return new Response('Not found',{status:404});
      const file=path.resolve(root,rel);if(!file.startsWith(root+path.sep))return new Response('Forbidden',{status:403});
      const mime={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.woff2':'font/woff2','.svg':'image/svg+xml','.png':'image/png'}[path.extname(file)];if(!mime)return new Response('Not found',{status:404});
      return new Response(fs.readFileSync(file),{headers:{'Content-Type':mime,'Content-Security-Policy':CSP,'X-Content-Type-Options':'nosniff'}});
    }catch{return new Response('Not found',{status:404});}
  });
}
function handle(name,fn,{write=false}={}){
  ipcMain.handle(`studio:${name}`,async(event,payload)=>{
    try{
      if(!mainWindow||event.sender!==mainWindow.webContents||event.senderFrame!==mainWindow.webContents.mainFrame||!event.senderFrame.url.startsWith('studio://app/'))throw Error('Untrusted desktop request.');
      if(payload!==undefined&&JSON.stringify(payload).length>3000000)throw Error('Request is too large.');
      return await enqueue(async()=>{if(write&&Date.now()-store.lastAutoBackup>60*60*1000)await store.backup('automatic-before-change');const result=await fn(payload||{});return{ok:true,data:result};});
    }catch(e){console.error(`[${name}] ${e.message}`);return{ok:false,error:errorMessage(e)};}
  });
}
async function saveFile(buffer,options,kind){
  const selected=await dialog.showSaveDialog(mainWindow,options);if(selected.canceled)return null;const filename=selected.filePath;
  const prior=store.db.prepare('SELECT hash FROM export_history WHERE path=? ORDER BY at DESC LIMIT 1').get(filename);
  if(prior&&fs.existsSync(filename)&&digest(fs.readFileSync(filename))!==prior.hash)throw Error('This file changed outside Invoice Studio. Review those edits, then choose a different Save As filename.');
  const hash=W.atomicExport(filename,buffer);store.db.prepare('INSERT INTO export_history VALUES(?,?,?,?,?)').run(randomUUID(),new Date().toISOString(),filename,hash,kind);lastExport=filename;return{path:filename,hash};
}
function snapshotFor(id){const d=store.getDocument(id);if(!d)throw Error('Document no longer exists.');const snapshot=d.snapshot||{version:1,document:d,profile:store.profile(),totals:d.documentType==='CREDIT NOTE'?store.creditTotals(d,store.profile()):C.calculate(d,store.profile())};return{d,snapshot};}
async function printWindow(id){
  const {d,snapshot}=snapshotFor(id);const token=randomUUID();const upi=V.qrForSnapshot(snapshot);let qrData='';if(upi){const code=QR(0,'M');code.addData(upi);code.make();qrData=code.createDataURL(3,4);}
  printPages.set(token,V.html(snapshot,{status:d.status,qrData}));
  const win=new BrowserWindow({show:false,width:900,height:1100,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});secureWindow(win);
  try{await win.loadURL(`studio://app/print/${token}`);await win.webContents.executeJavaScript('document.fonts.ready.then(()=>Promise.all(Array.from(document.images).map(i=>i.complete?Promise.resolve():new Promise(r=>{i.onload=r;i.onerror=r}))))');return{win,token,d};}catch(e){printPages.delete(token);win.destroy();throw e;}
}
async function pdfBuffer(id){const {win,token}=await printWindow(id);try{return await win.webContents.printToPDF({printBackground:true,preferCSSPageSize:true,pageSize:'A4',displayHeaderFooter:false,generateTaggedPDF:true,margins:{top:.39,bottom:.67,left:.39,right:.39}});}finally{win.destroy();printPages.delete(token);}}
async function exportPDF({id,share=false}){const {d}=snapshotFor(id),buffer=await pdfBuffer(id);const dir=path.join(store.folder,'Exports');fs.mkdirSync(dir,{recursive:true});const name=(d.invoiceNumber||`Draft-${d.id.slice(0,8)}`).replace(/[^\w.-]/g,'_')+'.pdf';if(share){const filename=path.join(dir,name);W.atomicExport(filename,buffer);lastExport=filename;shell.showItemInFolder(filename);return{path:filename,manualAttachment:true};}return saveFile(buffer,{title:'Save searchable PDF',defaultPath:path.join(dir,name),filters:[{name:'PDF',extensions:['pdf']}]},'pdf');}
function setupAPI(){
  handle('closeReady',async()=>{await store.backup('on-close');closing=true;setImmediate(()=>mainWindow.close());return true;});
  handle('calculateDraft',d=>d.documentType==='CREDIT NOTE'?store.creditTotals(C.clone(d),store.profile()):C.calculate(d,store.profile()));
  handle('getState',()=>({...store.state(),appVersion:app.getVersion(),desktop:true,portable:!!process.env.PORTABLE_EXECUTABLE_DIR}));
  handle('saveDraft',d=>store.saveDraft(d),{write:true});
  handle('finalise',async d=>{const result=store.finalise(d);if(store.profile().autoExport){try{const buffer=await W.exportWorkbook(store.state());const folder=path.join(store.folder,'Exports');fs.mkdirSync(folder,{recursive:true});W.atomicExport(path.join(folder,'InvoiceStudio-managed.xlsx'),buffer);}catch(e){notice(`Invoice saved. Automatic workbook export failed: ${e.message}`);}}return result;},{write:true});
  handle('saveProfile',p=>store.saveProfile(p),{write:true});handle('saveEntity',({kind,record})=>store.upsertEntity(kind,record),{write:true});
  handle('duplicate',({id,type})=>store.duplicate(id,type),{write:true});handle('createCredit',({id})=>store.createCredit(id),{write:true});handle('cancel',({id,revision,reason})=>store.cancel(id,revision,reason),{write:true});
  handle('recordPayment',p=>store.recordPayment(p),{write:true});handle('reallocatePayment',p=>store.reallocatePayment(p),{write:true});handle('voidPayment',({id,revision,reason})=>store.voidPayment(id,revision,reason),{write:true});
  handle('backup',()=>store.backup('manual'));handle('verify',()=>store.verify());
  handle('restore',async()=>{const chosen=await dialog.showOpenDialog(mainWindow,{title:'Restore a verified SQLite backup',properties:['openFile'],filters:[{name:'Invoice Studio database',extensions:['db']}]});if(chosen.canceled)return null;const check=await dialog.showMessageBox(mainWindow,{type:'warning',buttons:['Cancel','Restore backup'],defaultId:0,message:'Restore this backup?',detail:'The current database will first be backed up. The replacement must pass integrity and snapshot checks.'});if(check.response!==1)return null;return store.restore(chosen.filePaths[0]);});
  handle('exportWorkbook',async({template})=>saveFile(await W.exportWorkbook(store.state(),{template}),{title:template?'Save Excel template':'Export Excel workbook',defaultPath:template?'InvoiceStudio-Template.xlsx':'InvoiceStudio.xlsx',filters:[{name:'Excel workbook',extensions:['xlsx']}]},template?'template':'workbook'));
  handle('exportCSV',()=>saveFile(W.exportCSV(store.state()),{title:'Save reconciliation CSV',defaultPath:'InvoiceStudio-Reconciliation.csv',filters:[{name:'CSV',extensions:['csv']}]},'csv'));
  handle('previewImport',async({kind})=>{if(!['workbook','legacy'].includes(kind))throw Error('Unsupported import type.');const chosen=await dialog.showOpenDialog(mainWindow,{title:kind==='workbook'?'Preview workbook import':'Recover legacy browser/disk data',properties:['openFile'],filters:[{name:kind==='workbook'?'Excel workbook':'Legacy data',extensions:kind==='workbook'?['xlsx']:['json','js']}]});if(chosen.canceled)return null;const file=chosen.filePaths[0];if(fs.statSync(file).size>10*1024*1024)throw Error('Input file exceeds 10 MB.');const buffer=fs.readFileSync(file);const preview=kind==='workbook'?await W.previewWorkbook(store,buffer):L.previewLegacy(store,buffer);previews.set(preview.id,preview);for(const [id,p]of previews)if(Date.now()-p.createdAt>15*60*1000)previews.delete(id);return{...preview,records:preview.records.map(r=>({sheet:r.sheet||r.key,row:r.row,action:r.action,id:r.record.id||r.record.key,name:r.record.name||'',changes:r.action==='update'?r.record:undefined})),path:path.basename(file)};});
  handle('commitImport',async({id})=>{const preview=previews.get(id);if(!preview)throw Error('Import preview expired. Select and preview the file again.');if(preview.hasTaxReview){const answer=await dialog.showMessageBox(mainWindow,{type:'question',buttons:['Cancel','Import as unverified'],defaultId:0,message:'Review imported tax rules',detail:'Tax rules will not become confirmed automatically. Review official source evidence and effective dates in Tax Rules before verification.'});if(answer.response!==1)return null;}const result=preview.kind==='legacy'?await L.commitLegacy(store,preview):await W.commitWorkbook(store,preview);previews.delete(id);return result;});
  handle('exportPDF',exportPDF);handle('print',async({id})=>{const {win,token}=await printWindow(id);return new Promise((resolve,reject)=>{win.webContents.print({silent:false,printBackground:true,pageSize:'A4'},(success,reason)=>{win.destroy();printPages.delete(token);if(!success&&reason!=='cancelled')reject(Error(`Print failed: ${reason}`));else resolve({printed:success});});});});
  handle('openWhatsApp',async({phone,message})=>{if(typeof phone!=='string'||typeof message!=='string'||message.length>10000)throw Error('Invalid WhatsApp request.');const digits=phone.replace(/\D/g,'');if(!/^\d{10,15}$/.test(digits))throw Error('Enter a phone number with country code (10–15 digits).');await shell.openExternal(`https://wa.me/${digits}?text=${encodeURIComponent(message)}`);return true;});
  handle('revealExport',()=>{if(!lastExport||!fs.existsSync(lastExport))throw Error('Export a file first.');shell.showItemInFolder(lastExport);return true;});
  handle('history',()=>store.history());handle('stock',()=>store.stock());handle('adjustStock',p=>store.adjustStock(p),{write:true});
  handle('secondaryBackup',async()=>{const selected=await dialog.showOpenDialog(mainWindow,{title:'Choose a secondary backup folder',properties:['openDirectory','createDirectory']});if(selected.canceled)return null;const folder=selected.filePaths[0];fs.accessSync(folder,fs.constants.W_OK);store.db.prepare('INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run('secondaryBackupFolder',JSON.stringify(folder));await store.backup('secondary-folder-test');return{folder};});
  handle('changeDataFolder',async()=>{const selected=await dialog.showOpenDialog(mainWindow,{title:'Move database to a writable data folder',properties:['openDirectory','createDirectory']});if(selected.canceled)return null;const dest=path.resolve(selected.filePaths[0]);if(dest===store.folder)return{folder:dest};fs.accessSync(dest,fs.constants.W_OK);const filename=path.join(dest,'InvoiceStudio.db');if(fs.existsSync(filename))throw Error('The selected folder already contains a database. Use Restore to review it, or select an empty folder.');await store.backup('before-data-folder-move');const stage=path.join(dest,`move-${randomUUID()}.db`);const {backup}=require('node:sqlite');await backup(store.db,stage);fs.renameSync(stage,filename);const probe=new Store(dest,{mustExist:true});probe.verify();probe.close();store.close();store=new Store(dest,{mustExist:true});saveConfig({folder:dest});store.audit('data-folder-moved','business',{});return{folder:dest};});
}
async function start(){
  app.setAppUserModelId('in.magicroots.invoice-studio');
  const config=readConfig();store=new Store(config.folder,{mustExist:config.mustExist});saveConfig(config);setupProtocol();
  session.defaultSession.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));session.defaultSession.setPermissionCheckHandler(()=>false);
  session.defaultSession.webRequest.onBeforeRequest((details,callback)=>callback({cancel:!['studio:','data:','devtools:'].includes(new URL(details.url).protocol)}));
  mainWindow=new BrowserWindow({title:'Invoice & Billing Studio | Magic Roots',icon:path.join(root,'assets/icon.ico'),width:1540,height:980,minWidth:800,minHeight:620,backgroundColor:'#f8fafc',show:!process.env.INVOICE_STUDIO_HIDDEN,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true,webviewTag:false}});
  secureWindow(mainWindow);Menu.setApplicationMenu(Menu.buildFromTemplate([{label:'File',submenu:[{role:'quit'}]},{label:'View',submenu:[{role:'resetZoom'},{role:'zoomIn'},{role:'zoomOut'},{role:'togglefullscreen'}]}]));setupAPI();await mainWindow.loadURL('studio://app/');
  mainWindow.on('close',event=>{if(closing)return;event.preventDefault();mainWindow.webContents.send('studio:notice',{level:'closing',message:'Saving before closing…'});});
}
const gotLock=app.requestSingleInstanceLock();if(!gotLock)app.quit();else{app.on('second-instance',()=>{if(mainWindow){if(mainWindow.isMinimized())mainWindow.restore();mainWindow.show();mainWindow.focus();}});app.whenReady().then(start).catch(async e=>{console.error(e);const answer=await dialog.showMessageBox({type:'error',buttons:['Quit','Choose existing data folder'],defaultId:0,message:'Invoice Studio could not open its data',detail:errorMessage(e)});if(answer.response===1){const selected=await dialog.showOpenDialog({properties:['openDirectory'],title:'Choose the folder containing InvoiceStudio.db'});if(!selected.canceled){try{const probe=new Store(selected.filePaths[0],{mustExist:true});probe.close();saveConfig({folder:selected.filePaths[0]});app.relaunch();}catch(err){dialog.showErrorBox('Database recovery',err.message);}}}app.quit();});}
app.on('window-all-closed',()=>app.quit());app.on('will-quit',()=>{try{store?.close();}catch{}});
module.exports={pdfBuffer,getStore:()=>store};

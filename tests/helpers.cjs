const {randomUUID}=require('node:crypto');
const C=require('../shared/core.js');
function fakeGST(prefix='27ABCDE1234F1Z'){const chars='0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';let f=2,sum=0;for(let i=13;i>=0;i--){const p=chars.indexOf(prefix[i])*f;sum+=Math.floor(p/36)+p%36;f=f===2?1:2;}return prefix+chars[(36-sum%36)%36];}
function profile(store){return store.saveProfile({...store.profile(),address:'Fictitious Unit 1, Example Street',gstin:fakeGST(),registered:true,stateCode:'27'});}
function draft(p,items){const d=C.newDraft('TAX INVOICE',p,randomUUID());Object.assign(d,{retailerId:'',retailerName:'Fictitious Buyer',billingAddress:'Example Address',placeOfSupply:'27'});d.items=items||[{...C.newLine(null,p,randomUUID()),name:'Fictitious item',hsn:'001234',unitRate:'100',quantity:'1',gstRate:'5',verified:false}];return d;}
module.exports={fakeGST,profile,draft};

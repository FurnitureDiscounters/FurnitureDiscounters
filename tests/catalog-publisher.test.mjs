import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createDatabase,publicCatalog} from '../assets/js/catalog-model.js';
const source=(await readFile(new URL('../assets/js/services/catalog-publisher.js',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'').replace(/export /g,'').replace('{ readFirebaseCatalog };','').replace("await import('firebase/firestore/lite')",'({deleteDoc})');
function harness(){
 const records=new Map(),calls=[];let sequence=0,hook=()=>{},reloadHook=async()=>{};
 const ref=(...args)=>args.slice(1).join('/');
 const snap=path=>({id:path.split('/').at(-1),ref:path,exists:()=>records.has(path),data:()=>structuredClone(records.get(path))});
 const get=async path=>{calls.push(['get',path]);return snap(path);};
 const set=async(path,value)=>{calls.push(['set',path]);records.set(path,structuredClone(value));await hook(path);};
 const user={uid:'YHWYz24VL4hQ3vZWQv0hUBxo8Xw1',getIdToken:async()=>{}};
 const context=vm.createContext({structuredClone,console,location:{hostname:'example.com'},getApps:()=>[],getAuth:()=>({currentUser:user}),reload:()=>reloadHook(),catalogDatabase:()=>({}),doc:ref,collection:ref,where:(field,op,value)=>({field,value}),query:(path,filter)=>({path,filter}),getDoc:get,setDoc:set,serverTimestamp:()=>1,crypto:{randomUUID:()=>`new-${++sequence}`},photoKey:async p=>'hash-'+p,publicCatalog,readFirebaseCatalog:()=>{},decodePublicOrder:o=>o,
 getDocs:async q=>{const path=typeof q==='string'?q:q.path;calls.push(['query',path]);return {docs:[...records.keys()].filter(k=>k.startsWith(path+'/')&&(!q.filter||records.get(k)[q.filter.field]===q.filter.value)).map(snap)};},
 deleteDoc:async p=>{calls.push(['delete',p]);records.delete(p);},
 runTransaction:async(db,fn)=>{const pending=[];await fn({get,set:(p,v)=>pending.push([p,v])});for(const [p,v] of pending)await set(p,v);},
 createImageBitmap:async()=>({width:100,height:100,close(){}}),document:{createElement:()=>({getContext:()=>({drawImage(){}}),toBlob:cb=>cb({type:'image/webp',size:100})})},FileReader:class {readAsDataURL(){this.result='data:image/webp;base64,AAAA';this.onload();}}});
 vm.runInContext(source+'\nglobalThis.api={publishCatalog,loadEditorCatalog};',context);
 const db=createDatabase();db.settings.story='Complete editable catalog';db.categories[0].active=false;
 function seed(){records.set('catalog/current',{revision:'old',parts:1});records.set('editor/current',{revision:'old',parts:1});records.set('catalogVersions/old/parts/0',{json:JSON.stringify(publicCatalog(db))});records.set('editorVersions/old/parts/0',{json:JSON.stringify(db)});records.set('orders/old_saved',{revision:'old',json:JSON.stringify({id:'saved',number:'1',notes:'private'})});}
 return {records,calls,db,seed,api:context.api,hook:fn=>hook=fn,reloadHook:fn=>reloadHook=fn,publish:(rev='old',read=async()=>null)=>context.api.publishCatalog(db,read,()=>{},rev,{productsOnly:true})};
}
test('product-only preserves existing/concurrent orders, order pointer, inactive catalog and supports repeated loads/publications',async()=>{
 const h=harness();h.seed();h.db.orders=[{invalid:'must never serialize or validate private local drafts'}];
 h.hook(p=>{if(p.startsWith('catalogVersions/new-'))h.records.set('orders/old_concurrent',{revision:'old',json:JSON.stringify({id:'concurrent',number:'2'})});});
 const result=await h.publish();assert.equal(result.productsOnly,true);assert.equal(h.records.get('editor/current').revision,'old');
 assert.equal(h.calls.filter(([op,p])=>p.startsWith('orders/')||p==='orders'||p.startsWith('pickupRequests')).length,0);
 assert.equal(h.records.get('orders/old_saved').json.includes('private'),true);
 let loaded=await h.api.loadEditorCatalog();assert.equal(loaded.revision,result.revision);assert.equal(loaded.database.orders.length,2);assert.deepEqual(structuredClone(loaded.database.categories),h.db.categories);assert.deepEqual(structuredClone(loaded.database.settings),h.db.settings);
 await h.publish(result.revision);loaded=await h.api.loadEditorCatalog();assert.equal(loaded.database.orders.length,2);
});
test('stale and unloaded catalog revisions fail before any writes',async()=>{
 for(const revision of ['stale',undefined]){const h=harness();h.seed();await assert.rejects(h.api.publishCatalog(h.db,()=>null,()=>{},revision,{productsOnly:true}),/Load from Firebase/);assert.equal(h.calls.some(c=>c[0]==='set'),false);}
});
test('catalog conflict during upload preserves winning pointer and orders',async()=>{
 const h=harness();h.seed();h.hook(p=>{if(p.startsWith('catalogVersions/new-'))h.records.set('catalog/current',{revision:'winner',parts:1});});
 await assert.rejects(h.publish(),/Another editor/);assert.equal(h.records.get('catalog/current').revision,'winner');assert.equal(h.records.get('editor/current').revision,'old');assert.equal(h.calls.some(([op])=>op==='delete'),false);
});
test('concurrent calls are rejected even during authentication; failure releases lock',async()=>{
 const h=harness();h.seed();let release;h.reloadHook(()=>new Promise(r=>release=r));const first=h.publish();await assert.rejects(h.publish(),/already running/);release();await first;h.reloadHook(async()=>{});await h.publish('new-1');
});
test('photos reuse cloud copies, upload missing product/category photos, and fail safely when missing',async()=>{
 const h=harness();h.seed();h.db.categories[0].imagePath='assets/products/new.webp';h.db.categories[1].imagePath='assets/products/existing.webp';h.records.set('catalogPhotos/hash-assets/products/existing.webp',{data:'existing'});const reads=[];
 await h.publish('old',async p=>{reads.push(p);return {};});assert.deepEqual(reads,['assets/products/new.webp']);assert.equal(h.records.get('catalogPhotos/hash-assets/products/existing.webp').data,'existing');assert.equal(h.records.get('catalogPhotos/hash-assets/products/new.webp').data,'data:image/webp;base64,AAAA');
 const missing=harness();missing.seed();missing.db.categories[0].imagePath='assets/products/missing.webp';await assert.rejects(missing.publish(),/Missing photo/);assert.equal(missing.records.get('catalog/current').revision,'old');assert.equal(missing.records.get('orders/old_saved').revision,'old');
});
test('first product-only publication works without an order pointer',async()=>{
 const h=harness();await h.api.publishCatalog(h.db,()=>null,()=>{},undefined,{productsOnly:true});const loaded=await h.api.loadEditorCatalog();assert.equal(loaded.database.orders.length,0);assert.equal(h.records.has('editor/current'),false);
});
test('legacy full publish still loads orders and can follow product-only publication',async()=>{
 const h=harness();h.seed();assert.equal((await h.api.loadEditorCatalog()).database.orders.length,1);const result=await h.publish();h.db.orders=[];await h.api.publishCatalog(h.db,()=>null,()=>{},result.revision);assert.equal(h.records.get('editor/current').revision,'new-2');assert.equal((await h.api.loadEditorCatalog()).revision,'new-2');
});
test('cancelled UI publication never invokes service; either button routes the selected mode',async()=>{
 const editor=await readFile(new URL('../assets/js/local-editor.js',import.meta.url),'utf8');const start=editor.indexOf('async function publishToFirebase('),end=editor.indexOf("$('#firebase-publish').addEventListener",start);let calls=0;let accept=false;const buttons={'#firebase-publish-products':{},'#firebase-publish':{},'#firebase-status':{}};
 const ctx=vm.createContext({action:fn=>fn(),cloudBusy:false,uploads:0,confirm:()=>accept,data:{products:[],orders:[]},$:key=>buttons[key],structuredClone,imageBlob:()=>{},cloudRevision:'old',cloudLoaded:true,publishCatalog:async(...args)=>{calls++;assert.equal(args[4].productsOnly,true);return {revision:'new',products:0,collectionPhotos:0};}});vm.runInContext(editor.slice(start,end),ctx);await vm.runInContext('publishToFirebase(true)',ctx);assert.equal(calls,0);accept=true;await vm.runInContext('publishToFirebase(true)',ctx);assert.equal(calls,1);assert.equal(ctx.cloudRevision,'new');assert.match(buttons['#firebase-status'].textContent,/private orders unchanged/);
});

test('100 products, subcategories, hidden items and multi-part editable snapshots survive publication',async()=>{
 const h=harness();h.seed();h.db.subcategories=[{id:'beds',category:'bedroom',name:'Beds',description:'',active:true,imagePath:'assets/images/bed.webp'}];
 h.db.products=Array.from({length:100},(_,i)=>({id:`p${i}`,name:`Bed ${i}`,sku:`SKU${i}`,description:'x'.repeat(4000),priceCents:10000,oldPriceCents:12000,stock:1,category:'bedroom',subcategory:'beds',dimensions:'80 in',material:'Wood',finish:'Oak',images:['assets/images/bed.webp'],active:i!==0,available:true,featured:false}));
 await h.publish();const loaded=await h.api.loadEditorCatalog();assert.deepEqual(structuredClone(loaded.database.products),h.db.products);assert.deepEqual(structuredClone(loaded.database.subcategories),h.db.subcategories);assert.ok(JSON.parse(h.records.get('editorVersions/new-1/parts/99').json).parts>1);
 const pointer=h.records.get('catalog/current');const publicData=JSON.parse(Array.from({length:pointer.parts},(_,i)=>h.records.get(`catalogVersions/${pointer.revision}/parts/${i}`).json).join(''));assert.equal(publicData.products.length,99);assert.equal('orders' in publicData,false);
});

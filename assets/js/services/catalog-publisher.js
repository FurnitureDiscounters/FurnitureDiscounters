import { getAuth, onAuthStateChanged, setPersistence, inMemoryPersistence, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, connectAuthEmulator, sendEmailVerification, reload } from 'firebase/auth';
import { getApps } from 'firebase/app';
import { getFirestore as liveFirestore, connectFirestoreEmulator as connectLiveEmulator, onSnapshot, collection as liveCollection, doc as liveDoc, query as liveQuery, where as liveWhere } from 'firebase/firestore';
import { doc, getDoc, getDocs, collection, query, where, setDoc, serverTimestamp, runTransaction } from 'firebase/firestore/lite';
import { catalogDatabase, readFirebaseCatalog, photoKey } from './firebase-catalog.js';
import { decodePublicOrder } from './public-order-service.js';
import { publicCatalog } from '../catalog-model.js';
export const OWNER_UID='YHWYz24VL4hQ3vZWQv0hUBxo8Xw1';
export const OWNER_EMAIL='furniture.discounters.offcial@gmail.com';
export const isOwner=user=>user&&(user.uid===OWNER_UID||(user.email===OWNER_EMAIL&&user.emailVerified));
const asciiJSON=value=>JSON.stringify(value).replace(/[\u007f-\uffff]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));
let auth, publishing=false;
export function publisherAuth() {
  if(auth)return auth;catalogDatabase();auth=getAuth(getApps().find(a=>a.name==='furniture-catalog'));
  if(['localhost','127.0.0.1'].includes(location.hostname)&&new URLSearchParams(location.search).get('emulator')==='1')connectAuthEmulator(auth,'http://127.0.0.1:9099',{disableWarnings:true});
  return auth;
}
export async function publisherLogin(email,password) {
  const a=publisherAuth();await setPersistence(a,inMemoryPersistence);
  const result=await signInWithEmailAndPassword(a,email,password);
  if(result.user.uid!==OWNER_UID&&result.user.email!==OWNER_EMAIL){await signOut(a);throw new Error('This account is not the store owner account. Use the store email you provided.');}
  return result.user;
}
export async function publisherCreateAccount(email,password){if(email!==OWNER_EMAIL)throw new Error('Use the store email you provided.');const a=publisherAuth();await setPersistence(a,inMemoryPersistence);return (await createUserWithEmailAndPassword(a,email,password)).user;}
export async function publisherLogout(){if(auth)await signOut(auth);}
async function optimizedPhoto(blob) {
  const bitmap=await createImageBitmap(blob),canvas=document.createElement('canvas');
  try {for(const [maximum,quality] of [[1200,.8],[1000,.65],[700,.55]]){const scale=Math.min(1,maximum/Math.max(bitmap.width,bitmap.height));canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);const encoded=await new Promise(resolve=>canvas.toBlob(resolve,'image/webp',quality));if(encoded&&encoded.type==='image/webp'&&encoded.size<=650000)return await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error);reader.readAsDataURL(encoded);});}throw new Error('A photo is too large for the free Firebase setup. Use a smaller photo.');}finally{bitmap.close();}
}
export async function publishCatalog(database,readPhoto,onProgress=()=>{},expectedRevision=undefined,{productsOnly=false}={}) {
  if(publishing)throw new Error('A publication is already running.');
  publishing=true;
  try {
    if(publisherAuth().currentUser){await reload(publisherAuth().currentUser);await publisherAuth().currentUser.getIdToken(true);}
    if(!isOwner(publisherAuth().currentUser))throw new Error('Sign in and verify your store email before publishing.');
    const db=catalogDatabase(),current=doc(db,'catalog','current'),previous=await getDoc(current),previousEditor=productsOnly?null:await getDoc(doc(db,'editor','current')),base=previous.exists()?previous.data().revision:null;
    if(base!==null&&expectedRevision===undefined)throw new Error('Firebase already contains a catalog. Load from Firebase before publishing. Back up local drafts first.');
    if(expectedRevision!==undefined&&expectedRevision!==base)throw new Error('The online catalog changed. Load from Firebase before publishing to avoid overwriting another update.');
    let orderKeys=[],deleted=new Set();
    if(productsOnly)database={...database,orders:[]};
    else {
    const deletionDocs=await getDocs(query(collection(db,'orders'),where('revision','==','deleted-orders')));deleted=new Set(deletionDocs.docs.map(d=>d.id));
    orderKeys=await Promise.all(database.orders.map(async o=>({order:o,key:'deleted_'+await orderDeletionKey(o)})));
    database={...database,orders:orderKeys.filter(v=>!deleted.has(v.key)).map(v=>v.order)};
    }
    const catalog=publicCatalog(database),paths=new Set([...database.products.flatMap(p=>p.images),...database.categories.map(c=>c.imagePath).filter(Boolean),...database.subcategories.map(s=>s.imagePath).filter(Boolean)]);
    let n=0;
    for(const path of paths){onProgress(`Uploading photos ${++n} of ${paths.size}…`);if(!path.startsWith('assets/products/'))continue;const ref=doc(db,'catalogPhotos',await photoKey(path)),existing=await getDoc(ref);if(existing.exists())continue;const blob=await readPhoto(path);if(!blob)throw new Error(`Missing photo: ${path}. Open your photo backup before publishing.`);await setDoc(ref,{data:await optimizedPhoto(blob)});}
    const json=asciiJSON(catalog),chunks=[];for(let i=0;i<json.length;i+=150000)chunks.push(json.slice(i,i+150000));
    if(chunks.length>100)throw new Error('This catalog is too large to publish.');
    const revision=crypto.randomUUID();
    const privateJson=asciiJSON({...database,orders:[]}),privateChunks=[];for(let i=0;i<privateJson.length;i+=150000)privateChunks.push(privateJson.slice(i,i+150000));if(privateChunks.length>(productsOnly?99:100))throw new Error('The private catalog is too large to publish.');
    for(let i=0;i<privateChunks.length;i++)await setDoc(doc(db,'editorVersions',revision,'parts',String(i)),{json:privateChunks[i]});
    // Part 99 is metadata only for catalog-only revisions; editor/current keeps owning orders.
    if(productsOnly)await setDoc(doc(db,'editorVersions',revision,'parts','99'),{json:JSON.stringify({kind:'catalog-only',parts:privateChunks.length})});
    for(const order of database.orders)await setDoc(doc(db,'orders',revision+'_'+order.id),{json:JSON.stringify(order),revision,updatedAt:serverTimestamp()});
    for(let i=0;i<chunks.length;i++){onProgress(`Uploading catalog ${i+1} of ${chunks.length}…`);await setDoc(doc(db,'catalogVersions',revision,'parts',String(i)),{json:chunks[i]});}
    await runTransaction(db,async tx=>{const latest=await tx.get(current),value=latest.exists()?latest.data().revision:null;if(value!==base)throw new Error('Another editor published while you were uploading. Load from Firebase before retrying.');for(const item of orderKeys.filter(v=>!deleted.has(v.key))){if((await tx.get(doc(db,'orders',item.key))).exists())throw new Error('An order was deleted while publishing. Retry to keep it deleted.');}tx.set(current,{revision,parts:chunks.length,updatedAt:serverTimestamp()});if(!productsOnly)tx.set(doc(db,'editor','current'),{revision,parts:privateChunks.length,updatedAt:serverTimestamp()});});
    // Retire old chunks after the new pointer is live; failed cleanup never reverses publication.
    let cleanupNeeded=false;
    if(previous.exists()){try{const {deleteDoc}=await import('firebase/firestore/lite');for(let i=0;i<previous.data().parts;i++)await deleteDoc(doc(db,'catalogVersions',base,'parts',String(i)));if(previousEditor?.exists()){const old=previousEditor.data();for(let i=0;i<old.parts;i++)await deleteDoc(doc(db,'editorVersions',old.revision,'parts',String(i)));const oldOrders=await getDocs(query(collection(db,'orders'),where('revision','==',old.revision)));for(const order of oldOrders.docs)await deleteDoc(order.ref);}}catch{cleanupNeeded=true;}}
    return {revision,productsOnly,products:catalog.products.length,orders:database.orders.length,collectionPhotos:[...catalog.categories,...catalog.subcategories].filter(c=>c.imagePath).length,cleanupNeeded};
  }finally{publishing=false;}
}
export async function verifyPublisherEmail(){const user=publisherAuth().currentUser;if(!user)throw new Error('Sign in first.');await sendEmailVerification(user);}
export async function loadEditorCatalog(){
  const db=catalogDatabase(),current=await getDoc(doc(db,'catalog','current')),saved=await getDoc(doc(db,'editor','current'));
  if(!current.exists())throw new Error('No editor database has been published to Firebase yet.');
  const revision=current.data().revision,orderRevision=saved.exists()?saved.data().revision:null;
  let parts;
  if(revision===orderRevision)parts=saved.data().parts;
  else {
    const metadata=await getDoc(doc(db,'editorVersions',revision,'parts','99'));
    if(!metadata.exists())throw new Error('The cloud editor database is incomplete.');
    const info=JSON.parse(metadata.data().json);
    if(info.kind!=='catalog-only'||!Number.isInteger(info.parts)||info.parts<1||info.parts>99)throw new Error('Invalid cloud database metadata.');
    parts=info.parts;
  }
  if(!/^[A-Za-z0-9_-]{1,80}$/.test(revision)||!Number.isInteger(parts)||parts<1||parts>100)throw new Error('Invalid cloud database metadata.');
  const docs=await Promise.all(Array.from({length:parts},(_,i)=>getDoc(doc(db,'editorVersions',revision,'parts',String(i)))));
  if(docs.some(d=>!d.exists()))throw new Error('The cloud editor database is incomplete.');
  const database=JSON.parse(docs.map(d=>d.data().json).join(''));
  const orders=orderRevision?await getDocs(query(collection(db,'orders'),where('revision','==',orderRevision))):{docs:[]};
  database.orders=orders.docs.map(d=>JSON.parse(d.data().json));
  const inquiries=await getDocs(collection(db,'pickupRequests'));const numbers=new Set(database.orders.map(o=>`${o.week||''}:${o.number}`));for(const d of inquiries.docs){const o=decodePublicOrder(d.data());if(!numbers.has(`${o.week||''}:${o.number}`))database.orders.push({id:d.id,number:o.number,week:o.week||'',lookupKey:o.lookupKey||'',name:'',email:'',phone:'',notes:'Website inquiry; confirm prices and pickup with the customer.',createdAt:o.createdAt.toDate().toISOString(),items:o.items});}const latest=await getDoc(doc(db,'catalog','current'));if(!latest.exists()||latest.data().revision!==revision)throw new Error('The online catalog changed while loading. Load from Firebase again.');return {database,revision};}
export { readFirebaseCatalog };

let liveDatabase;
function orderDatabase() {
  if(liveDatabase)return liveDatabase;
  publisherAuth();liveDatabase=liveFirestore(getApps().find(a=>a.name==='furniture-catalog'));
  if(['localhost','127.0.0.1'].includes(location.hostname)&&new URLSearchParams(location.search).get('emulator')==='1')connectLiveEmulator(liveDatabase,'127.0.0.1',8080);
  return liveDatabase;
}
// Order subscriptions do not load or replace the editor's catalog or local drafts.
export function watchStoreOrders(onOrders,onStatus) {
  let stops=[],generation=0;
  const clear=()=>{generation++;for(const stop of stops)stop();stops=[];};
  const stopAuth=onAuthStateChanged(publisherAuth(),user=>{
    clear();onOrders([]);
    if(!isOwner(user)){onStatus(user?'Verify your store email to see live orders.':'Connect Firebase to see incoming orders live.');return;}
    const db=orderDatabase(),session=generation;
    let inquiries=[],privateOrders=[],deletedHashes=new Set(),emission=0,stopPrivate=()=>{},inquiriesReady=false,privateReady=false,deletionsReady=false,failed=false;
    const emit=async()=>{if(session!==generation)return;const version=++emission,merged=new Map(inquiries.map(o=>[`${o.week||''}:${o.number}`,o]));for(const o of privateOrders)merged.set(`${o.week||''}:${o.number}`,o);const rows=await Promise.all([...merged.values()].map(async o=>({order:o,hash:await orderDeletionKey(o)})));if(session!==generation||version!==emission)return;onOrders(rows.filter(r=>!deletedHashes.has(r.hash)).map(r=>r.order),new Set(deletedHashes));if(inquiriesReady&&privateReady&&deletionsReady&&!failed)onStatus('Live · Incoming orders update automatically.');};
    const error=e=>{if(session===generation){failed=true;onStatus('Live orders unavailable: '+(e.message||'Check your Firebase access.'));}};
    onStatus('Connecting to live orders…');
    stops.push(onSnapshot(liveCollection(db,'pickupRequests'),snapshot=>{
      if(session!==generation)return;
      inquiries=snapshot.docs.map(d=>{const o=decodePublicOrder(d.data());return {id:d.id,number:o.number,week:o.week||'',lookupKey:o.lookupKey||'',name:'',email:'',phone:'',notes:'Website inquiry; confirm prices and pickup with the customer.',createdAt:o.createdAt?.toDate().toISOString()||'',items:o.items};});inquiriesReady=true;emit();
    },error));
    stops.push(onSnapshot(liveQuery(liveCollection(db,'orders'),liveWhere('revision','==','deleted-orders')),snapshot=>{if(session!==generation)return;deletedHashes=new Set(snapshot.docs.map(d=>d.id.replace(/^deleted_/,'')));deletionsReady=true;void emit();},error));
    stops.push(onSnapshot(liveDoc(db,'editor','current'),snapshot=>{
      if(session!==generation)return;
      stopPrivate();privateOrders=[];privateReady=false;
      if(!snapshot.exists()){privateReady=true;emit();return;}
      const revision=snapshot.data().revision;
      stopPrivate=onSnapshot(liveQuery(liveCollection(db,'orders'),liveWhere('revision','==',revision)),orders=>{
        if(session!==generation)return;privateOrders=orders.docs.map(d=>JSON.parse(d.data().json));privateReady=true;emit();
      },error);
    },error));
    stops.push(()=>stopPrivate());
  });
  return ()=>{clear();stopAuth();};
}

// Only a hash remains: no order number, products, contact details or order snapshot.
export const orderIdentity=order=>`${order.week||''}:${order.number}:${new Date(order.createdAt).toISOString()}`;
export const orderDeletionKey=order=>photoKey(orderIdentity(order));
export async function deleteStoreOrder(order){
  if(!isOwner(publisherAuth().currentUser))throw new Error('Connect your verified store account to delete online orders.');
  if(publishing)throw new Error('Wait for catalog publishing to finish before deleting an order.');
  const db=catalogDatabase(),hash=await orderDeletionKey(order),saved=await getDocs(collection(db,'orders'));
  const copies=saved.docs.filter(d=>{try{return orderIdentity(JSON.parse(d.data().json))===orderIdentity(order);}catch{return false;}});
  if(copies.length>498)throw new Error('Too many cloud copies to delete safely in one operation.');
  // Atomic deletion: denied public deletion keeps all private copies and the hash receipt untouched.
  const publicRef=order.lookupKey&&/^FD-[0-9]{8}-[A-F0-9]{32}$/.test(order.lookupKey)?doc(db,'pickupRequests',order.lookupKey):null;
  try{await runTransaction(db,async tx=>{
    const publicCopy=publicRef?await tx.get(publicRef):null;
    // A numeric reference can be reused after deletion. Never delete a newer inquiry with that number.
    const sameInquiry=publicCopy?.exists()&&publicCopy.data().createdAt.toDate().toISOString()===new Date(order.createdAt).toISOString();
    for(const d of copies)tx.delete(d.ref);
    if(sameInquiry)tx.delete(publicRef);
    tx.set(doc(db,'orders','deleted_'+hash),{json:'{}',revision:'deleted-orders',updatedAt:serverTimestamp()});
  });}catch(error){if(error.code==='permission-denied')throw new Error('Order was not deleted. Publish the updated firestore.rules in Firebase Database → Rules, then try again.');throw error;}

}

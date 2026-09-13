// Device-only usage ledger. No fetch, analytics, portfolio amounts or model decisions.
import {validDecision,DECISION_VERSION} from './decisions.js';
import {validTags,RATIONALE_VERSION} from './rationales.js';
export const USAGE_PREFIX='mystockos.usage.v1.';
export const USAGE_BUDGET_BYTES=1_000_000;
const LAST_KEY='mystockos.usage-last.v1';
let databasePromise;
async function preferredStorage(){
 if(typeof indexedDB==='undefined')return localStorage;
 if(!databasePromise)databasePromise=new Promise((resolve,reject)=>{
  const request=indexedDB.open('mystockos-device-usage-v1',1);
  request.onupgradeneeded=()=>request.result.createObjectStore('records');
  request.onsuccess=()=>resolve(request.result);
  request.onerror=()=>reject(request.error);
  request.onblocked=()=>reject(Error('利用履歴の保存領域を開けません。'));
 }).catch(e=>{databasePromise=null;throw e;});
 const db=await databasePromise;
 const read=(method,key)=>new Promise((resolve,reject)=>{
  const request=db.transaction('records','readonly').objectStore('records')[method](key);
  request.onsuccess=()=>resolve(request.result??null);request.onerror=()=>reject(request.error);
 });
 return {kind:'indexeddb',keys:()=>read('getAllKeys'),getItem:k=>read('get',k),
  setItem:async(k,v)=>{
   try{await new Promise((resolve,reject)=>{
    const tx=db.transaction('records','readwrite'),store=tx.objectStore('records');
    // Immutable snapshot keys use add; only the last-event pointer uses put.
    store[k.startsWith(USAGE_PREFIX)?'add':'put'](v,k);
    tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
   });}catch(e){if(await read('get',k)!==v)throw e;}
  }};
}
const keys=async storage=>storage.keys?await storage.keys():Array.from({length:storage.length},(_,i)=>storage.key(i));
export const stable=value=>JSON.stringify(value,(_k,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const hash=async text=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(x=>x.toString(16).padStart(2,'0')).join('');
const dayJST=stamp=>new Date(new Date(stamp).getTime()+9*3600000).toISOString().slice(0,10);

export function usageInput(state,data,stamp){
 if(!data.themes?.value)return null; // Do not manufacture pre-observation history.
 const decisions=[];
 for(const h of state.holdings){
  if(!validDecision('held',h.decision))throw Error('保有判断の形式を確認してください。');
  decisions.push({ticker:h.ticker,scope:'held',value:h.decision});
 }
 for(const ticker of state.watch){
  const value=state.watchDecisions[ticker]||'unset';
  if(!validDecision('watch',value))throw Error('監視判断の形式を確認してください。');
  decisions.push({ticker,scope:'watch',value});
 }
 decisions.sort((a,b)=>`${a.ticker}:${a.scope}`.localeCompare(`${b.ticker}:${b.scope}`));
 const rationales=[...new Set(decisions.map(d=>d.ticker))].sort().map(ticker=>{
  const tags=state.rationales[ticker]||[];
  if(!validTags(tags))throw Error('投資根拠の形式を確認してください。');
  return {ticker,tags:[...tags].sort(),status:state.rationaleReview?.[ticker]?'review_required':'recorded'};
 });
 const context={};
 for(const key of ['themes','regime','stocks']){
  const source=data[key],value=source?.value;
  context[key]={data_as_of:value?.as_of??value?.updated_at??null,
   calculated_at:value?.calculated_at??null,cached:!!source?.cached,
   quality:!value?'missing':source?.error?'cached_or_failed':'observed',
   source:{themes:'data/themes.json',regime:'data/regime.json',stocks:'data.json'}[key]};
 }
 context.phaseA={data_as_of:data.phaseA?.as_of??null,known_at:data.phaseA?.known_at??null,
  quality:data.phaseA?'observed':'missing',source:'data/phase_a.json'};
 const tickers=new Set(decisions.map(d=>d.ticker));
 const themeContext=(data.themes.value.themes||[]).filter(t=>[...(t.core_members||[]),...(t.related_members||[]),...(t.watch_members||[])].some(x=>tickers.has(x))).map(t=>{
  const p=data.phaseA?.themes?.[t.theme_id];
  return {theme_id:t.theme_id,score_mode:t.score_mode,strength:t.strength??null,velocity:t.velocity??null,
   heat:t.heat??null,turning:t.turning??null,turning_watch:t.turning_watch??null,
   quality:t.data_quality??null,benchmark:t.benchmark??null,
   core_members:t.core_members||[],related_members:t.related_members||[],watch_members:t.watch_members||[],
   display_metrics:p?Object.fromEntries(['return_1d','return_5d','return_21d','return_63d','rvol','rank_history','rank_change_5d'].map(k=>[k,p[k]??null])):null};
 });
 // Compact source context and immutable hashes; full market output is archived separately.
 return {schema_version:1,kind:'manual_usage_snapshot',namespace:'device_usage',
  usage_day_jst:dayJST(stamp),source:'manual',timestamp_source:'device_clock',decision_enum_version:DECISION_VERSION,
  rationale_enum_version:RATIONALE_VERSION,decisions,rationales,market_context:context,
  theme_context:structuredClone(themeContext),
  decision_event_id:state.decisionHistory.at(-1)?.id??null,
  rationale_event_id:state.rationaleHistory.at(-1)?.id??null,
  shadow_prediction_id:null,production_forward_used:false};
}

export async function saveUsage(input,sourceValues,storage,stamp){
 if(!input)return {status:'not_observed'};
 const hashes={};
 for(const [key,value] of Object.entries(sourceValues))hashes[key]=value==null?null:await hash(stable(value));
 const snapshot={...input,source_hashes:hashes};
 const fingerprint=await hash(stable(snapshot));
 let previous=null;
 try{previous=JSON.parse(await storage.getItem(LAST_KEY)||'null');}catch{}
 // Compare to the last event, not every historical record: A -> B -> A is a real change.
 if(previous?.fingerprint===fingerprint&&await storage.getItem(USAGE_PREFIX+previous.record_id))return {status:'unchanged'};
 const body={...snapshot,recorded_at:stamp,previous_record_id:previous?.record_id??null};
 const record_id=await hash(stable(body)),key=USAGE_PREFIX+record_id;
 const record={record_id,payload:body},encoded=JSON.stringify(record);
 const prior=await storage.getItem(key);
 if(prior&&prior!==encoded)throw Error('利用履歴の整合性を確認してください。');
 if(!prior&&storage.kind!=='indexeddb'){
  let usage=0,total=0;
  for(const k of await keys(storage)){const size=2*(k.length+(await storage.getItem(k)||'').length);total+=size;if(k.startsWith(USAGE_PREFIX))usage+=size;}
  const added=2*(key.length+encoded.length);
  if(usage+added>USAGE_BUDGET_BYTES||total+added>3_000_000)throw Error('利用履歴の保存上限です。既存データは削除していません。');
 }
 if(!prior)await storage.setItem(key,encoded); // Per-record append, no rewriting or silent pruning.
 await storage.setItem(LAST_KEY,JSON.stringify({record_id,fingerprint}));
 return {status:'recorded',record_id};
}

let queue=Promise.resolve(),lastError='';
export const usageError=()=>lastError;
export function captureUsage(state,data,onError=()=>{},stamp=new Date().toISOString()){
 // Clone immediately, so an asynchronous digest cannot capture a later manual choice.
 let input,sources;
 try{input=usageInput(state,data,stamp);sources=structuredClone({themes:data.themes?.value??null,
  regime:data.regime?.value??null,stocks:data.stocks?.value??null,phaseA:data.phaseA??null});}
 catch(e){onError(e.message);return;}
 queue=queue.then(async()=>saveUsage(input,sources,await preferredStorage(),stamp)).then(()=>{lastError='';}).catch(()=>{
  const message='利用履歴を端末に保存できませんでした。設定からバックアップを確認してください。保有・会計の保存とは別です。';
  if(lastError!==message)onError(message);
  lastError=message;
 });
 return queue;
}

export async function usageBackup(storage){
 await queue;
 const target=storage??await preferredStorage();
 const stores=!storage&&target.kind==='indexeddb'?[target,localStorage]:[target];
 const records=[];
 const seen=new Set();
 for(const source of stores)for(const key of await keys(source)){
  if(!key?.startsWith(USAGE_PREFIX))continue;
  const record=JSON.parse(await source.getItem(key));
  if(record.record_id!==await hash(stable(record.payload))||key!==USAGE_PREFIX+record.record_id)throw Error('利用履歴の整合性を確認してください。');
  if(!seen.has(record.record_id))records.push(record);
  seen.add(record.record_id);
 }
 records.sort((a,b)=>a.payload.recorded_at.localeCompare(b.payload.recorded_at)||a.record_id.localeCompare(b.record_id));
 return JSON.stringify({schema_version:1,namespace:'device_usage',exported_at:new Date().toISOString(),records},null,2);
}

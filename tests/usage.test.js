import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fresh} from '../assets/js/state.js';
import {usageInput,saveUsage,usageBackup,USAGE_PREFIX,USAGE_BUDGET_BYTES} from '../assets/js/usage.js';

function storage(){const map=new Map();return {get length(){return map.size;},key:i=>[...map.keys()][i],getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,String(v))};}
function fixture(){const s=fresh();s.holdings=[{ticker:'MU',quantity:12,cost:50,currency:'USD',decision:'hold'}];s.rationales.MU=['theme_growth','earnings_growth'];return s;}
const data={themes:{value:{as_of:'2026-09-11',themes:[{theme_id:'memory_hbm',score_mode:'thin',core_members:['MU'],strength:{score:88},heat:{score:70,breadth:{now_above:1,eligible_n:2}},data_quality:{status:'ok'},benchmark:'SPY'}]}},regime:{value:{as_of:'2026-09-11',market:{regime:'Neutral'}}}};
const values={themes:data.themes.value,regime:data.regime.value};

test('Usage is device-only and excludes amounts, credentials and model judgments',()=>{
 const s=fixture(),before=JSON.stringify(s),record=usageInput(s,data,'2026-09-13T16:00:00Z');
 assert.equal(record.usage_day_jst,'2026-09-14');assert.equal(record.namespace,'device_usage');
 assert.equal(record.shadow_prediction_id,null);assert.equal(record.production_forward_used,false);
 assert.ok(record.decisions.some(d=>d.ticker==='MU'&&d.scope==='held'&&d.value==='hold'));
 assert.equal(record.theme_context[0].strength.score,88);
 assert.deepEqual(record.theme_context[0].heat.breadth,{now_above:1,eligible_n:2});
 assert.doesNotMatch(JSON.stringify(record),/"quantity"|"cost"|"assets_jpy"|"policy"/);
 assert.equal(JSON.stringify(s),before);
 assert.doesNotMatch(fs.readFileSync('assets/js/usage.js','utf8'),/fetch\s*\(|sendBeacon\s*\(|XMLHttpRequest/);
});

test('Unchanged render deduplicates, next usage day records without filling missed days',async()=>{
 const s=fixture(),db=storage();
 let stamp='2026-09-13T01:00:00Z';const input=usageInput(s,data,stamp);
 assert.equal((await saveUsage(input,values,db,stamp)).status,'recorded');
 assert.equal((await saveUsage(input,values,db,'2026-09-13T02:00:00Z')).status,'unchanged');
 stamp='2026-09-16T01:00:00Z';await saveUsage(usageInput(s,data,stamp),values,db,stamp);
 const result=JSON.parse(await usageBackup(db));
 assert.deepEqual(result.records.map(r=>r.payload.usage_day_jst),['2026-09-13','2026-09-16']);
});

test('A to B to A is retained and earlier tags stay immutable',async()=>{
 const s=fixture(),db=storage();
 const first=await saveUsage(usageInput(s,data,'2026-09-13T01:00:00Z'),values,db,'2026-09-13T01:00:00Z');
 const raw=db.getItem(USAGE_PREFIX+first.record_id);
 s.holdings[0].decision='reduce_review';s.rationales.MU=['supply_demand'];
 await saveUsage(usageInput(s,data,'2026-09-13T02:00:00Z'),values,db,'2026-09-13T02:00:00Z');
 s.holdings[0].decision='hold';s.rationales.MU=['theme_growth','earnings_growth'];
 await saveUsage(usageInput(s,data,'2026-09-13T03:00:00Z'),values,db,'2026-09-13T03:00:00Z');
 assert.equal(JSON.parse(await usageBackup(db)).records.length,3);
 assert.equal(db.getItem(USAGE_PREFIX+first.record_id),raw);
});

test('Invalid manual fields rejected; absent/cached market data is not fabricated',()=>{
 const s=fixture();assert.equal(usageInput(s,{},'2026-09-13T01:00:00Z'),null);
 const cached=structuredClone(data);cached.themes.cached=true;cached.themes.error='timeout';
 assert.equal(usageInput(s,cached,'2026-09-13T01:00:00Z').market_context.themes.quality,'cached_or_failed');
 s.rationales.MU=['theme_growth','earnings_growth','supply_demand','catalyst'];
 assert.throws(()=>usageInput(s,data,'2026-09-13T01:00:00Z'));
 s.rationales.MU=[];s.holdings[0].decision='AI_BUY';assert.throws(()=>usageInput(s,data,'2026-09-13T01:00:00Z'));
});

test('Storage budget protects accounting space and never prunes past usage',async()=>{
 const s=fixture(),db=storage();
 db.setItem(USAGE_PREFIX+'old','a'.repeat(USAGE_BUDGET_BYTES/2));
 const raw=db.getItem(USAGE_PREFIX+'old');
 await assert.rejects(saveUsage(usageInput(s,data,'2026-09-13T01:00:00Z'),values,db,'2026-09-13T01:00:00Z'),/保存上限/);
 assert.equal(db.getItem(USAGE_PREFIX+'old'),raw);
});

test('Export detects corruption and preserves source hashes',async()=>{
 const s=fixture(),db=storage(),stamp='2026-09-13T01:00:00Z';
 const {record_id}=await saveUsage(usageInput(s,data,stamp),values,db,stamp);
 const backup=JSON.parse(await usageBackup(db));assert.match(backup.records[0].payload.source_hashes.themes,/^[a-f0-9]{64}$/);
 const row=JSON.parse(db.getItem(USAGE_PREFIX+record_id));row.payload.decisions=[];db.setItem(USAGE_PREFIX+record_id,JSON.stringify(row));
 await assert.rejects(usageBackup(db),/整合性/);
});

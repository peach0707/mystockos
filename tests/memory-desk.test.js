import test from 'node:test';
import assert from 'node:assert/strict';
import {memoryReadings,memoryDesk} from '../assets/js/memory-desk.js';
const now=Date.parse('2026-10-03T10:00:00Z');
function data(){return {calendar:{value:{start:'2026-10-01',end:'2026-10-30',sessions:[{date:'2026-10-02',close:'2026-10-02T20:00:00Z'}]}},setups:{value:{stocks:Object.fromEntries(['MU','SKHY','SNDK'].map(t=>[t,{ticker:t,as_of:'2026-10-02',quality:'ok',price:110,ma20:105,ma50:100,prior_high20:115,prior_low20:90,rsi14_simple:t==='MU'?75:55,distance_ma20_pct:4.76,trend_up:true,history_sessions:t==='SKHY'?60:64,returns:{5:2,21:10,63:t==='SKHY'?null:15}}]))}}};}
test('SKHY can use 50-day evidence even when 63-day theme score is unavailable',()=>{
 const d=data(),before=JSON.stringify(d),rows=memoryReadings(d,now);
 assert.equal(rows.filter(r=>r.ready).length,3);assert.equal(rows[1].trend,'上昇基調');assert.equal(rows[0].hot,true);assert.equal(rows[1].hot,false);
 assert.match(memoryDesk(d,{now}),/3社とも上昇基調。過熱には差/);assert.equal(JSON.stringify(d),before);
});
test('missing or stale member never blocks valid peers or claims all three are strong',()=>{
 const d=data();d.setups.value.stocks.SKHY.as_of='2026-10-01';
 const rows=memoryReadings(d,now);assert.equal(rows[1].ready,false);assert.equal(rows[0].ready,true);
 assert.match(memoryDesk(d,{now}),/2\/3社を確認済み/);
 d.setups.cached=true;assert.equal(memoryReadings(d,now).filter(r=>r.ready).length,0);
});
test('weak trend remains distinct from high RSI and has priority for next check',()=>{
 const d=data();Object.assign(d.setups.value.stocks.MU,{price:85,ma20:95,rsi14_simple:75});
 const r=memoryReadings(d,now)[0];assert.equal(r.trend,'下落基調');assert.equal(r.broken,true);assert.equal(r.action,'保有理由を再点検');
});

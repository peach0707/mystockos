import test from 'node:test';
import assert from 'node:assert/strict';
import {expectedSession,dateState} from '../assets/js/freshness.js';
import {setupFor} from '../assets/js/setups.js';
import {fresh} from '../assets/js/state.js';
import {stocksView} from '../assets/js/views.js';

const cal={start:'2026-09-01',end:'2026-10-01',sessions:[{date:'2026-09-04',close:'2026-09-04T20:00:00Z'},{date:'2026-09-08',close:'2026-09-08T20:00:00Z'}]};
const now=Date.parse('2026-09-09T02:00:00Z');
const row={ticker:'TEST',as_of:'2026-09-08',quality:'ok',price:110,ma20:108,ma50:100,prior_high20:109,prior_low20:90,rsi14_simple:65,distance_ma20_pct:1.8,breakout:true,trend_up:true,rvol:1.3};
const input=()=>({calendar:{value:cal},setups:{value:{stocks:{TEST:{...row}}}}});
test('exchange sessions handle Labor Day and the close publication grace',()=>{
 assert.equal(expectedSession(cal,Date.parse('2026-09-07T22:00:00Z')),'2026-09-04');
 assert.equal(expectedSession(cal,Date.parse('2026-09-08T20:15:00Z')),'2026-09-04');
 assert.equal(dateState('2026-09-08',cal,now).state,'current');
 assert.equal(dateState('2026-09-09',cal,now).state,'invalid');
 assert.equal(dateState('2026-09-08',cal,Date.parse('2026-11-01')).state,'unknown');
});
test('stale, cached, malformed and mismatched-price dates block check labels',()=>{
 const good=input();assert.equal(setupFor(good,'TEST',now).code,'breakout');
 for(const alter of [d=>d.setups.value.stocks.TEST.as_of='2026-09-04',d=>d.setups.cached=true,d=>d.setups.value.stocks.TEST.ma50=null,d=>d.stocks={value:{stocks:[{ticker:'TEST',date:'2026-09-09',price:120}]}}]){
  const d=input();alter(d);assert.equal(setupFor(d,'TEST',now).ready,false);
 }
});
test('checks never modify saved user decisions or frozen outputs',()=>{
 const s=fresh();s.watch=['TEST'];s.watchDecisions.TEST='wait_results';
 const d=input(),before=JSON.stringify([s,d]);
 setupFor(d,'TEST',now);const html=stocksView(d,s,'watch');
 assert.match(html,/決算待ち/);assert.equal(JSON.stringify([s,d]),before);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {DECISIONS,recordDecision,decisionPill,decisionSelect} from '../assets/js/decisions.js';
import {fresh,validate,migrate,read,get,KEY,V3_KEY,storageError} from '../assets/js/state.js';
import {stocksView} from '../assets/js/views.js';
import {portfolioView} from '../assets/js/portfolio.js';
const holding=()=>({ticker:'MU',quantity:10,cost:100,currency:'USD',decision:'unset'});
test('every selectable enum persists, renders a Japanese pill and round-trips',()=>{
 for(const scope of ['held','watch'])for(const value of Object.keys(DECISIONS[scope])){
  const s=fresh();s.holdings=[holding()];recordDecision(s,scope,'MU',value,'2026-09-09T12:00:00.000Z','test');validate(s);
  assert.deepEqual(migrate(JSON.parse(JSON.stringify(s))),s);assert.ok(decisionPill(value,scope).includes(DECISIONS[scope][value][0]));
 }
});
test('manual changes append timestamped fixed-enum history, unchanged saves do not duplicate',()=>{
 const s=fresh();s.holdings=[holding()];recordDecision(s,'held','MU','hold','2026-09-09T12:00:00.000Z','one');
 const first=structuredClone(s.decisionHistory[0]);recordDecision(s,'held','MU','hold','2026-09-09T13:00:00.000Z','two');assert.equal(s.decisionHistory.length,1);
 recordDecision(s,'held','MU','reduce_review','2026-09-09T14:00:00.000Z','three');assert.deepEqual(s.decisionHistory[0],first);assert.equal(s.decisionHistory.length,2);assert.equal(first.source,'manual');validate(s);
});
test('free text, wrong-scope enums, unregistered tickers and invalid imported enums are rejected',()=>{
 const s=fresh();s.holdings=[holding()];const before=JSON.stringify(s);
 for(const value of ['保有継続','unknown','watching','constructor',['hold']])assert.throws(()=>recordDecision(s,'held','MU',value));
 assert.throws(()=>recordDecision(s,'watch','NVDAAAA','watching'));assert.equal(JSON.stringify(s),before);
 s.holdings[0].decision='free memo';assert.throws(()=>validate(s));s.holdings[0].decision='hold';s.watchDecisions.MU='hold';assert.throws(()=>validate(s));
 assert.match(decisionPill('constructor'),/未選択/);
});
test('v3 migration maps only exact decisions, preserves old prose and does not fabricate dated history',()=>{
 const old={...fresh(),version:3,holdings:[{...holding(),decision:'保有継続',rationale:'旧根拠',buyCondition:'旧条件'},{...holding(),ticker:'TSM',decision:'保有継続かも'}],watchNotes:{MU:'押し目で買いたい'}};
 const raw=JSON.stringify(old),s=migrate(old);assert.equal(JSON.stringify(old),raw);assert.equal(s.holdings[0].decision,'hold');assert.equal(s.holdings[1].decision,'unset');assert.equal(s.holdings[1].legacyDecision,'保有継続かも');assert.equal(s.holdings[0].rationale,'旧根拠');assert.deepEqual(s.watchDecisions,{});assert.deepEqual(s.decisionHistory,[]);
 const values=new Map([[V3_KEY,raw]]);globalThis.localStorage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)};read();assert.equal(values.get(V3_KEY),raw);assert.equal(get().version,6);assert.ok(values.has(KEY));
 values.delete(KEY);globalThis.localStorage.setItem=()=>{throw Error('quota');};read();assert.ok(storageError);assert.equal(values.get(V3_KEY),raw);assert.ok(!values.has(KEY));
});
test('stock forms are selection only and watch list reflects the saved enum',()=>{
 const s=fresh();s.holdings=[holding()];s.watchDecisions.MU='wait_results';
 const held=portfolioView(s,'edit','2026-09','2026-09-09','MU'),watch=stocksView({},s,'watch','TSM');
 for(const html of [held,watch]){assert.match(html,/<select name="decision">/);assert.doesNotMatch(html,/<textarea/);}
 assert.match(stocksView({},s,'watch'),/決算待ち/);assert.match(stocksView({},s,'watch','MU'),/watch-decision-form/);
 assert.match(decisionSelect('held','hold'),/value="hold" selected/);
});

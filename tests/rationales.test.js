import test from 'node:test';
import assert from 'node:assert/strict';
import {RATIONALES,validTags,recordRationales,toggleRationale,rationaleDetail,rationaleFields} from '../assets/js/rationales.js';
import {fresh,validate,migrate,read,get,KEY,V4_KEY,storageError} from '../assets/js/state.js';
import {stocksView} from '../assets/js/views.js';
import {portfolioView} from '../assets/js/portfolio.js';
const h=()=>({ticker:'MU',quantity:10,cost:100,currency:'USD',decision:'hold'});
test('eight fixed tags, maximum five, rejects unknowns, duplicates and free text',()=>{
 const tags=Object.keys(RATIONALES),s=fresh();assert.equal(tags.length,8);assert.ok(validTags(tags.slice(0,5)));assert.ok(validTags([]));
 for(const bad of [tags.slice(0,6),['theme_growth','theme_growth'],['テーマ成長'],['constructor'],[null]]){assert.ok(!validTags(bad));assert.throws(()=>recordRationales(s,'MU',bad));}
 assert.throws(()=>recordRationales(s,'NVDAAAA',tags.slice(0,1)));assert.deepEqual(s.rationaleHistory,[]);
});
test('individual ON/OFF keeps accurate count, permits replacing a fifth tag, logs before/after',()=>{
 const s=fresh(),tags=Object.keys(RATIONALES);recordRationales(s,'MU',tags.slice(0,5),'2026-09-09T12:00:00.000Z','first');const first=structuredClone(s.rationaleHistory[0]);
 assert.match(rationaleDetail(s,'MU'),/維持中 5 \/ 5件/);assert.match(rationaleDetail(s,'MU'),/aria-pressed="false" disabled/);
 assert.throws(()=>toggleRationale(s,'MU',tags[5]));assert.equal(s.rationaleHistory.length,1);
 toggleRationale(s,'MU',tags[0]);assert.equal(s.rationales.MU.length,4);assert.deepEqual(s.rationaleHistory.at(-1).removed,[tags[0]]);
 toggleRationale(s,'MU',tags[5]);assert.equal(s.rationales.MU.length,5);assert.deepEqual(s.rationaleHistory[0],first);validate(s);
 recordRationales(s,'MU',[...s.rationales.MU].reverse());assert.equal(s.rationaleHistory.length,3);
 recordRationales(s,'MU',[]);assert.match(rationaleDetail(s,'MU'),/維持中 0 \/ 5件/);assert.equal(s.rationaleHistory.at(-1).removed.length,5);
});
test('history is an independent snapshot including source/version, context, listing and time',()=>{
 const s=fresh();s.holdings=[h()];s.securities.MU={id:'MU|NASDAQ',symbol:'MU',name:'Micron',exchange:'NASDAQ'};
 recordRationales(s,'MU',['theme_growth','earnings_growth'],'2026-09-09T12:00:00.000Z','first');
 const r=s.rationaleHistory[0];assert.deepEqual(r.contexts,['held','watch']);assert.equal(r.security_id,'MU|NASDAQ');assert.equal(r.source,'manual');assert.equal(r.enum_version,1);
 s.rationales.MU.pop();assert.equal(r.after.length,2);s.rationales.MU=[...r.after];validate(s);
 assert.deepEqual(migrate(JSON.parse(JSON.stringify(s))),s);
 const bad=structuredClone(s);bad.rationaleHistory[0].added=[];assert.throws(()=>validate(bad));
 const unknown=structuredClone(s);unknown.rationales.MU=['fake'];assert.throws(()=>migrate(unknown));
});
test('v4 migration preserves decisions/history and legacy thesis text without inventing active tags',()=>{
 const old={...fresh(),version:4,holdings:[{...h(),rationale:'技術が優位だと思う'}]};delete old.rationales;delete old.rationaleHistory;delete old.rationaleSchemaVersion;
 const raw=JSON.stringify(old),next=migrate(old);assert.equal(JSON.stringify(old),raw);assert.equal(next.holdings[0].rationale,'技術が優位だと思う');assert.equal(next.holdings[0].decision,'hold');assert.deepEqual(next.decisionHistory,old.decisionHistory);assert.deepEqual(next.rationales,{});assert.deepEqual(next.rationaleHistory,[]);
 const values=new Map([[V4_KEY,raw]]);globalThis.localStorage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)};read();assert.equal(get().version,5);assert.equal(values.get(V4_KEY),raw);assert.ok(values.has(KEY));
 values.delete(KEY);globalThis.localStorage.setItem=()=>{throw Error('quota');};read();assert.ok(storageError);assert.equal(values.get(V4_KEY),raw);assert.ok(!values.has(KEY));
});
test('holding form and registered stock detail expose tag controls without free prose',()=>{
 const s=fresh();s.holdings=[h()];recordRationales(s,'MU',['technology_edge','catalyst']);
 const form=portfolioView(s,'edit','2026-09','2026-09-09','MU'),detail=stocksView({},s,'held','MU');
 assert.equal((form.match(/name="rationaleTags"/g)||[]).length,8);assert.match(form,/value="technology_edge" checked/);assert.doesNotMatch(form,/<textarea/);
 assert.match(detail,/維持中 2 \/ 5件/);assert.equal((detail.match(/data-rationale-tag=/g)||[]).length,8);assert.match(detail,/変更履歴/);assert.doesNotMatch(detail,/<textarea/);
 assert.doesNotMatch(stocksView({},s,'all','NVDAAAA'),/data-rationale-tag/);
 assert.doesNotMatch(rationaleFields(),/<textarea/);
});

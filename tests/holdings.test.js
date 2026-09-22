import test from 'node:test';
import assert from 'node:assert/strict';
import {fresh,validate,migrate,KEY,read,commit,get,mutate} from '../assets/js/state.js';
import {aggregateHoldings,saveHolding,removeHolding,holdingKey} from '../assets/js/holdings.js';
import {recordDecision} from '../assets/js/decisions.js';
import {valueHoldings,holdingBasis,nextObservation,saveObservation} from '../assets/js/valuation.js';
import {holdingForm} from '../assets/js/holdings-ui.js';
import {valuationOverview} from '../assets/js/valuation-ui.js';
import {stocksView} from '../assets/js/views.js';
import {usageInput} from '../assets/js/usage.js';

const now=Date.parse('2026-09-22T04:00:00Z');
const input=(quantity,cost,broker='楽天証券',currency='USD')=>({ticker:'MU',quantity,cost,broker,currency});
const data={calendar:{value:{start:'2026-09-01',end:'2026-12-31',sessions:[{date:'2026-09-21',close:'2026-09-21T20:00:00Z'}]}},setups:{value:{stocks:{MU:{ticker:'MU',price:140,currency:'USD',as_of:'2026-09-21',quality:'ok'}}}},fx:{value:{pair:'USD/JPY',rate:150,as_of:'2026-09-21',quality:'ok'}}};
function pair(){const s=fresh();saveHolding(s,input(100,100));saveHolding(s,input(50,130,'moomoo証券'));return s;}

test('Rakuten and moomoo quantities and acquisition amounts are weighted once per symbol',()=>{
 const s=pair();validate(s);const before=JSON.stringify(s),v=valueHoldings(s,data,now),r=v.rows[0];
 assert.equal(s.holdings.length,2);assert.equal(r.quantity,150);assert.equal(r.cost,110);assert.equal(r.costBreakdown[0].totalCost,16500);
 assert.equal(v.rows.length,1);assert.equal(v.pricedCount,1);assert.equal(v.stockJpy,3150000);assert.equal(v.pnlJpy,675000);assert.equal(r.pnl,4500);
 assert.deepEqual(v.allocation,[{name:'MU',value:3150000}]);assert.equal(JSON.stringify(s),before);
 const fractional=aggregateHoldings([{...input(.25,100)},{...input(.75,200)}])[0];assert.equal(fractional.quantity,1);assert.equal(fractional.cost,175);
});
test('editing and removing target only one registration, including repeated registrations at one broker',()=>{
 const s=pair(),[a,b]=s.holdings,other=structuredClone(b);saveHolding(s,input(25,80),holdingKey(a));
 assert.deepEqual(s.holdings[1],other);assert.equal(aggregateHoldings(s.holdings)[0].cost,8500/75);
 saveHolding(s,input(5,90));assert.equal(s.holdings.length,3);validate(s);
 removeHolding(s,holdingKey(b));assert.equal(s.holdings.length,2);assert.equal(aggregateHoldings(s.holdings)[0].quantity,30);
 assert.throws(()=>removeHolding(s,holdingKey(b)),/見つかりません/);
 assert.throws(()=>saveHolding(s,{...input(1,100),ticker:'NVDA'},holdingKey(s.holdings[0])),/銘柄を変更できません/);
});
test('legacy v6 rows survive unchanged and naming the original brokerage preserves valuation history',()=>{
 const s=fresh();s.holdings=[{ticker:'MU',quantity:100,cost:100,currency:'USD',decision:'hold',legacyDecision:'保有継続'}];
 const original=structuredClone(s);assert.deepEqual(migrate(s),original);const basis=holdingBasis(s);
 saveObservation(s,nextObservation(s,data,now));saveHolding(s,input(100,100),holdingKey(s.holdings[0]));
 assert.equal(s.holdings[0].legacyDecision,'保有継続');assert.equal(holdingBasis(s),basis);assert.equal(nextObservation(s,data,now),null);
 saveHolding(s,input(50,130,'moomoo証券'));saveObservation(s,nextObservation(s,data,now));
 assert.equal(s.holdingObservations[0].basisChanged,true);validate(s);
 assert.equal(holdingBasis(s),holdingBasis({...s,holdings:[...s.holdings].reverse()}));
});
test('different acquisition currencies are kept distinct and FX is applied to each subtotal',()=>{
 const s=pair();s.holdings[1].currency='JPY';s.holdings[1].cost=18000;
 const r=valueHoldings(s,data,now).rows[0];assert.equal(r.cost,null);assert.equal(r.currency,null);assert.equal(r.pnl,null);
 assert.deepEqual(r.costBreakdown.map(c=>[c.currency,c.quantity,c.averageCost]),[['USD',100,100],['JPY',50,18000]]);
 assert.equal(r.costJpy,2400000);assert.equal(r.pnlJpy,750000);
 const missing=valueHoldings(s,{...data,fx:null},now);assert.equal(missing.rows[0].costJpy,null);assert.equal(missing.stockJpy,null);assert.equal(missing.native.USD,21000);
});
test('averages remain available without market quotes and duplicate symbols do not duplicate missing counts',()=>{
 const v=valueHoldings(pair(),{},now);assert.equal(v.rows[0].cost,110);assert.equal(v.rows.length,1);assert.equal(v.pricedCount,0);assert.equal(v.stockJpy,null);
});
test('portfolio presents one combined card and the original broker breakdown even without quotes',()=>{
 const s=pair(),html=valuationOverview(s,{});
 assert.equal((html.match(/data-holding="MU"/g)||[]).length,1);assert.match(html,/150株/);assert.match(html,/data-average-cost="MU"><span>\$110<\/span>/);
 assert.match(html,/楽天証券/);assert.match(html,/moomoo証券/);assert.match(html,/証券会社別の内訳（2件）/);
 s.holdings[1].currency='JPY';const mixed=valuationOverview(s,{});assert.match(mixed,/平均取得単価は通貨別/);assert.match(mixed,/\$100/);assert.match(mixed,/¥130/);
});
test('decisions, held stock cards and usage snapshots stay at symbol level',()=>{
 const s=pair();recordDecision(s,'held','MU','hold');assert.ok(s.holdings.every(h=>h.decision==='hold'));assert.equal(s.decisionHistory.length,1);
 recordDecision(s,'held','MU','hold');assert.equal(s.decisionHistory.length,1);validate(s);
 s.watch=[];const u=usageInput(s,{themes:{value:{themes:[]}}},'2026-09-22T04:00:00Z');assert.equal(u.decisions.length,1);
 const html=stocksView({},s,'held');assert.equal((html.match(/data-stock-ticker="MU"/g)||[]).length,1);
});
test('backups preserve all registrations and failed writes never replace the active data',()=>{
 const s=pair(),storage=new Map([[KEY,JSON.stringify(s)]]);globalThis.localStorage={getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v)};
 read();assert.deepEqual(get(),s);assert.deepEqual(migrate(JSON.parse(JSON.stringify(s))),s);
 const next=structuredClone(get());removeHolding(next,holdingKey(next.holdings[0]));commit(next);read();assert.equal(get().holdings.length,1);
 globalThis.localStorage.setItem=()=>{throw Error('full');};assert.throws(()=>mutate(s=>saveHolding(s,input(1,1))),/保存できません/);assert.deepEqual(get(),next);
});
test('ambiguous legacy duplicates, duplicate IDs, invalid quantities and overflow are rejected',()=>{
 const s=pair();for(const alter of [x=>x.holdings[1].id=x.holdings[0].id,x=>x.holdings.forEach(h=>delete h.id),x=>x.holdings[0].quantity=0,x=>x.holdings[0].cost=-1,x=>x.holdings[0].broker='a'.repeat(61),x=>x.holdings[0].quantity=1e308,x=>x.holdings[0].decision='hold']){const copy=structuredClone(s);alter(copy);assert.throws(()=>validate(copy));}
 for(const [q,c] of [[0,1],[-1,1],[1,-1],[NaN,1],[1,Infinity]])assert.throws(()=>saveHolding(fresh(),input(q,c)));
 assert.throws(()=>saveHolding(s,input(1,1),'position:missing'),/見つかりません/);
});
test('adding preselects the symbol without copying the existing shares; editing selects the exact row',()=>{
 const s=pair();s.securities.MU={id:'MU|NASDAQ',symbol:'MU',name:'Micron',exchange:'NASDAQ'};
 const add=holdingForm(s,'','MU');assert.match(add,/name="quantity"[^>]*value=""/);assert.match(add,/name="ticker"[^>]*value="MU"/);
 const edit=holdingForm(s,holdingKey(s.holdings[1]));assert.match(edit,/value="moomoo証券"/);assert.match(edit,/name="quantity"[^>]*value="50"/);
 s.holdings[1].broker='<script>alert(1)</script>';assert.ok(!holdingForm(s,holdingKey(s.holdings[1])).includes('<script>'));
});

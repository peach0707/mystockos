import test from 'node:test';
import assert from 'node:assert/strict';
import {fresh,validate,migrate,commit,read,get,KEY} from '../assets/js/state.js';
import {valueHoldings,nextObservation,saveObservation,observationResult,fxQuote} from '../assets/js/valuation.js';
import {portfolioView} from '../assets/js/portfolio.js';
import {setupFor} from '../assets/js/setups.js';
import {valid} from '../assets/js/data.js';

const now=Date.parse('2026-09-22T04:00:00Z');
const later=Date.parse('2026-09-23T04:00:00Z');
function fixture(){
 const s=fresh();
 s.holdings=[['MU',2,80],['SKHY',1,100],['MUU',4,20]].map(([ticker,quantity,cost])=>({ticker,quantity,cost,currency:'USD',decision:'hold'}));
 const data={calendar:{value:{start:'2026-09-01',end:'2026-12-31',sessions:[{date:'2026-09-18',close:'2026-09-18T20:00:00Z'},{date:'2026-09-21',close:'2026-09-21T20:00:00Z'},{date:'2026-09-22',close:'2026-09-22T20:00:00Z'}]}},
  setups:{value:{stocks:Object.fromEntries([['MU',100],['SKHY',150],['MUU',30]].map(([ticker,price])=>[ticker,{ticker,price,currency:'USD',exchange:'NASDAQ',as_of:'2026-09-21',quality:'ok',analysis_ready:false,history_sessions:10}]))}},
  fx:{value:{schema_version:1,pair:'USD/JPY',rate:150,as_of:'2026-09-21',quality:'ok',basis:'completed_UTC_daily_close',source:'fixture'}}};
 return {s,data};
}
test('registered short-history ADR and leveraged ETF use their own real quotes for automatic value',()=>{
 const {s,data}=fixture(),before=JSON.stringify([s,data]),v=valueHoldings(s,data,now);
 assert.equal(v.stockJpy,70500);assert.equal(v.pricedCount,3);assert.equal(v.pnlJpy,19500);assert.equal(v.complete,true);assert.equal(v.fresh,true);
 assert.equal(v.rows.find(r=>r.ticker==='MUU').value,120,'never derive leveraged ETF price from underlying');
 assert.equal(v.assetsJpy,null,'unknown cash is not zero');
 assert.equal(setupFor(data,'SKHY',now).ready,false);assert.match(setupFor(data,'SKHY',now).reason,/履歴が10営業日/);
 assert.equal(JSON.stringify([s,data]),before);
});
test('cash balances are included once, no cash-flow or dividend double count',()=>{
 const {s,data}=fixture();s.cashBalance={JPY:1000,USD:10,updatedAt:'2026-09-22'};
 s.cashFlows=[{amount_jpy:999999}];s.dividends=[{net_amount:9999,fx:150,status:'paid'}];
 const v=valueHoldings(s,data,now);assert.equal(v.cashJpy,2500);assert.equal(v.assetsJpy,73000);
 s.holdings=[];assert.equal(valueHoldings(s,data,now).assetsJpy,2500);assert.equal(nextObservation(s,data,now),null);
});
test('JPY acquisition cost does not multiply a USD quote as though it were JPY',()=>{
 const {s,data}=fixture();s.holdings=[{ticker:'MU',quantity:2,cost:11000,currency:'JPY',decision:'hold'}];
 const r=valueHoldings(s,data,now).rows[0];assert.equal(r.value,200);assert.equal(r.valueJpy,30000);assert.equal(r.costJpy,22000);assert.equal(r.pnlJpy,8000);assert.equal(r.pnl,null);
});
test('missing one price keeps the known subtotal without pretending it is the total',()=>{
 const {s,data}=fixture();delete data.setups.value.stocks.SKHY;
 const v=valueHoldings(s,data,now);assert.equal(v.pricedCount,2);assert.equal(v.stockJpy,null);assert.equal(v.subtotalJpy,48000);assert.equal(v.rows[1].value,null);assert.equal(v.pnlJpy,null);assert.equal(nextObservation(s,data,now),null);
});
test('missing or inverse FX retains native values but never uses an assumed rate',()=>{
 for(const pair of [null,'JPY/USD']){const {s,data}=fixture();if(pair)data.fx.value.pair=pair;else delete data.fx;
  const v=valueHoldings(s,data,now);assert.equal(v.stockJpy,null);assert.equal(v.native.USD,470);assert.equal(v.rows[0].pnl,40);assert.equal(nextObservation(s,data,now),null);}
});
test('stale prices and cached FX remain visibly estimated and cannot create a fresh observation',()=>{
 for(const change of [d=>d.setups.value.stocks.SKHY.as_of='2026-09-18',d=>d.setups.cached=true,d=>d.fx.cached=true,d=>d.fx.value.quality='stale']){
  const {s,data}=fixture();change(data);const v=valueHoldings(s,data,now);assert.equal(v.stockJpy,70500);assert.equal(v.fresh,false);assert.equal(nextObservation(s,data,now),null);
 }
});
test('future or unfinished prices are not used for a closing valuation',()=>{
 const {s,data}=fixture();data.setups.value.stocks.SKHY.as_of='2026-09-22';
 assert.equal(valueHoldings(s,data,now).rows[1].value,null);
 data.fx.value.as_of='2026-09-22';assert.equal(fxQuote(data,now),null);
});
test('first observation is dated when seen in Japan, never backfills the quote date',()=>{
 const {s,data}=fixture(),row=nextObservation(s,data,now);saveObservation(s,row);
 assert.equal(row.date,'2026-09-22');assert.equal(row.priceDate,'2026-09-21');assert.equal(s.holdingObservations.length,1);
 assert.equal(s.snapshots.length,0);assert.equal(observationResult(s,row.date).change,null);assert.equal(nextObservation(s,data,now),null);
 assert.equal(nextObservation(s,data,Date.parse('2026-09-22T05:00:00Z')),null);
 validate(s);assert.deepEqual(migrate(s),s);
});
test('next completed observation compares the same holdings including currency valuation',()=>{
 const {s,data}=fixture();saveObservation(s,nextObservation(s,data,now));
 for(const r of Object.values(data.setups.value.stocks))r.as_of='2026-09-22';data.setups.value.stocks.MU.price=110;
 data.fx.value.as_of='2026-09-22';saveObservation(s,nextObservation(s,data,later));
 const result=observationResult(s,'2026-09-23');assert.equal(result.change,3000);assert.equal(result.previous.date,'2026-09-22');assert.equal(s.snapshots.length,0);validate(s);
});
test('a quantity or acquisition-cost change restarts comparison rather than fabricating profit',()=>{
 const {s,data}=fixture();saveObservation(s,nextObservation(s,data,now));s.holdings[0].quantity=10;
 saveObservation(s,nextObservation(s,data,now));assert.equal(s.holdingObservations[0].basisChanged,true);
 for(const r of Object.values(data.setups.value.stocks))r.as_of='2026-09-22';data.fx.value.as_of='2026-09-22';s.holdings[0].quantity=20;
 saveObservation(s,nextObservation(s,data,later));assert.equal(observationResult(s,'2026-09-23').change,null);validate(s);
});
test('same prices on a weekend are not new zero-return observations',()=>{
 const {s,data}=fixture();saveObservation(s,nextObservation(s,data,now));
 assert.equal(nextObservation(s,data,now+3600000),null);assert.equal(observationResult(s,'2026-09-21').current,null);
});
test('optional fields preserve existing version 6 data and backup identity',()=>{
 const {s,data}=fixture();const original=structuredClone(s);validate(s);assert.deepEqual(migrate(s),original);
 const storage=new Map([[KEY,JSON.stringify(s)]]);globalThis.localStorage={getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v)};
 read();const next=structuredClone(get());saveObservation(next,nextObservation(next,data,now));commit(next);read();
 assert.deepEqual(get().holdings,original.holdings);assert.equal(get().holdingObservations.length,1);assert.equal(get().snapshots.length,0);
});
test('malformed cash and history imports cannot corrupt existing records',()=>{
 const {s,data}=fixture();saveObservation(s,nextObservation(s,data,now));
 for(const alter of [x=>x.cashBalance={JPY:-1,USD:0,updatedAt:'2026-09-22'},x=>x.holdingObservations[0].assetsJpy=Infinity,x=>x.holdingObservations[0].date='2026-09-21',x=>x.holdingObservations.push(x.holdingObservations[0])]){
  const copy=structuredClone(s);alter(copy);assert.throws(()=>validate(copy));
 }
});
test('portfolio renders valuation and edit controls without mutating holdings; manual calendar remains separate',()=>{
 const {s,data}=fixture(),realNow=Date.now;Date.now=()=>now;
 try{
  const before=JSON.stringify(s),html=portfolioView(s,'','2026-09','2026-09-22','','',data);
  assert.match(html,/¥70,500/);assert.match(html,/data-holding="SKHY"/);assert.match(html,/data-holding="MUU"/);assert.match(html,/現金は未登録/);assert.match(html,/href="#portfolio\/entry"/);
  assert.equal(JSON.stringify(s),before);
 }finally{Date.now=realNow;}
});
test('FX public schema rejects inverse, non-positive and malformed values',()=>{
 const {data}=fixture();assert.equal(valid('fx',data.fx.value),true);
 for(const change of [{pair:'JPY/USD'},{rate:0},{rate:NaN},{basis:'intraday'},{as_of:'2026-02-30'}])assert.equal(valid('fx',{...data.fx.value,...change}),false);
});

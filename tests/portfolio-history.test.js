import test from 'node:test';
import assert from 'node:assert/strict';
import {fresh,validate,migrate,read,mutate,get,KEY} from '../assets/js/state.js';
import {portfolioBasis,reconcileHistory,historyRows,dailyResult,historyDayState,captureHoldingChange,validArchive} from '../assets/js/portfolio-history.js';

const now=Date.parse('2026-10-02T04:00:00Z');
const sessions=['2026-09-21','2026-09-22','2026-09-23','2026-09-24','2026-09-25','2026-09-28','2026-09-29','2026-09-30','2026-10-01','2026-10-02'];
function fixture(){
 const s=fresh();s.holdings=[{ticker:'MU',quantity:2,cost:80,currency:'USD',decision:'hold'},{ticker:'MU',quantity:3,cost:90,currency:'USD',decision:'hold',id:'b',broker:'楽天証券'}];
 const basis=portfolioBasis(s);
 s.holdingObservations=[{date:'2026-09-22',priceDate:'2026-09-21',assetsJpy:75000,fxDate:'2026-09-21',fxRate:150,basis,basisChanged:false,sourceKey:'test',observedAt:'2026-09-22T04:00:00Z'}];
 const archive={schema_version:1,price_basis:'as_reported_daily_close',as_of:'2026-10-01',stocks:{MU:{currency:'USD',history:sessions.slice(0,-1).map((date,i)=>({date,close:100+i}))}},fx:{pair:'USD/JPY',basis:'completed_UTC_daily_close',history:sessions.slice(0,-1).map((date,i)=>({date,rate:150+i}))}};
 const data={archive:{value:archive},calendar:{value:{schema_version:1,start:'2026-09-01',end:'2026-12-31',sessions:sessions.map(date=>({date,close:date+'T20:00:00Z'}))}}};return {s,data};
}
test('ten days without opening backfill every closed session with its own price and FX',()=>{
 const {s,data}=fixture(),original=JSON.stringify([s.holdings,s.holdingObservations,s.snapshots,s.dividends,s.cashFlows]);
 assert.equal(reconcileHistory(s,data,now),true);assert.equal(historyRows(s).length,9);
 assert.equal(historyRows(s).at(-1).assetsJpy,5*108*158);assert.equal(historyRows(s)[0].date,'2026-09-21');
 assert.equal(dailyResult(s,'2026-10-01',data).change,5*108*158-5*107*157);
 assert.equal(JSON.stringify([s.holdings,s.holdingObservations,s.snapshots,s.dividends,s.cashFlows]),original);
 assert.equal(reconcileHistory(s,data,now+1000),false);validate(s);assert.deepEqual(migrate(s),s);
});
test('weekends and holidays are not zero-profit days; display follows US trading date, preserving Japan ownership dates',()=>{
 const {s,data}=fixture();reconcileHistory(s,data,now);
 assert.equal(historyRows(s).some(r=>r.date==='2026-09-25'),true);
 assert.equal(historyDayState(s,'2026-09-27',data,now).kind,'closed');
 assert.equal(historyDayState(s,'2026-10-03',data,now).kind,'future');
 assert.equal(historyDayState(s,'2026-09-20',data,now).kind,'unregistered');
 assert.equal(dailyResult(s,'2026-09-28',data).previous.date,'2026-09-25');
});
test('missing price or FX is not zero and never bridges a gap as a daily return',()=>{
 for(const type of ['price','fx']){
  const {s,data}=fixture();const rows=type==='price'?data.archive.value.stocks.MU.history:data.archive.value.fx.history;
  rows.splice(7,1);reconcileHistory(s,data,now);
  assert.equal(historyDayState(s,'2026-09-30',data,now).kind,'missing');
  assert.equal(dailyResult(s,'2026-10-01',data).change,null);
 }
});
test('offline startup and collector outage never erase previously computed daily history',()=>{
 const {s,data}=fixture();reconcileHistory(s,data,now);const before=JSON.stringify(s);
 reconcileHistory(s,{},now);assert.equal(JSON.stringify(s),before);
 data.archive.value.stocks={};reconcileHistory(s,data,now);assert.equal(JSON.stringify(s),before);
});
test('quantity edits begin a new period and never overwrite previous days with today’s shares',()=>{
 const {s,data}=fixture();reconcileHistory(s,data,now);
 const next=structuredClone(s);next.holdings[0].quantity=20;captureHoldingChange(s,next,now);reconcileHistory(next,data,now);
 assert.equal(historyRows(next).at(-2).assetsJpy,5*107*157);assert.equal(historyRows(next).at(-1).assetsJpy,23*108*158);
 assert.equal(dailyResult(next,'2026-10-01',data).change,null);validate(next);
});
test('calendar rollover never erases previously verified history',()=>{
 const {s,data}=fixture();reconcileHistory(s,data,now);const before=JSON.stringify(s.holdingDailyHistory);
 data.calendar.value.sessions=data.calendar.value.sessions.slice(-3);data.calendar.value.start='2026-09-30';
 reconcileHistory(s,data,now);assert.equal(JSON.stringify(s.holdingDailyHistory),before);validate(s);
 s.holdingDailyHistory=[];assert.equal(historyDayState(s,'2026-09-27',data,now).kind,'missing');
});
test('unknown legacy holding-change dates stay empty instead of inventing historic ownership',()=>{
 const {s,data}=fixture();s.holdings[0].quantity=20;
 s.holdingObservations.push({...s.holdingObservations[0],date:'2026-09-29',priceDate:'2026-09-28',observedAt:'2026-09-29T04:00:00Z',basis:portfolioBasis(s)});
 reconcileHistory(s,data,now);assert.equal(historyRows(s).length,5);
 assert.equal(historyDayState(s,'2026-09-25',data,now).kind,'unregistered');validate(s);
});
test('new registrations never fabricate pre-registration history',()=>{
 const {s,data}=fixture();delete s.holdingObservations;reconcileHistory(s,data,now);
 assert.equal(historyRows(s).length,1);assert.equal(historyRows(s)[0].date,'2026-10-01');
});
test('sell all and later re-enter leaves the unowned period empty',()=>{
 const {s,data}=fixture();reconcileHistory(s,data,Date.parse('2026-09-23T04:00:00Z'));
 const empty=structuredClone(s);empty.holdings=[];captureHoldingChange(s,empty,Date.parse('2026-09-24T04:00:00Z'));
 const again=structuredClone(empty);again.holdings=structuredClone(s.holdings);captureHoldingChange(empty,again,now);reconcileHistory(again,data,now);
 assert.equal(historyRows(again).length,3);assert.equal(dailyResult(again,'2026-10-01',data).change,null);validate(again);
});
test('durable archive schema rejects duplicates, inverse FX, negative and fabricated closes',()=>{
 const {data}=fixture();assert.equal(validArchive(data.archive.value),true);
 for(const alter of [a=>a.fx.pair='JPY/USD',a=>a.stocks.MU.history[0].close=0,a=>a.stocks.MU.history.push(a.stocks.MU.history[0]),a=>a.price_basis='split_adjusted']){const a=structuredClone(data.archive.value);alter(a);assert.equal(validArchive(a),false);}
});
test('malformed imported daily history is rejected before persistence',()=>{
 const {s,data}=fixture();reconcileHistory(s,data,now);
 for(const alter of [x=>x.holdingPeriods[0].basis='{}',x=>x.holdingPeriods.push(x.holdingPeriods[0]),x=>x.holdingDailyHistory[0].assetsJpy=Infinity,x=>x.holdingDailyHistory[0].parts[0].valueJpy=0]){const next=structuredClone(s);alter(next);assert.throws(()=>validate(next));}
});
test('all ordinary holding mutations retain period history without changing storage version',()=>{
 const {s,data}=fixture();reconcileHistory(s,data,now);
 const store=new Map([[KEY,JSON.stringify(s)]]);globalThis.localStorage={getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v)};
 const clock=Date.now;Date.now=()=>now;
 try{read();mutate(x=>x.holdings[0].quantity=10);assert.equal(get().holdingPeriods.length,2);assert.equal(get().version,6);read();assert.equal(get().holdings[0].quantity,10);}finally{Date.now=clock;}
});
test('Thursday and Friday keep their US dates, amounts, ownership and FX pairing',()=>{
 const {s,data}=fixture(),later=Date.parse('2026-10-03T10:00:00Z');
 data.archive.value.stocks.MU.history.push({date:'2026-10-02',close:104});
 data.archive.value.fx.history.push({date:'2026-10-02',rate:160});
 reconcileHistory(s,data,later);
 const stored=JSON.stringify(s.holdingDailyHistory),thu=dailyResult(s,'2026-10-01',data),fri=dailyResult(s,'2026-10-02',data);
 assert.equal(thu.current.priceDate,'2026-10-01');assert.equal(thu.change,5*108*158-5*107*157);
 assert.equal(fri.current.priceDate,'2026-10-02');assert.equal(fri.change,5*104*160-5*108*158);
 assert.equal(fri.current.recordDate,'2026-10-03');assert.equal(fri.current.fxDate,'2026-10-02');
 assert.equal(historyDayState(s,'2026-10-03',data,later).kind,'closed');
 assert.equal(JSON.stringify(s.holdingDailyHistory),stored);validate(s);
 const beforeFX=fixture();beforeFX.data.archive.value.stocks.MU.history.push({date:'2026-10-02',close:104});reconcileHistory(beforeFX.s,beforeFX.data,later);
 assert.equal(historyDayState(beforeFX.s,'2026-10-02',beforeFX.data,later).label,'為替待ち');
 assert.equal(dailyResult(beforeFX.s,'2026-10-02',beforeFX.data).change,null);
});

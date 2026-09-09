import test from 'node:test';
import assert from 'node:assert/strict';
import {fresh,validate,migrate,read,commit,get,KEY,LEGACY_KEY,storageError} from '../assets/js/state.js';
import {ordered,dayResult,yearResult,snapshotsCSV,cashFlowsCSV} from '../assets/js/accounting.js';
import {portfolioView} from '../assets/js/portfolio.js';
const snap=(date,assets_jpy,status='recorded',timestamp=null)=>({date,timestamp,assets_jpy,valuation_basis:'manual, same FX',status,components:{price:null,fx:null,realized:null,other:null},stockContributions:[],themeContributions:[],allocation:[]});
const flow=(id,date,amount_jpy,timestamp=null)=>({id,date,timestamp,amount_jpy,type:amount_jpy>0?'deposit':'withdrawal',note:'test'});
const setup=()=>({...fresh(),snapshots:[snap('2026-09-11',50000000),snap('2026-09-14',51000000)]});
const memory=()=>{const values=new Map();globalThis.localStorage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)};return values;};

test('Friday to Monday without weekend valuations earns +1 million',()=>{const s=setup();validate(s);const r=dayResult(s,'2026-09-14');assert.equal(r.pnl,1000000);assert.equal(r.rate,2);assert.equal(r.previous.date,'2026-09-11');assert.match(portfolioView(s,'day','2026-09','2026-09-14',''),/2026-09-11 → 2026-09-14/);});
test('weekend deposit is subtracted; Monday evaluation need not own a flow',()=>{const s=setup();s.cashFlows=[flow('d','2026-09-12',1000000)];assert.equal(dayResult(s,'2026-09-14').pnl,0);assert.equal(dayResult(s,'2026-09-14').netFlow,1000000);assert.equal(dayResult(s,'2026-09-14').rate,null);});
test('multiple deposits and withdrawals aggregate over holiday gaps',()=>{const s=setup();s.cashFlows=[flow('a','2026-09-12',2000000),flow('b','2026-09-13',-1000000),flow('c','2026-09-15',999)];assert.equal(dayResult(s,'2026-09-14').pnl,0);s.cashFlows.push(flow('old','2026-09-11',999));assert.equal(dayResult(s,'2026-09-14').netFlow,1000000);});
test('offsetting gross cash movements do not yield an invented investment rate',()=>{const s=setup();s.cashFlows=[flow('a','2026-09-12',100),flow('b','2026-09-13',-100)];const d=dayResult(s,'2026-09-14');assert.equal(d.pnl,1000000);assert.equal(d.netFlow,0);assert.equal(d.rate,null);});
test('invalid and pending snapshots are skipped as comparison bases',()=>{const s=setup();s.snapshots.push(snap('2026-09-12',0,'invalid'),snap('2026-09-13',0,'pending'));assert.equal(ordered(s).length,2);assert.equal(dayResult(s,'2026-09-14').pnl,1000000);assert.equal(dayResult(s,'2026-09-12').pnl,null);assert.match(dayResult(s,'2026-09-12').reason,/データ不足/);});
test('incomplete flow ledger blocks daily and YTD performance',()=>{const s=setup();s.snapshots.unshift(snap('2025-12-31',40000000));s.cashFlowQuality.status='incomplete';assert.equal(dayResult(s,'2026-09-14').pnl,null);assert.equal(yearResult(s,2026).pnl,null);assert.match(yearResult(s,2026).reason,/データ不足/);});
test('YTD needs only annual baseline and latest valid valuation plus flows',()=>{const s=setup();s.snapshots.unshift(snap('2025-12-31',40000000));s.cashFlows=[flow('a','2026-01-15',1000000),flow('b','2026-09-12',2000000),flow('c','2026-09-13',-1000000)];const y=yearResult(s,2026);assert.equal(y.assetChange,11000000);assert.equal(y.netFlow,2000000);assert.equal(y.pnl,9000000);assert.equal(y.complete,true);});
test('explicit year-end trading-day baseline; missing baseline stays insufficient',()=>{const s=setup();assert.equal(yearResult(s,2026).pnl,null);s.snapshots.unshift(snap('2025-12-30',40000000));s.yearBaselines['2026']='2025-12-30';validate(s);assert.equal(yearResult(s,2026).pnl,11000000);s.yearBaselines['2026']='2026-09-11';assert.throws(()=>validate(s));});
test('timestamp intervals use exclusive start and inclusive end',()=>{const s=setup();s.snapshots[0].timestamp='2026-09-11T15:00:00+09:00';s.snapshots[1].timestamp='2026-09-14T15:00:00+09:00';s.cashFlows=[flow('at-start','2026-09-11',999,'2026-09-11T15:00:00+09:00'),flow('at-end','2026-09-14',1000000,'2026-09-14T15:00:00+09:00'),flow('after','2026-09-14',999,'2026-09-14T16:00:00+09:00')];validate(s);assert.equal(dayResult(s,'2026-09-14').pnl,0);});
test('date-only flow at intraday boundary asks for timestamp instead of guessing',()=>{const s=setup();s.snapshots[1].timestamp='2026-09-14T15:00:00+09:00';s.cashFlows=[flow('d','2026-09-14',1000000)];assert.equal(dayResult(s,'2026-09-14').pnl,null);assert.match(dayResult(s,'2026-09-14').reason,/時刻/);});
test('paid dividend uses payment date and FX, never subtracts tax twice',()=>{const s=setup();s.dividends=[{id:'d',ticker:'MU',payment_date:'2026-09-12',timestamp:null,net_amount:10,currency:'USD',fx:150,status:'paid',tax_information:{withheld:3,note:'already withheld'}},{id:'p',ticker:'MU',payment_date:'2026-09-13',timestamp:null,net_amount:20,currency:'USD',fx:150,status:'pending',tax_information:{withheld:null,note:''}}];validate(s);const d=dayResult(s,'2026-09-14');assert.equal(d.pnl,1000000);assert.equal(d.dividend,1500);assert.equal(d.residual,998500);});
test('v2 migration preserves source, moves flows once and marks unverified history',()=>{const s=fresh();const old={...s,version:2,snapshots:[{...snap('2026-09-11',50000000),assets:50000000,basis:'legacy',netFlow:1000000}],dividends:[{id:'d',ticker:'MU',date:'2026-09-11',net:10,currency:'JPY',fx:1,status:'paid'}]};const raw=JSON.stringify(old),m=migrate(old);assert.equal(JSON.stringify(old),raw);assert.equal(m.snapshots[0].assets_jpy,50000000);assert.ok(!('netFlow'in m.snapshots[0]));assert.equal(m.cashFlows[0].amount_jpy,1000000);assert.equal(m.dividends[0].payment_date,'2026-09-11');assert.equal(m.cashFlowQuality.status,'incomplete');assert.deepEqual(migrate(m),m);const values=memory();values.set(LEGACY_KEY,raw);read();read();assert.equal(values.get(LEGACY_KEY),raw);assert.equal(get().cashFlows.length,1);});
test('migration or quota failure never overwrites valid original data',()=>{const values=memory();const raw=JSON.stringify({version:2,snapshots:[],dividends:[]});values.set(LEGACY_KEY,raw);read();assert.ok(storageError);assert.equal(values.get(LEGACY_KEY),raw);assert.equal(values.has(KEY),false);values.clear();read();commit(fresh());const good=values.get(KEY);globalThis.localStorage.setItem=()=>{throw Error('quota');};assert.throws(()=>commit({...fresh(),policy:'lost'}));assert.equal(values.get(KEY),good);assert.equal(get().policy,'');memory();read();});
test('independent CSV formats, invalid dates, duplicate IDs and signs validated',()=>{const s=fresh();s.snapshots=snapshotsCSV('date,timestamp,assets_jpy,valuation_basis,status\r\n2026-09-11,,50000000,"NY close, same FX",recorded\r\n');s.cashFlows=cashFlowsCSV('id,date,timestamp,amount_jpy,type,note\na,2026-09-12,,1000000,deposit,weekend');validate(s);s.cashFlows.push({...s.cashFlows[0]});assert.throws(()=>validate(s));s.cashFlows.pop();s.cashFlows[0].type='withdrawal';assert.throws(()=>validate(s));s.cashFlows=[];s.snapshots[0].date='2026-02-30';assert.throws(()=>validate(s));});
test('editing historical flows recomputes subsequent and YTD results',()=>{const s=setup();s.snapshots.unshift(snap('2025-12-31',40000000));s.cashFlows=[flow('a','2026-09-12',1000000)];assert.equal(dayResult(s,'2026-09-14').pnl,0);s.cashFlows[0].amount_jpy=500000;assert.equal(dayResult(s,'2026-09-14').pnl,500000);assert.equal(yearResult(s,2026).pnl,10500000);});
test('new ledger, annual baseline and tax forms render without personal sample data',()=>{const s=fresh();for(const page of ['flows','year','entry','dividends'])assert.ok(portfolioView(s,page,'2026-09','2026-09-14',''));assert.ok(!portfolioView(s,'entry','2026-09','2026-09-14','').includes('name="netFlow"'));assert.ok(portfolioView(s,'flows','2026-09','2026-09-14','').includes('flow-quality-form'));});

test('Case 3: explicitly closed holiday between valid valuations is not required',()=>{
 const s=fresh();s.snapshots=[snap('2026-09-04',50000000),snap('2026-09-08',49820000)];
 // Sept 7 is the supplied closed-session fixture; no market calendar lookup needed by accounting.
 const r=dayResult(s,'2026-09-08');assert.equal(r.previous.date,'2026-09-04');assert.equal(r.pnl,-180000);
 assert.equal(dayResult(s,'2026-09-07'),null);
});
test('calendar weekends without evaluation show dash, not a zero-return day',()=>{
 const s=setup(),html=portfolioView(s,'calendar','2026-09','2026-09-12','');
 for(const date of ['2026-09-12','2026-09-13']){
  const cell=html.match(new RegExp(`data-date="${date}"[^>]*>([\\s\\S]*?)</button>`))[1];
  assert.match(cell,/>—<\/b>/);assert.doesNotMatch(cell,/>0(?:%|円)?</);assert.match(cell,/評価なし/);
 }
});
test('Case 6: cash dividend appears on actual payment date even without a valuation',()=>{
 const s=setup();s.dividends=[{id:'d',ticker:'MU',payment_date:'2026-09-12',timestamp:null,net_amount:10,currency:'USD',fx:150,status:'paid',tax_information:{withheld:3,note:''}}];
 const saturday=portfolioView(s,'day','2026-09','2026-09-12','');
 assert.match(saturday,/MU · 2026-09-12 · ¥1,500/);assert.match(saturday,/総運用損益<\/h3><p[^>]*>データ不足/);
 const monday=portfolioView(s,'day','2026-09','2026-09-14','');
 assert.match(monday,/配当（比較期間内の入金分）<\/dt><dd>¥1,500/);
 assert.match(monday,/この日の入金記録なし/);assert.equal(dayResult(s,'2026-09-14').pnl,1000000);
 assert.equal(ordered(s).at(-1).assets,51000000);
});
test('all requested details render and missing components stay unclassified',()=>{
 const s=setup(),html=portfolioView(s,'day','2026-09','2026-09-14','');
 for(const label of ['総運用損益','期間損益率','株価要因','為替要因','配当','実現損益','その他','未分類差額','銘柄別寄与','テーマ別寄与'])assert.ok(html.includes(label),label);
 assert.match(html,/株価要因<\/dt><dd>未分類/);assert.match(html,/未分類差額<\/dt><dd>¥1,000,000/);
});
test('future ex-date metadata is retained without introducing accrual or total-return double count',()=>{
 const s=setup();s.dividends=[{id:'d',ticker:'MU',payment_date:'2026-09-12',timestamp:null,ex_date:'2026-08-28',record_date:'2026-08-31',corporate_action_id:'issuer-event-1',net_amount:10,currency:'USD',fx:150,status:'paid',tax_information:{withheld:3,note:''}}];
 validate(s);assert.equal(migrate(s).dividends[0].ex_date,'2026-08-28');assert.equal(dayResult(s,'2026-09-14').pnl,1000000);
 s.dividends[0].ex_date='bad';assert.throws(()=>validate(s));
});
test('explicit closed-day valuation is not displayed as a zero-return trading day',()=>{
 const s=setup();s.snapshots.push(snap('2026-09-12',50000000,'closed'));
 const html=portfolioView(s,'calendar','2026-09','2026-09-12','');
 const cell=html.match(/data-date="2026-09-12"[^>]*>([\s\S]*?)<\/button>/)[1];
 assert.match(cell,/>—<\/b>/);assert.match(cell,/休場記録/);assert.doesNotMatch(cell,/>0%?</);
 assert.equal(dayResult(s,'2026-09-14').pnl,1000000);
});

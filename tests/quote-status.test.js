import test from 'node:test';
import assert from 'node:assert/strict';
import {quoteStatus,holdingQuoteNotice,validateQuoteConsent,updateHoldingQuoteNotice} from '../assets/js/quote-status.js';
import {setQuoteCoverage,quoteCoverageLabel} from '../assets/js/symbols.js';
import {valueHoldings} from '../assets/js/valuation.js';
import {valuationOverview} from '../assets/js/valuation-ui.js';
import {fresh} from '../assets/js/state.js';

const now=Date.parse('2026-09-22T04:00:00Z');
const calendar={start:'2026-09-01',end:'2026-12-31',sessions:[{date:'2026-09-18',close:'2026-09-18T20:00:00Z'},{date:'2026-09-21',close:'2026-09-21T20:00:00Z'}]};
const quote={ticker:'SNDU',as_of:'2026-09-21',price:12.5,currency:'USD',quality:'ok',analysis_ready:false,history_sessions:2};
const fixture=()=>({setups:{value:{stocks:{SNDU:{...quote}}}},calendar:{value:calendar},fx:{value:{pair:'USD/JPY',as_of:'2026-09-21',rate:150,quality:'ok'}}});
test('registration distinguishes missing coverage, pending, fresh, cached, stale and unclosed prices',()=>{
 const data=fixture();assert.equal(quoteStatus(data,'SNDU',now).code,'current');
 assert.equal(quoteStatus(data,'UNLISTED',now).code,'unsupported');
 assert.equal(quoteStatus({},'SNDU',now).code,'checking');
 data.setups.cached=true;assert.equal(quoteStatus(data,'SNDU',now).code,'stale');
 data.setups.cached=false;data.setups.value.stocks.SNDU.as_of='2026-09-18';assert.equal(quoteStatus(data,'SNDU',now).code,'stale');
 data.setups.value.stocks.SNDU.as_of='2026-09-22';assert.equal(quoteStatus(data,'SNDU',now).usable,false);
 for(const price of [0,-1,NaN,Infinity,null]){data.setups.value.stocks.SNDU={...quote,price};assert.equal(quoteStatus(data,'SNDU',now).usable,false);}
});
test('provider failures have actionable explanations rather than silent dashes',()=>{
 const data=fixture();data.setups.value.stocks.SNDU={quality:'missing',failure:'rate_limited'};
 assert.match(quoteStatus(data,'SNDU',now).detail,/利用上限/);
 data.setups.value.stocks.SNDU.failure='unavailable';assert.match(quoteStatus(data,'SNDU',now).detail,/価格を返していません/);
 const s=fresh();s.holdings=[{ticker:'SNDU',quantity:3,cost:10,currency:'USD',decision:'hold'}];
 const html=valuationOverview(s,data);assert.match(html,/価格の取得状況を再確認/);assert.match(html,/次回の定期取得/);
 assert.ok(!html.includes('価格未取得 · 価格未取得'));assert.equal(valueHoldings(s,data,now).stockJpy,null);
});
test('unpriced new holdings require acknowledgement but existing registrations remain editable',()=>{
 const data=fixture();assert.throws(()=>validateQuoteConsent(data,'UNKNOWN',false),/価格が未取得/);
 assert.doesNotThrow(()=>validateQuoteConsent(data,'UNKNOWN',true));
 assert.doesNotThrow(()=>validateQuoteConsent(data,'UNKNOWN',false,true));
 assert.match(holdingQuoteNotice('UNKNOWN',data),/name="quote_ack" required/);
 assert.ok(!holdingQuoteNotice('UNKNOWN',data,true).includes('name="quote_ack"'));
 assert.ok(!holdingQuoteNotice('',data).includes('name="quote_ack"'));
});
test('quote refresh updates only the price notice, never shares, cost, brokerage or confirmation on unchanged status',()=>{
 const target={dataset:{},innerHTML:''};const form={elements:{ticker:{value:'UNKNOWN'},ticker_id:{value:'UNKNOWN|XNAS'},holding_id:{value:''},quantity:{value:'110'},cost:{value:'65.51'},broker:{value:'楽天証券'}},querySelector:()=>target};
 const before=JSON.stringify(form.elements);updateHoldingQuoteNotice(form,fixture());assert.match(target.innerHTML,/対象外/);
 target.innerHTML='unchanged notice with checked consent';updateHoldingQuoteNotice(form,fixture());assert.match(target.innerHTML,/checked consent/);
 assert.equal(JSON.stringify(form.elements),before);
 form.elements.ticker.value='OTHER';updateHoldingQuoteNotice(form,fixture());assert.match(target.innerHTML,/OTHER：/);assert.ok(!target.innerHTML.includes('checked consent'));
 form.elements.ticker_id.value='';updateHoldingQuoteNotice(form,fixture());assert.match(target.innerHTML,/銘柄を選ぶと/);
});
test('SNDU uses its own price and combines two brokers without an underlying-price substitution',()=>{
 const s=fresh(),data=fixture();s.holdings=[{id:'a',ticker:'SNDU',quantity:3,cost:10,currency:'USD',broker:'楽天証券',decision:'hold'},{id:'b',ticker:'SNDU',quantity:7,cost:20,currency:'USD',broker:'moomoo証券',decision:'hold'}];
 data.setups.value.stocks.SNDK={...quote,ticker:'SNDK',price:999};
 const v=valueHoldings(s,data,now);assert.equal(v.rows.length,1);assert.equal(v.rows[0].quantity,10);assert.equal(v.rows[0].cost,17);assert.equal(v.rows[0].value,125);assert.equal(v.stockJpy,18750);assert.equal(v.fresh,true);
});
test('search candidate labels never describe stale or absent quotes as automatically current',()=>{
 const data=fixture();setQuoteCoverage(data.setups.value.stocks,calendar,true);assert.notEqual(quoteCoverageLabel('SNDU'),'価格自動更新');
 assert.equal(quoteCoverageLabel('NOQUOTE'),'価格自動取得の対象外');
 setQuoteCoverage(undefined,calendar);assert.equal(quoteCoverageLabel('SNDU'),'価格の取得状況を確認中');
});

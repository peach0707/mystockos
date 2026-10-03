import test from 'node:test';
import assert from 'node:assert/strict';
import {fresh,migrate,validate,read,KEY} from '../assets/js/state.js';
import {captureMorning,importantChanges,newsNovelty} from '../assets/js/morning.js';
import {newsHealth,dedupeNews,relation,briefState} from '../assets/js/news-model.js';
import {homeView} from '../assets/js/views.js';
import {newsPreview} from '../assets/js/news-ui.js';
import {searchSymbols} from '../assets/js/symbols.js';
import {valueHoldings} from '../assets/js/valuation.js';
import {homePortfolio,valuationOverview} from '../assets/js/valuation-ui.js';

const now=Date.parse('2026-10-03T12:00:00Z');
const q={as_of:'2026-10-02',price:100,quality:'ok',currency:'USD',ma20:96,ma50:90,prior_high20:99,prior_low20:85,rsi14_simple:60,distance_ma20_pct:4,trend_up:true};
const fixture=()=>({calendar:{value:{start:'2026-10-01',end:'2026-10-10',sessions:[{date:'2026-10-01',close:'2026-10-01T20:00:00Z'},{date:'2026-10-02',close:'2026-10-02T20:00:00Z'}]}},setups:{value:{stocks:{MU:{...q},AAPL:{...q}}}},fx:{value:{pair:'USD/JPY',rate:150,as_of:'2026-10-02',quality:'ok'}}});
const news=(id='1')=>({id,title:'Company releases new capacity '+id,headline_ja:'新たな供給計画を公表',url:'https://example.com/news/'+id,published_at:'2026-10-03T10:00:00Z',direct_tickers:['MU'],related_tickers:['NVDA'],source:'公式',brief:{status:'ready',basis:'article_body',summary_ja:'本文に基づく新しい供給計画です。'}});

test('new devices start with no forced watchlist; existing v6 and legacy data retain every private record',()=>{
 assert.deepEqual(fresh().watch,[]);
 const s=fresh();s.watch=['MU','SKHY','SNDK'];s.policy='original';s.holdings=[{ticker:'MU',quantity:3,cost:80,currency:'USD',decision:'hold',broker:'A'}];s.appearance='dark';
 assert.deepEqual(migrate(s),s);const raw=JSON.stringify(s);globalThis.localStorage={getItem:k=>k===KEY?raw:null};assert.deepEqual(read(),s);assert.equal(JSON.stringify(s),raw);
});
test('first observations never fabricate price changes; later observations compare actual values and currency',()=>{
 const s=fresh();s.watch=['MU'];const d=fixture();captureMorning(s,d,now);assert.equal(importantChanges(d,s,now)[0].change,null);validate(s);
 const before=JSON.stringify(s);assert.equal(captureMorning(s,d,now),false);assert.equal(JSON.stringify(s),before);
 d.setups.value.stocks.MU.price=105;captureMorning(s,d,now);const r=importantChanges(d,s,now)[0];assert.ok(Math.abs(r.change-5)<1e-8);assert.ok(r.important);validate(s);
 d.setups.cached=true;const saved=JSON.stringify(s);assert.equal(captureMorning(s,d,now),false);assert.equal(importantChanges(d,s,now)[0].change,null);assert.equal(JSON.stringify(s),saved);
 d.setups.cached=false;d.setups.value.stocks.MU.currency='JPY';captureMorning(s,d,now);assert.equal(importantChanges(d,s,now)[0].change,null);
});
test('stale/missing prices and newly added securities do not invent a comparison',()=>{
 const s=fresh();s.watch=['MU'];const d=fixture();captureMorning(s,d,now);
 d.setups.value.stocks.MU.as_of='2026-10-01';d.setups.value.stocks.MU.price=999;assert.equal(captureMorning(s,d,now),false);assert.equal(importantChanges(d,s,now)[0].change,null);
 delete d.setups.value.stocks.MU;assert.equal(importantChanges(d,s,now)[0].change,null);
 s.watch.push('AAPL');captureMorning(s,d,now);assert.equal(importantChanges(d,s,now).find(r=>r.ticker==='AAPL').change,null);
});
test('news dedupes tracking URLs and exact headlines, but keeps numerical updates and conditional relevance',()=>{
 const a=news(),b={...a,id:'dup',url:a.url+'/?utm_source=test'},c={...a,id:'new',title:a.title+' revised 30%',url:a.url+'-update'};
 assert.equal(dedupeNews([a,b,c]).length,2);assert.deepEqual(relation(a,{watch:['MUU','NVDA'],holdings:[]}),{direct:['MUU'],indirect:['NVDA'],label:'発表元に関連：MUU'});
 assert.equal(relation(a,{watch:['AAPL'],holdings:[]}).label,'');
});
test('news separates first view/new/update/known and feed failure from no relevant items',()=>{
 const s=fresh(),a=news(),d={news:{value:{checked_at:new Date(now).toISOString(),status:'ok',sources:[{status:'ok'}],articles:[a]}}};s.watch=['MU'];
 assert.equal(newsHealth(d,now).ok,true);captureMorning(s,d,now);assert.equal(newsNovelty(a,s),'初回確認');
 const b=news('2');d.news.value.articles.unshift(b);captureMorning(s,d,now);assert.equal(newsNovelty(b,s),'新着');assert.equal(newsNovelty(a,s),'確認済み');
 a.brief.summary_ja+=' 新しい数値。';captureMorning(s,d,now);assert.equal(newsNovelty(a,s),'要約・内容の更新');validate(s);
 d.news.value.status='partial';assert.equal(newsHealth(d,now).ok,false);d.news.error='503';assert.match(newsPreview(d,{...s,watch:['AAPL']}),/取得状況を確認できません/);assert.doesNotMatch(newsPreview(d,{...s,watch:['AAPL']}),/新情報はありません/);
});
test('headline-only and failed summaries are never marked as body-based facts',()=>{
 const a=news();delete a.brief;assert.equal(briefState(a).ready,false);
 a.brief={status:'pending',reason:'http_403',failure_stage:'article'};assert.match(briefState(a).label,/失敗/);
 a.brief.failure_stage='model';assert.match(briefState(a).label,/本文取得済み・要約失敗/);
 a.brief={status:'ready',basis:'headline',summary_ja:'unsupported'};assert.equal(briefState(a).ready,false);
});
test('home emphasizes three sections, folds details, and only personalizes memory for relevant holdings/watch',()=>{
 const s=fresh();s.watch=['AAPL'];let h=homeView({},s);assert.doesNotMatch(h,/data-memory-stock/);assert.match(h,/<details class="card home-more"><summary>もう少し/);assert.ok(h.indexOf('資産と増減')<h.indexOf('前回から'));assert.ok(h.indexOf('前回から')<h.indexOf('自分に関係するニュース'));
 s.watch=['MUU'];h=homeView({},s);assert.match(h,/data-memory-stock/);assert.match(h,/SNDK/);assert.doesNotMatch(h,/買い時・売り時/);
});
test('Japanese, kana variants and full-width searches resolve real securities without fabricating listings',()=>{
 const rows=['MU','SKHY','SNDK','AAPL'].map(symbol=>({symbol,name:symbol,exchange:'NASDAQ'}));
 for(const [query,t] of [['マイクロン','MU'],['まいくろん','MU'],['ＭＵ','MU'],['SK ハイニックス','SKHY'],['サンディスク','SNDK'],['アップル','AAPL']])assert.equal(searchSymbols(rows,query)[0].symbol,t);
 assert.equal(searchSymbols(rows,'存在しない会社').length,0);
});
test('partial valuation is never the asset total, and old data is labeled on home',()=>{
 const s=fresh();s.holdings=['MU','MISSING'].map(ticker=>({ticker,quantity:2,cost:50,currency:'USD',decision:'hold'}));const d=fixture();let v=valueHoldings(s,d,now);assert.equal(v.stockJpy,null);assert.equal(v.subtotalJpy,30000);assert.match(valuationOverview(s,d),/取得済み分の参考評価/);assert.match(homePortfolio(s,d),/data-home-total>—/);
 s.holdings.pop();d.setups.cached=true;assert.match(homePortfolio(s,d),/参考評価・価格または為替/);
});
test('fallback cache and FX for dollar cash cannot silently count as fresh',()=>{
 const s=fresh();s.holdings=[{ticker:'MU',quantity:2,cost:50,currency:'USD',decision:'hold'}];const d=fixture();
 delete d.setups.value.stocks.MU;d.stocks={value:{stocks:[{ticker:'MU',price:100,date:'2026-10-02'}]},cached:true,error:'503'};
 assert.equal(valueHoldings(s,d,now).fresh,false);assert.equal(valueHoldings(s,d,now).rows[0].stale,true);s.watch=['MU'];captureMorning(s,d,now);assert.equal(s.morningBrief,undefined);
 d.setups.value.stocks.MU={...q,currency:'JPY'};s.cashBalance={JPY:0,USD:10,updatedAt:'2026-10-02'};d.fx.cached=true;
 assert.equal(valueHoldings(s,d,now).fresh,false);
});

// Disposable synthetic accounts. No brokerage connection or personal-data upload.
import {chromium,webkit} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {fresh,KEY} from '../assets/js/state.js';
const root=process.env.APP_TEST_URL||'http://127.0.0.1:4173';
const now='2026-10-03T12:00:00Z';
const master=JSON.parse(await fs.readFile(new URL('../data/symbols.json',import.meta.url)));
const original=fresh();original.watch=['MU','SKHY','SNDK'];original.policy='復元確認用の架空メモ';
original.holdings=[{id:'synthetic-a',ticker:'MU',quantity:2,cost:80,currency:'USD',decision:'hold',broker:'テスト口座A'},{id:'synthetic-b',ticker:'MU',quantity:3,cost:90,currency:'USD',decision:'hold',broker:'テスト口座B'}];
original.securities.MU=master.symbols.find(r=>r.symbol==='MU'&&r.exchange==='NASDAQ');
original.rationales.MU=['theme_growth'];original.cashBalance={JPY:1000,USD:2,updatedAt:'2026-10-02'};
original.cashFlows=[{id:'synthetic-flow',date:'2026-10-02',timestamp:null,amount_jpy:1000,type:'deposit',note:'架空入金'}];
original.dividends=[{id:'synthetic-dividend',ticker:'MU',payment_date:'2026-10-02',timestamp:null,net_amount:5,tax_information:{withheld:1,note:'架空配当'},currency:'USD',fx:150,status:'paid'}];
original.morningBrief={rows:{MU:{current:{date:'2026-10-01',price:100,currency:'USD',code:'trend',label:'上昇基調',observedAt:'2026-10-02T12:00:00Z'},previous:null}},news:null};
const article={id:'test-news-1',title:'Micron announces capacity 20',headline_ja:'マイクロンの供給計画',url:'https://example.com/micron',published_at:'2026-10-03T10:00:00Z',source:'テスト発表元',source_id:'micron',topic:'memory',topic_label:'メモリ',event:'capacity',importance:'high',direct_tickers:['MU'],related_tickers:['NVDA'],impact:'量産が進めば供給増につながる可能性があります。',follow_up:'稼働時期の正式発表を確認',brief:{status:'ready',basis:'article_body',headline_ja:'マイクロン、供給計画を更新',summary_ja:'架空テストの供給計画です。',checked_at:now}};
await fs.mkdir('test-artifacts',{recursive:true});
for(const [name,engine] of [['chromium',chromium],['webkit',webkit]]){
 const browser=await engine.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});page.setDefaultTimeout(12000);
  await page.clock.setFixedTime(new Date(now));
  const errors=[],external=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(!r.url().startsWith(root)&&!r.url().startsWith('data:'))external.push(r.url());});
  await page.addInitScript(({key,seed})=>{if(!localStorage.getItem(key))localStorage.setItem(key,JSON.stringify(seed));},{key:KEY,seed:original});
  await page.route('**/data/stock_setups.json',async route=>{const r=await route.fetch(),v=await r.json();Object.assign(v.stocks.MU,{as_of:'2026-10-02',price:105,quality:'ok',overheated:false,breakdown:false,breakout:false,trend_up:true,distance_ma20_pct:5});await route.fulfill({json:v});});
  await page.route('**/data/news.json',route=>route.fulfill({json:{schema_version:1,status:'ok',checked_at:now,last_success_at:now,sources:[{name:'テスト発表元',status:'ok'}],articles:[article,{...article,id:'duplicate',url:article.url+'?utm_source=test'},{...article,id:'test-failed',title:'Micron second event',url:'https://example.com/second',brief:{status:'pending',reason:'http_403',failure_stage:'article'}},{...article,id:'unrelated',title:'Unrelated Apple story',url:'https://example.com/unrelated',direct_tickers:['AAPL'],related_tickers:[]}]}}));
  await page.goto(root+'/#home');await page.waitForFunction(()=>document.querySelector('.header-refresh')?.disabled===false);
  const state=()=>page.evaluate(key=>JSON.parse(localStorage.getItem(key)),KEY);
  for(const k of ['holdings','watch','cashFlows','dividends','rationales','cashBalance','policy'])assert.deepEqual((await state())[k],original[k],k+' is preserved');
  assert.match(await page.locator('.morning-changes').innerText(),/100.*105/s);
  assert.match(await page.locator('.morning-changes').innerText(),/2026-10-01 → 2026-10-02/);
  assert.equal(await page.locator('.home-more').getAttribute('open'),null);
  assert.equal(await page.locator('.tab-page[data-route="home"] [data-memory-stock]').count(),3);
  assert.equal(await page.locator('.morning-news .brief-card').count(),2);
  assert.doesNotMatch(await page.locator('.morning-news').innerText(),/Unrelated Apple/);
  await page.screenshot({path:`test-artifacts/${name}-morning-home.png`});
  await page.locator('.bottom a[href="#news"]').click();
  assert.equal(await page.locator('.brief-list .brief-card').count(),2);
  assert.match(await page.locator('.brief-list').innerText(),/本文・要約の取得失敗/);
  await page.locator('.brief-list a[href="#news/test-failed"]').click();
  assert.match(await page.locator('.news-detail').innerText(),/見出しだけでは内容を判断しません/);
  await page.locator('.gear').click();await page.getByRole('button',{name:'ダーク',exact:true}).click();
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'バックアップを保存',exact:true}).click();
  const backup=await (await download).path(),saved=JSON.parse(await fs.readFile(backup,'utf8'));
  assert.deepEqual(saved.holdings,original.holdings);assert.equal(saved.appearance,'dark');
  await page.getByRole('button',{name:'ライト',exact:true}).click();
  const beforeBad=await state();await page.locator('#import-private').setInputFiles({name:'invalid.json',mimeType:'application/json',buffer:Buffer.from('{"version":6}')});
  await page.waitForFunction(()=>document.querySelector('#notice')?.textContent.includes('保存していません'));assert.deepEqual(await state(),beforeBad);
  page.once('dialog',dialog=>dialog.accept());await page.locator('#import-private').setInputFiles(backup);
  await page.waitForFunction(()=>document.documentElement.dataset.appearance==='dark');
  for(const k of ['holdings','watch','cashFlows','dividends','rationales','cashBalance','policy'])assert.deepEqual((await state())[k],original[k]);
  for(const mode of ['light','dark']){
   await page.locator(`button[data-appearance="${mode}"]`).click();
   for(const width of [320,390,430,1024]){
    await page.setViewportSize({width,height:844});
    for(const route of ['home','stocks','news','portfolio']){
     await page.locator(`.bottom a[href="#${route}"]`).click();
     const pane=page.locator(`.tab-page[data-route="${route}"]`);
     assert.equal(await pane.evaluate(e=>e.scrollWidth>e.clientWidth+1),false,`${name}/${mode}/${width}/${route} overflow`);
    }
   }
   await page.setViewportSize({width:390,height:844});await page.locator('.gear').click();
   await page.screenshot({path:`test-artifacts/${name}-morning-${mode}-settings.png`});
  }
  // An offline restore must not require re-registering securities via a live master.
  await page.route('**/*.json',route=>route.abort());await page.locator('.header-refresh').click();await page.waitForFunction(()=>!document.querySelector('.header-refresh')?.disabled);
  page.once('dialog',dialog=>dialog.accept());await page.locator('#import-private').setInputFiles(backup);
  await page.waitForFunction(()=>document.querySelector('#notice')?.textContent.includes('読み込みが完了'));
  assert.deepEqual((await state()).holdings,original.holdings);
  await page.locator('.bottom a[href="#home"]').click();assert.match(await page.locator('.morning-news').innerText(),/取得に失敗/);assert.match(await page.locator('.valuation-context').innerText(),/参考評価/);
  await page.reload();await page.waitForFunction(()=>!document.querySelector('.header-refresh')?.disabled);assert.deepEqual((await state()).dividends,original.dividends);
  assert.deepEqual(errors,[]);assert.deepEqual(external,[],'no private state is sent off origin');
  console.log(`${name}: prior-data changes, news dedupe/failure/relevance, preserved accounts/dividends/flows, backup/restore/invalid/offline, light/dark and widths passed`);
 }finally{await browser.close();}
}

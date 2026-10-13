import {chromium,webkit} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {fresh,KEY} from '../assets/js/state.js';
const root=process.env.APP_TEST_URL||'http://127.0.0.1:4173';
const master=JSON.parse(await fs.readFile(new URL('../data/symbols.json',import.meta.url)));
const seed=fresh();seed.watch=['MU','NVDA','SNDK','SKHY'];
seed.holdings=[['MU',100,80,'楽天証券'],['MU',50,110,'moomoo証券'],['NVDA',40,100,'楽天証券'],['SNDK',80,30,'楽天証券'],['SKHY',50,20,'moomoo証券']].map(([ticker,quantity,cost,broker],i)=>({id:'demo-'+i,ticker,quantity,cost,broker,currency:'USD',decision:'hold'}));
for(const ticker of seed.watch)seed.securities[ticker]=master.symbols.find(s=>s.symbol===ticker&&s.currency==='USD');
seed.cashBalance={JPY:300000,USD:1000,updatedAt:'2026-10-12'};
await fs.mkdir('test-artifacts',{recursive:true});
for(const [name,engine] of [['chromium',chromium],['webkit',webkit]]){
 const browser=await engine.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});page.setDefaultTimeout(15000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(({key,seed})=>{if(!localStorage.getItem(key))localStorage.setItem(key,JSON.stringify(seed));},{key:KEY,seed});
  await page.goto(root+'/#home');await page.waitForFunction(()=>document.querySelector('.header-refresh')?.disabled===false);
  assert.deepEqual(await page.locator('.bottom a').allTextContents(),['ホーム','資産','銘柄','ニュース','分析']);
  assert.equal(await page.locator('.home-watch .watch-snapshot>a').count(),4);
  await page.screenshot({path:`test-artifacts/${name}-clarity-home.png`});
  const homeAmount=await page.locator('[data-home-total]').textContent();
  await page.locator('[data-toggle-amounts]').click();assert.equal(await page.locator('[data-home-total]').textContent(),'••••');
  await page.locator('.bottom a[href="#portfolio"]').click();assert.equal(await page.locator('[data-valuation-total]').textContent(),'••••');
  await page.locator('.header-refresh').click();await page.waitForFunction(()=>!document.querySelector('.header-refresh').disabled);
  assert.equal(await page.locator('[data-valuation-total]').textContent(),'••••');
  await page.reload();await page.waitForFunction(()=>!document.querySelector('.header-refresh').disabled);
  assert.equal(await page.locator('[data-valuation-total]').textContent(),'••••');
  await page.locator('[data-toggle-amounts]').click();
  assert.notEqual(await page.locator('[data-valuation-total]').textContent(),'••••');
  await page.getByRole('button',{name:'保有銘柄',exact:true}).click();
  assert.equal(await page.locator('[data-holding="MU"]').count(),1,'brokers remain aggregated');
  await page.getByRole('button',{name:'詳細',exact:true}).click();assert.ok(await page.locator('[data-average-cost="MU"]').isVisible());
  assert.equal(await page.locator('[data-average-cost="MU"]').textContent(),'$90');
  await page.getByRole('button',{name:'一覧',exact:true}).click();assert.equal(await page.locator('[data-average-cost="MU"]').isVisible(),false);
  await page.getByRole('button',{name:'MUの保有を編集',exact:true}).click();assert.equal(await page.locator('[data-holding="MU"] .holding-positions').getAttribute('open'),'');
  await page.locator('.bottom a[href="#home"]').click();await page.getByRole('button',{name:'メモリ3社',exact:true}).click();
  await page.waitForURL('**/#stocks');assert.equal(await page.locator('.tab-page[data-route="stocks"] .decision-card:visible').count(),3);
  await page.getByRole('button',{name:'監視銘柄',exact:true}).click();
  const query=page.getByPlaceholder('会社名・ティッカーで絞り込む');await query.fill('マイクロン');
  await page.locator('[data-stock-sort]').selectOption('up');assert.equal(await query.inputValue(),'マイクロン');
  assert.equal(await page.locator('.tab-page[data-route="stocks"] .decision-card:visible').count(),1);
  await query.fill('');await page.locator('[data-stock-sort]').selectOption('name');
  assert.deepEqual(await page.locator('.tab-page[data-route="stocks"] [data-stock-ticker]').evaluateAll(rows=>rows.map(r=>r.dataset.stockTicker)),['MU','NVDA','SKHY','SNDK']);
  await page.screenshot({path:`test-artifacts/${name}-clarity-stocks.png`});
  for(const mode of ['light','dark']){
   await page.locator('.gear').click();await page.locator(`button[data-appearance="${mode}"]`).click();
   for(const width of [320,390,430,1024]){
    await page.setViewportSize({width,height:844});
    for(const route of ['home','portfolio','stocks','news','themes']){
     await page.locator(`.bottom a[href="#${route}"]`).click();const pane=page.locator(`.tab-page[data-route="${route}"]`);
     assert.equal(await pane.evaluate(el=>el.scrollWidth>el.clientWidth+1),false,`${name}/${mode}/${width}/${route}`);
    }
   }
   await page.setViewportSize({width:390,height:844});
   for(const route of ['home','portfolio','news']){
    await page.locator(`.bottom a[href="#${route}"]`).click();await page.locator(`.tab-page[data-route="${route}"]`).evaluate(e=>e.scrollTop=0);
    await page.screenshot({path:`test-artifacts/${name}-clarity-${mode}-${route}.png`});
   }
  }
  const state=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),KEY);assert.deepEqual(state.holdings,seed.holdings);assert.deepEqual(state.watch,seed.watch);
  assert.deepEqual(errors,[]);console.log(name+': navigation, aggregate holdings, density, private amounts, search/sort, both colors and 4 widths passed');
 }finally{await browser.close();}
}

// Synthetic data only: verify ten unopened days on iPhone Safari and Chromium.
import {chromium,webkit} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {fresh,KEY} from '../assets/js/state.js';
import {portfolioBasis} from '../assets/js/portfolio-history.js';
const root='http://127.0.0.1:4173',now='2026-10-02T04:00:00Z';
const sessions=['2026-09-21','2026-09-22','2026-09-23','2026-09-24','2026-09-25','2026-09-28','2026-09-29','2026-09-30','2026-10-01'];
const symbols=JSON.parse(await fs.readFile(new URL('../data/symbols.json',import.meta.url)));
const seed=fresh();seed.holdings=[{ticker:'MU',quantity:200,cost:80,currency:'USD',decision:'hold',broker:'楽天証券'},{ticker:'MU',quantity:300,cost:90,currency:'USD',decision:'hold',id:'test-b',broker:'moomoo証券'},{ticker:'DRAM',quantity:10,cost:40,currency:'USD',decision:'hold'}];
for(const ticker of ['MU','DRAM'])seed.securities[ticker]=symbols.symbols.find(s=>s.symbol===ticker&&s.country==='United States')||symbols.symbols.find(s=>s.symbol===ticker);
seed.holdingObservations=[{date:'2026-09-22',priceDate:'2026-09-21',assetsJpy:7575000,fxDate:'2026-09-21',fxRate:150,basis:portfolioBasis(seed),basisChanged:false,sourceKey:'synthetic',observedAt:'2026-09-22T04:00:00Z'}];
const archive={schema_version:1,price_basis:'as_reported_daily_close',as_of:'2026-10-01',stocks:Object.fromEntries([['MU',100],['DRAM',50]].map(([ticker,base])=>[ticker,{currency:'USD',history:sessions.map((date,i)=>({date,close:base+i}))}])),fx:{pair:'USD/JPY',basis:'completed_UTC_daily_close',history:sessions.map((date,i)=>({date,rate:150+i}))}};
await fs.mkdir('test-artifacts',{recursive:true});
for(const [name,engine] of [['chromium',chromium],['webkit',webkit]]){
 const browser=await engine.launch();
 try{
  const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});page.setDefaultTimeout(12000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.clock.setFixedTime(new Date(now));
  await page.addInitScript(({key,seed})=>{if(!localStorage.getItem(key))localStorage.setItem(key,JSON.stringify(seed));},{key:KEY,seed});
  await page.route('**/data/price_archive.json',route=>route.fulfill({json:archive}));
  // Keep current snapshots aligned with the deterministic daily archive.
  await page.route('**/data/stock_setups.json',async route=>{const r=await route.fetch(),value=await r.json();for(const ticker of ['MU','DRAM'])Object.assign(value.stocks[ticker],{quality:'ok',as_of:'2026-10-01',price:archive.stocks[ticker].history.at(-1).close});await route.fulfill({json:value});});
  await page.route('**/data/fx.json',async route=>{const r=await route.fetch(),value=await r.json();Object.assign(value,{as_of:'2026-10-01',rate:158,quality:'ok'});await route.fulfill({json:value});});
  await page.goto(root+'/#portfolio');
  await page.waitForFunction(()=>document.querySelector('.header-refresh')?.disabled===false);
  const state=()=>page.evaluate(key=>JSON.parse(localStorage.getItem(key)),KEY);
  const saved=await state();assert.equal(saved.holdingDailyHistory.length,9);assert.equal(saved.holdingDailyHistory.at(-1).assetsJpy,(500*108+10*58)*158);
  assert.deepEqual(saved.holdings,seed.holdings);assert.deepEqual(saved.holdingObservations,seed.holdingObservations);
  await page.getByLabel('保有銘柄の並び順').selectOption('name');
  assert.equal(await page.locator('.holding-card:visible').first().getAttribute('data-holding'),'DRAM');
  await page.getByLabel('保有銘柄を検索',{exact:true}).fill('MU');assert.equal(await page.locator('.holding-card:visible').count(),1);
  await page.getByLabel('保有銘柄を検索',{exact:true}).fill('NO_MATCH');await page.locator('[data-no-holdings]:visible').waitFor();
  await page.getByLabel('保有銘柄を検索',{exact:true}).fill('');
  await page.locator('#notice').waitFor({state:'hidden'});
  await page.locator('.tab-page[data-route="portfolio"]').evaluate(el=>el.scrollTop=0);
  await page.screenshot({path:`test-artifacts/${name}-portfolio-v2.png`,fullPage:true});
  await page.locator('.bottom a[href="#home"]').click();
  for(const width of [320,390]){
   await page.setViewportSize({width,height:844});
   const clipped=await page.locator('.home-portfolio-metrics b').evaluateAll(rows=>rows.filter(el=>el.scrollWidth>el.clientWidth+1).length);
   assert.equal(clipped,0,`${name} ${width}px summary amounts fit on one line`);
  }
  await page.screenshot({path:`test-artifacts/${name}-home-v2.png`});
  await page.getByRole('link',{name:'カレンダーで日別の変化を見る'}).click();
  await page.getByRole('button',{name:'前月',exact:true}).click();
  assert.match(await page.locator('.auto-calendar-summary').innerText(),/7日の記録/);
  assert.equal(await page.locator('.history-day.priced').count(),6);
  await page.locator('[data-auto-date="2026-09-29"]').click();
  assert.match(await page.locator('.daily-detail').innerText(),/前営業日比/);assert.equal(await page.locator('.daily-parts>a').count(),2);
  await page.screenshot({path:`test-artifacts/${name}-day-v2.png`});
  await page.getByRole('link',{name:'‹ カレンダーへ',exact:true}).click();
  await page.getByRole('button',{name:'評価額',exact:true}).click();assert.equal(await page.locator('[data-calendar-mode="value"]').getAttribute('aria-pressed'),'true');
  await page.getByRole('button',{name:'前営業日比',exact:true}).click();
  for(const width of [320,390,430,1024]){
   await page.setViewportSize({width,height:844});
   assert.equal(await page.locator('.auto-calendar').evaluate(el=>el.scrollWidth>el.clientWidth+1),false,`${name} calendar ${width}px overflow`);
   for(const mode of ['value','change']){await page.locator(`[data-calendar-mode="${mode}"]`).click();const bad=await page.locator('.history-day').evaluateAll(days=>days.filter(el=>el.scrollWidth>el.clientWidth+1).length);assert.equal(bad,0,`${name} ${mode} cell ${width}px overflow`);}
   await page.screenshot({path:`test-artifacts/${name}-calendar-v2-${width}.png`});
  }
  await page.setViewportSize({width:390,height:844});
  await page.reload();await page.waitForFunction(()=>document.querySelector('.header-refresh')?.disabled===false);
  assert.deepEqual((await state()).holdingDailyHistory,saved.holdingDailyHistory);
  await page.locator('.bottom a[href="#portfolio"]').click();
  await page.getByRole('button',{name:'MUの保有を編集',exact:true}).click();
  await page.getByRole('button',{name:'MU・楽天証券の登録分を編集',exact:true}).click();
  await page.getByLabel('株数',{exact:true}).fill('20');await page.getByRole('button',{name:'保存',exact:true}).click();await page.waitForURL('**/#portfolio');
  const edited=await state();assert.deepEqual(edited.holdingDailyHistory.slice(0,-1),saved.holdingDailyHistory.slice(0,-1));assert.equal(edited.holdingDailyHistory.at(-1).basisChanged,true);
  await page.route('**/data/*.json',route=>route.abort());await page.reload();await page.waitForFunction(()=>document.querySelector('.header-refresh')?.disabled===false);
  assert.deepEqual((await state()).holdingDailyHistory,edited.holdingDailyHistory);assert.deepEqual(errors,[]);
  console.log(`${name}: unopened-day backfill, original holdings, calendar modes, contributions, search/sort, quantity boundaries, offline preservation and 320–1024px passed`);
 }finally{await browser.close();}
}

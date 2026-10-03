// All private records here are synthetic. No user's phone data is loaded.
import {chromium,webkit} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {fresh,KEY} from '../assets/js/state.js';
const repo=fileURLToPath(new URL('../',import.meta.url));
const server=http.createServer(async(req,res)=>{
 try{const relative=decodeURIComponent(new URL(req.url,'http://localhost').pathname).replace(/^\/+/,''),file=path.resolve(repo,relative||'index.html');
  if(!file.startsWith(repo))throw Error('bad path');
  const body=await fs.readFile(file),ext=path.extname(file);res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml'})[ext]||'application/octet-stream');res.end(body);
 }catch{res.statusCode=404;res.end('Not found');}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const root=`http://127.0.0.1:${server.address().port}`;
const themeFixture=JSON.parse(await fs.readFile(new URL('../data/themes.json',import.meta.url)));
themeFixture.as_of='2026-10-01';
const memory=themeFixture.themes.find(t=>t.theme_id==='memory_hbm');
Object.assign(memory,{data_quality:{status:'insufficient',core_total:2,strength_eligible_n:1,heat_eligible_n:1},strength:{score:null,eligible_members:['MU']},heat:{score:65.88,eligible_n:1,hot:false,hot_eligible:false},velocity:{state:null,confirmed:false}});
for(const [id,days] of [['semiconductor_equipment',3],['optical_photonics',1]]){
 const t=themeFixture.themes.find(t=>t.theme_id===id);Object.assign(t,{data_quality:{status:'ok',core_total:4,strength_eligible_n:4,heat_eligible_n:4},strength:{score:58},velocity:{state:'Lagging',candidate:'Leading',raw_state:'Leading',candidate_days:days,confirmed:false},heat:{...t.heat,hot:true,hot_eligible:true,score:82}});
}
const calendarFixture={schema_version:1,start:'2026-09-30',end:'2026-10-05',sessions:[{date:'2026-09-30',close:'2026-09-30T20:00:00Z'},{date:'2026-10-01',close:'2026-10-01T20:00:00Z'},{date:'2026-10-02',close:'2026-10-02T20:00:00Z'}]};
const seed=fresh();seed.holdings=[{ticker:'MU',quantity:12,cost:80,currency:'USD',decision:'hold',broker:'楽天証券'},{id:'test-mu-2',ticker:'MU',quantity:8,cost:90,currency:'USD',decision:'hold',broker:'moomoo証券'}];
await fs.mkdir('test-artifacts',{recursive:true});
try{for(const [name,engine] of [['chromium',chromium],['webkit',webkit]]){
 const browser=await engine.launch();
 try{
  const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});page.setDefaultTimeout(15000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.clock.setFixedTime(new Date('2026-10-02T08:00:00Z'));
  await page.addInitScript(({key,seed})=>localStorage.setItem(key,JSON.stringify(seed)),{key:KEY,seed});
  await page.route('**/data/themes.json',route=>route.fulfill({json:themeFixture}));
  await page.route('**/data/market_calendar.json',route=>route.fulfill({json:calendarFixture}));
  await page.route('**/data/stock_setups.json',async route=>{const response=await route.fetch(),value=await response.json();for(const ticker of ['MU','SKHY','SNDK'])Object.assign(value.stocks[ticker],{as_of:'2026-10-01',quality:'ok'});await route.fulfill({json:value});});
  await page.goto(root+'/#themes');await page.waitForFunction(()=>document.querySelector('.header-refresh')?.disabled===false);
  const pane=page.locator('.tab-page[data-route="themes"]');
  assert.equal(await pane.locator('[data-theme-card]').count(),29);
  await page.screenshot({path:`test-artifacts/${name}-themes-overview.png`});
  await pane.getByRole('button',{name:'保有に関連 1',exact:true}).click();
  assert.equal(await pane.locator('[data-theme-card]').count(),1);
  assert.match(await pane.innerText(),/3社とも上昇基調/);
  await pane.locator('[data-theme-id="memory_hbm"] .memory-more').click();
  const detail=page.locator('.detail-page');
  assert.match(await detail.innerText(),/SKHY/);assert.match(await detail.innerText(),/売買の成功率は検証されていません/);assert.doesNotMatch(await detail.innerText(),/強さ順位の推移/);
  await page.screenshot({path:`test-artifacts/${name}-themes-memory.png`});
  assert.ok(await detail.locator('[data-memory-stock="SNDK"] a').isVisible());
  await detail.getByText('判定方法と使える範囲',{exact:true}).click();
  assert.match(await detail.locator('.memory-method').innerText(),/50日平均/);
  assert.equal(await detail.locator('[data-memory-stock]').count(),3);
  for(const width of [320,390,1024]){await page.setViewportSize({width,height:844});assert.equal(await detail.evaluate(el=>el.scrollWidth>el.clientWidth+1),false);}
  await page.setViewportSize({width:390,height:844});
  await detail.getByRole('link',{name:'‹ テーマ一覧',exact:true}).click();
  await pane.getByRole('button',{name:'すべて',exact:true}).click();
  const search=pane.getByRole('searchbox',{name:'テーマ名・銘柄コードで絞り込む'});
  await search.fill('半導体製造装置');assert.equal(await pane.locator('[data-theme-card]:visible').count(),1);
  assert.match(await pane.locator('[data-theme-card]:visible').innerText(),/3\/5回確認/);
  assert.equal(await pane.locator('[data-theme-group-count]:visible').innerText(),'1テーマ');
  await pane.locator('[data-theme-card]:visible').screenshot({path:`test-artifacts/${name}-themes-card.png`});
  await search.fill('no-such-theme');await pane.locator('[data-theme-no-results]:visible').waitFor();
  await search.fill('核融合');assert.equal(await pane.locator('[data-theme-card]:visible').count(),1);assert.equal(await pane.locator('[data-theme-observations]').getAttribute('open'),'');
  await search.fill('');assert.equal(await pane.locator('[data-theme-card]').count(),29);
  await pane.getByRole('button',{name:'変化の兆し',exact:true}).click();assert.ok(await pane.locator('[data-theme-card]').count()>0);
  await pane.getByRole('button',{name:'注意点',exact:true}).click();assert.match(await pane.innerText(),/短期の動きが活発|切替待ち/);
  await pane.getByRole('button',{name:'すべて',exact:true}).click();
  for(const width of [320,390,430,1024]){
   await page.setViewportSize({width,height:844});
   const overflow=await pane.evaluate(el=>({pane:el.scrollWidth>el.clientWidth+1,cards:[...el.querySelectorAll('[data-theme-card]')].filter(c=>c.clientWidth&&c.scrollWidth>c.clientWidth+1).length}));
   assert.deepEqual(overflow,{pane:false,cards:0},`${name} ${width}px overflow`);
  }
  await page.setViewportSize({width:390,height:844});
  await search.fill('光通信');await pane.locator('[data-theme-card]:visible .theme-card-footer a').click();
  assert.match(await detail.innerText(),/短期は活発。勢いの切替待ち/);
  for(const width of [320,390,1024]){await page.setViewportSize({width,height:844});assert.equal(await detail.evaluate(el=>el.scrollWidth>el.clientWidth+1),false);}
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:`test-artifacts/${name}-themes-detail.png`});
  await page.locator('.bottom a[href="#portfolio"]').click();
  assert.equal(await page.locator('[data-holding="MU"]').count(),1);
  assert.deepEqual(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)).holdings,KEY),seed.holdings);
  await page.locator('.bottom a[href="#themes"]').click();
  await page.route('**/data/themes.json',route=>route.abort());await page.locator('.header-refresh').click();await page.waitForFunction(()=>document.querySelector('.header-refresh')?.disabled===false);
  assert.match(await pane.innerText(),/再取得待ち・保存データ/);assert.match(await pane.innerText(),/最新データを確認してから判断/);
  assert.deepEqual(errors,[]);
  console.log(`${name}: themes 29, holding scope, search, transitions, detail, mobile layout, cached-data caution and unchanged holdings passed`);
 }finally{await browser.close();}
}}finally{server.close();}

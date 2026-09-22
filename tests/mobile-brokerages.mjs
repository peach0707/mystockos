// Disposable browser accounts only. Run after starting a local static server.
import {chromium,webkit} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {fresh,KEY} from '../assets/js/state.js';
const root=process.env.APP_TEST_URL||'http://127.0.0.1:4173';
const symbols=JSON.parse(await fs.readFile(new URL('../data/symbols.json',import.meta.url)));
const mu=symbols.symbols.find(s=>s.symbol==='MU'&&s.exchange==='NASDAQ');
const seed=fresh();seed.holdings=[{ticker:'MU',quantity:100,cost:100,currency:'USD',decision:'hold'}];
seed.securities.MU=mu;seed.rationales.MU=['theme_growth'];
await fs.mkdir('test-artifacts',{recursive:true});
const engines=process.env.APP_TEST_CHROMIUM_ONLY?[['chromium',chromium]]:[['chromium',chromium],['webkit',webkit]];
for(const [name,engine] of engines){
 const browser=await engine.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  page.setDefaultTimeout(10000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(({key,seed})=>{if(!localStorage.getItem(key))localStorage.setItem(key,JSON.stringify(seed));},{key:KEY,seed});
  await page.goto(root+'/#portfolio');
  await page.waitForFunction(()=>document.querySelector('.header-refresh')?.disabled===false);
  const card=()=>page.locator('.tab-page[data-route="portfolio"] [data-holding="MU"]');
  const state=()=>page.evaluate(key=>JSON.parse(localStorage.getItem(key)),KEY);
  const save=async()=>{await page.getByRole('button',{name:'保存',exact:true}).click();await page.waitForURL('**/#portfolio');};
  assert.equal(await card().count(),1);assert.equal((await state()).holdings[0].quantity,100);
  await page.getByRole('button',{name:'MUの保有を編集',exact:true}).click();
  await page.getByLabel('証券会社（任意）').fill('楽天証券');await save();
  assert.equal((await state()).holdings[0].broker,'楽天証券');
  // Reproduce the reported failure through the generic new-registration form.
  await page.getByRole('link',{name:'＋ 保有銘柄を登録',exact:true}).click();
  await page.getByRole('textbox',{name:'銘柄名またはティッカーを検索'}).fill('MU');
  await page.locator(`[data-symbol-id="${mu.id}"]`).click();
  assert.equal(await page.locator('[name="decision"]').inputValue(),'hold');
  assert.equal(await page.locator('[name="rationaleTags"][value="theme_growth"]').isChecked(),true);
  await page.getByLabel('証券会社（任意）').fill('moomoo証券');
  await page.getByLabel('株数',{exact:true}).fill('50');
  await page.getByLabel('1株あたり取得単価',{exact:true}).fill('130');await save();
  assert.equal((await state()).holdings.length,2);assert.equal(await card().count(),1);
  assert.match(await card().innerText(),/150株/);assert.equal(await card().locator('[data-average-cost]').innerText(),'$110');
  await page.getByRole('button',{name:'MUの保有を編集',exact:true}).click();
  assert.equal(await card().locator('details').getAttribute('open'),'');
  await card().scrollIntoViewIfNeeded();
  await page.screenshot({path:`test-artifacts/${name}-brokerages.png`});
  await page.getByRole('button',{name:'MU・moomoo証券の登録分を編集',exact:true}).click();
  await page.getByLabel('株数',{exact:true}).fill('25');
  await page.getByLabel('1株あたり取得単価',{exact:true}).fill('160');await save();
  assert.equal(await card().locator('[data-average-cost]').innerText(),'$112');
  assert.equal((await state()).holdings.find(h=>h.broker==='楽天証券').quantity,100);
  await page.reload();await page.waitForFunction(()=>document.querySelector('.header-refresh')?.disabled===false);
  assert.equal(await card().locator('[data-average-cost]').innerText(),'$112');
  await page.getByRole('button',{name:'MUの保有を編集',exact:true}).click();
  await page.getByRole('button',{name:'MU・moomoo証券の登録分を編集',exact:true}).click();
  page.once('dialog',d=>d.dismiss());await page.getByRole('button',{name:'この登録分を削除',exact:true}).click();
  assert.equal((await state()).holdings.length,2);
  page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'この登録分を削除',exact:true}).click();
  await page.waitForURL('**/#portfolio');assert.equal((await state()).holdings.length,1);
  assert.equal(await card().locator('[data-average-cost]').innerText(),'$100');
  // Same brokerage can also contain independent lots; prefill must not copy shares.
  await card().getByRole('button',{name:'＋ この銘柄を追加',exact:true}).click();
  assert.equal(await page.getByRole('textbox',{name:'銘柄名またはティッカーを検索'}).inputValue(),'MU');
  assert.equal(await page.getByLabel('株数',{exact:true}).inputValue(),'');
  await page.getByLabel('証券会社（任意）').fill('楽天証券');
  await page.getByLabel('株数',{exact:true}).fill('20');await page.getByLabel('1株あたり取得単価',{exact:true}).fill('160');
  await page.screenshot({path:`test-artifacts/${name}-brokerage-form.png`});await save();
  assert.equal((await state()).holdings.length,2);assert.equal(await card().locator('[data-average-cost]').innerText(),'$110');
  const backup=await state();
  await page.locator('.gear').click();
  page.once('dialog',d=>d.accept());
  await page.locator('#import-private').setInputFiles({name:'synthetic-brokerages.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup))});
  await page.waitForFunction(()=>document.querySelector('#notice').textContent.includes('読み込みが完了'));
  assert.deepEqual((await state()).holdings,backup.holdings);
  await page.locator('.bottom a[href="#portfolio"]').click();
  for(const width of [320,390,1024]){
   await page.setViewportSize({width,height:844});
   await page.getByRole('button',{name:'MUの保有を編集',exact:true}).click();
   assert.equal(await card().evaluate(el=>el.scrollWidth>el.clientWidth+1),false,`${name} ${width}px holding card overflow`);
  }
  // A searchable but unpriced symbol cannot silently look valuation-ready.
  const unpriced=symbols.symbols.find(s=>s.symbol==='AAPL'&&s.exchange==='NASDAQ');
  await page.setViewportSize({width:390,height:844});
  await page.getByRole('link',{name:'＋ 保有銘柄を登録',exact:true}).click();
  await page.getByRole('textbox',{name:'銘柄名またはティッカーを検索'}).fill('AAPL');
  await page.locator(`[data-symbol-id="${unpriced.id}"]`).click();
  assert.match(await page.locator('[data-holding-quote]').innerText(),/価格自動取得の対象外/);
  await page.getByLabel('株数',{exact:true}).fill('3');
  await page.getByLabel('1株あたり取得単価',{exact:true}).fill('12');
  const beforeMissing=(await state()).holdings.length;
  await page.getByRole('button',{name:'保存',exact:true}).click();
  assert.equal((await state()).holdings.length,beforeMissing);
  await page.locator('[name="quote_ack"]').check();
  await page.screenshot({path:`test-artifacts/${name}-price-coverage.png`});
  await save();
  const noPrice=page.locator('.tab-page[data-route="portfolio"] [data-holding="AAPL"]');
  assert.match(await noPrice.innerText(),/自動取得の対象外/);
  assert.equal(await noPrice.getByRole('button',{name:'価格の取得状況を再確認'}).count(),1);
  assert.equal((await state()).holdings.length,beforeMissing+1);
  assert.deepEqual(errors,[]);
  console.log(`${name}: legacy data, two brokerages, weighted average, exact-row edits/deletes, reload, backup and layouts passed`);
 }finally{await browser.close();}
}

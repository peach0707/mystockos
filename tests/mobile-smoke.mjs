// End-to-end acceptance against a disposable local server on the CI runner.
import {chromium,webkit} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const root='http://127.0.0.1:4173';
await fs.mkdir('test-artifacts',{recursive:true});
for(const [name,engine] of [['chromium',chromium],['webkit',webkit]]){
 const browser=await engine.launch({headless:true});
 const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:1,isMobile:true,hasTouch:true});
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto(root);
 await page.locator('.decision-hero').waitFor();
 await page.waitForFunction(()=>document.querySelector('.freshness')?.textContent.includes('終値'));
 await page.locator('[data-refresh]').first().waitFor({state:'visible'});
 await page.waitForFunction(()=>!document.querySelector('.header-refresh')?.disabled);
 await page.screenshot({path:`test-artifacts/${name}-home.png`});
 assert.equal(await page.locator('.bottom a').count(),5);
 await page.getByRole('button',{name:'買い条件を見る'}).click();
 await page.waitForURL('**/#stocks');
 await page.getByPlaceholder('ティッカーで絞り込む').fill('MU');
 assert.equal(await page.locator('.tab-page[data-route="stocks"] .decision-card:visible').count(),1);
 await page.locator('.tab-page[data-route="stocks"] .decision-card:visible').click();
 await page.getByRole('heading',{name:'買い時・売り時の確認'}).waitFor();
 await page.screenshot({path:`test-artifacts/${name}-stock.png`});
 await page.locator('.bottom a[href="#news"]').click();
 await page.waitForURL('**/#news');
 await page.getByRole('heading',{name:'半導体ニュース',exact:true}).waitFor();
 await page.getByRole('button',{name:'メモリ',exact:true}).click();
 await page.screenshot({path:`test-artifacts/${name}-news.png`});
 const articles=page.locator('.tab-page[data-route="news"] .brief-card');
 if(await articles.count()){
  await articles.first().click();
  await page.getByRole('heading',{name:'投資への影響を整理'}).waitFor();
  assert.ok(await page.getByRole('link',{name:'公式発表を読む'}).getAttribute('href'));
 }
 await page.locator('.bottom a[href="#portfolio"]').click();
 await page.waitForURL('**/#portfolio');
 assert.equal(await page.locator('.bottom a[aria-current="page"]').textContent(),'保有');
 await page.locator('.bottom a[href="#stocks"]').click();
 await page.getByRole('link',{name:'監視銘柄を追加',exact:true}).click();
 await page.getByRole('textbox',{name:'銘柄名またはティッカーを検索'}).fill('NVD');
 await page.locator('[data-symbol-id]').filter({hasText:'NVIDIA Corporation'}).first().click();
 await page.getByRole('button',{name:'監視銘柄に登録',exact:true}).click();
 await page.locator('.bottom a[href="#stocks"]').click();
 await page.getByPlaceholder('ティッカーで絞り込む').fill('NVDA');
 assert.equal(await page.locator('.tab-page[data-route="stocks"] .decision-card:visible').count(),1);
 await page.reload();
 await page.waitForFunction(()=>!document.querySelector('.header-refresh')?.disabled);
 assert.ok((await page.locator('.tab-page[data-route="stocks"]').innerText()).includes('NVDA'));
 for(const width of [320,390,430,1024]){
  await page.setViewportSize({width,height:844});
  for(const route of ['home','stocks','news','themes','portfolio']){
   await page.locator(`.bottom a[href="#${route}"]`).click();
   const overflow=await page.locator(`.tab-page[data-route="${route}"]`).evaluate(el=>el.scrollWidth>el.clientWidth+1);
   assert.equal(overflow,false,`${name} ${width}px ${route} horizontal overflow`);
  }
 }
 assert.deepEqual(errors,[]);
 await browser.close();
 console.log(`${name}: mobile navigation, source links, registration, persistence and 320–1024px layouts passed`);
}

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {themeInsight,themeFreshness,holdingLinks,returnMetric} from '../assets/js/theme-insights.js';
import {themesView,themeDetail,themeCard,ranked} from '../assets/js/themes.js';
const read = path => JSON.parse(fs.readFileSync(new URL('../'+path,import.meta.url)));
const data = {themes:{value:read('data/themes.json')},phaseA:read('data/phase_a.json'),calendar:{value:read('data/market_calendar.json')}};
// Pin scenarios; scheduled feed updates must not change the expected behavior.
data.themes.value.as_of='2026-10-01';
data.calendar.value={start:'2026-09-30',end:'2026-10-05',sessions:[{date:'2026-09-30',close:'2026-09-30T20:00:00Z'},{date:'2026-10-01',close:'2026-10-01T20:00:00Z'},{date:'2026-10-02',close:'2026-10-02T20:00:00Z'}]};
const memory=data.themes.value.themes.find(t=>t.theme_id==='memory_hbm');
memory.data_quality={status:'insufficient',core_total:2,strength_eligible_n:1,heat_eligible_n:1};memory.strength={score:null,eligible_n:1,eligible_members:['MU']};memory.heat={score:65.88,eligible_n:1,hot:false,hot_eligible:false};memory.velocity={state:null,confirmed:false};
const equipment=data.themes.value.themes.find(t=>t.theme_id==='semiconductor_equipment');
equipment.data_quality={status:'ok',core_total:4,strength_eligible_n:4,heat_eligible_n:4};equipment.strength={score:37.8};equipment.velocity={state:'Lagging',candidate:'Leading',raw_state:'Leading',candidate_days:3,confirmed:false};
const current = {usable:true,asOf:'2026-10-01',label:'確定日足・更新済み'};
const theme = id => structuredClone(data.themes.value.themes.find(t => t.theme_id === id));
test('incomplete memory coverage is not promoted to bullish, hot, or a ranked theme',()=>{
 const t=theme('memory_hbm'), before=JSON.stringify(t),m=themeInsight(t,current);
 assert.equal(m.insufficient,true);assert.equal(m.strengthLabel,'判定保留');assert.equal(m.hot,false);assert.equal(m.heatLabel,'参考値のみ');assert.deepEqual(m.missing,['SKHY']);
 const html=themeCard(t,0,{freshness:current});assert.match(html,/データ不足のため判断を保留/);assert.doesNotMatch(html,/比較\d+テーマ中/);
 assert.match(themeDetail(t,null,null,'2026-10-01'),/SKHY/);assert.equal(JSON.stringify(t),before);
});
test('pending transition exposes candidate and never asserts prior lagging state is current confirmation',()=>{
 const t=theme('semiconductor_equipment'),m=themeInsight(t,current),html=themeCard(t,4,{freshness:current});
 assert.equal(m.changing,true);assert.equal(m.velocityLabel,'切替を確認中');assert.match(html,/直前：相対的に下向き → 候補：相対的に上向き（3\/5回確認）/);assert.match(html,/まだ未確認/);
});
test('engine eligibility and concentration flags outrank the numeric heat score',()=>{
 const t=theme('ai_networking_connectivity');t.data_quality={status:'ok',core_total:5,strength_eligible_n:5,heat_eligible_n:5};t.strength.score=65;t.heat.hot=false;t.heat.score=99;t.heat.single_stock_driven=true;
 assert.equal(themeInsight(t,current).hot,false);assert.equal(themeInsight(t,current).title,'一部の銘柄に動きが集中');
 t.heat.single_stock_driven=false;t.heat.hot_eligible=false;t.data_quality.heat_eligible_n=2;
 assert.equal(themeInsight(t,current).heatLabel,'参考値のみ');assert.equal(themeInsight(t,current).hot,false);
});
test('stale, failed, unknown and future sessions cannot claim a current strong signal',()=>{
 const t=theme('hyperscaler_ai_capex'),now=Date.parse('2026-10-02T08:00:00Z');
 assert.equal(themeFreshness(data,now).usable,true);
 for(const mutate of [d=>d.themes.cached=true,d=>d.themes.error='timeout',d=>d.themes.value.as_of='2026-09-30',d=>d.themes.value.as_of='2026-10-02',d=>delete d.calendar]){
  const d=structuredClone(data);mutate(d);const f=themeFreshness(d,now);assert.equal(f.usable,false);assert.equal(themeInsight(t,f).title,'最新データを確認してから判断');
 }
});
test('freshness is evaluated from the theme date, not newer quotes',()=>{
 const d=structuredClone(data);d.themes.value.as_of='2026-09-30';d.stocks={value:{stocks:[{date:'2026-10-01'}]}};
 assert.equal(themeFreshness(d,Date.parse('2026-10-02T08:00:00Z')).state,'stale');
});
test('partial returns identify coverage and invalid values are not converted to zero',()=>{
 const m={status:'partial',value:.1,eligible_n:1,total_n:2,as_of:'2026-10-01'};
 assert.equal(returnMetric(m).partial,true);for(const extra of [{status:'missing'},{value:null},{value:'0.1'},{eligible_n:0},{eligible_n:3}])assert.equal(returnMetric({...m,...extra}),null);
 assert.equal(returnMetric({...m,status:'ok',value:0,eligible_n:2}).value,0);
});
test('held-theme filter respects memberships, deduplicates brokers and never edits private state',()=>{
 const state={holdings:[{ticker:'MU',quantity:1},{ticker:'MU',quantity:2},{ticker:'AVGO',quantity:1},{ticker:'UNKNOWN',quantity:10}]};
 const before=JSON.stringify({data,state});assert.deepEqual(holdingLinks(theme('memory_hbm'),state),[{ticker:'MU',role:'中核'}]);
 const html=themesView(data,'held',null,state);assert.match(html,/data-theme-id="memory_hbm"/);assert.match(html,/data-theme-id="ai_networking_connectivity"/);assert.doesNotMatch(html,/data-theme-id="power_grid"/);
 assert.equal(JSON.stringify({data,state}),before);
});
test('thin heat-only and observation groups retain all definitions without cross-ranks',()=>{
 const html=themesView(data,'rank');assert.equal((html.match(/data-theme-id=/g)||[]).length,29);
 assert.equal(ranked(data).length,5);assert.doesNotMatch(themeDetail(theme('memory_hbm'),data.phaseA.themes.memory_hbm),/強さ順位の推移/);
 for(const t of data.themes.value.themes.filter(t=>t.score_mode!=='ranked'))assert.doesNotMatch(themeCard(t,0),/比較\d+テーマ中/);
 assert.doesNotMatch(html,/class="future"|先行スコア|失速リスク/);assert.match(html,/予測精度は未検証/);
});
test('empty data, malformed route, HTML text and score boundaries render safely',()=>{
 assert.match(themesView({},'rank'),/再読み込み/);assert.match(themesView(data,'rank','%XX'),/見つかりません/);
 const t=theme('hyperscaler_ai_capex');t.theme_id='custom';t.name='<img src=x onerror=alert(1)>';t.core_members=['<script>'];
 t.data_quality={status:'ok',core_total:5,strength_eligible_n:5,heat_eligible_n:5};
 assert.doesNotMatch(themeCard(t),/<img|<script>/);assert.match(themeCard(t),/&lt;img/);
 for(const [score,label] of [[75,'強い'],[60,'やや強い'],[45,'中立'],[30,'やや弱い'],[0,'弱い']]){t.strength.score=score;assert.equal(themeInsight(t,current).strengthLabel,label);}
 t.strength.score=NaN;assert.equal(themeInsight(t,current).insufficient,true);
});

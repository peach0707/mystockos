import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {breadthViewModel,breadthPanel,earlyThemes,earlyPanel,stockIndicators} from '../assets/js/phase-b.js';

const theme={theme_id:'memory_hbm',heat:{breadth:{now_above:3,past_above:1,eligible_n:4}},turning_watch:{active:true,reasons:['breadth recovering']},velocity:{state:'Improving',confirmed:false}};
test('Breadth renders existing counts, no new factor or source mutation',()=>{
 const before=JSON.stringify(theme);assert.deepEqual(breadthViewModel(theme),{status:'ok',eligible_n:4,now:.75,past:.25,change:.5});
 assert.match(breadthPanel(theme,'2026-09-08'),/75.0%/);assert.equal(JSON.stringify(theme),before);
});
test('Missing or invalid breadth is not zero-filled',()=>{
 for(const b of [undefined,{eligible_n:0,now_above:0,past_above:0},{eligible_n:2,now_above:3,past_above:0},{eligible_n:2,now_above:null,past_above:0}])assert.equal(breadthViewModel({heat:{breadth:b}}).now,null);
 assert.equal(breadthViewModel({heat:{breadth:{eligible_n:2,now_above:0,past_above:0}}}).now,0);
});
test('Early screen preserves exact existing active subset and caution',()=>{
 const items=[theme,{...theme,theme_id:'other',turning_watch:{active:false}}];assert.deepEqual(earlyThemes(items),[theme]);
 const html=earlyPanel(items,'2026-09-08');assert.match(html,/反転兆候 1テーマ/);assert.match(html,/上昇の広がりが回復/);assert.match(html,/未確認/);assert.doesNotMatch(html,/#themes\/other/);
});
test('Stock helpers use Phase A only, retain dates, zero and missing distinction',()=>{
 const html=stockIndicators({return_1d:{value:0,status:'ok',as_of:'2026-09-11'},return_5d:{value:.2,status:'unresolved'},rvol:{value:1.7,status:'ok',as_of:'2026-09-11'}});
 assert.match(html,/>0%<\/b>/);assert.match(html,/1.7x/);assert.match(html,/2026-09-11/);assert.doesNotMatch(html,/20%/);assert.match(stockIndicators(null),/取得待ち/);
});
test('Display strings are escaped',()=>{assert.doesNotMatch(breadthPanel(theme,'<img>'),/<img>/);assert.doesNotMatch(stockIndicators({rvol:{data_source:'<script>'}}),/<script>/);});
test('Frozen breadth display labels match frozen config',()=>{
 const config=JSON.parse(fs.readFileSync('config/scoring_profiles.json','utf8'));
 const profile=Object.values(config).find(v=>v?.breadth_ma_days!==undefined);
 assert.equal(profile.breadth_ma_days,50);assert.equal(profile.breadth_change_days,10);
});

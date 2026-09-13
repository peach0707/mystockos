import test from 'node:test';
import assert from 'node:assert/strict';
import {phaseDetails,rankChange,sortedMembers,memberRows} from '../assets/js/phase-a.js';
test('missing metrics show dashes, not zero returns or invented rank',()=>{
 const html=phaseDetails(null,null);assert.match(html,/取得待ち/);assert.doesNotMatch(html,/NaN|undefined|0\.0%/);assert.match(rankChange(null),/—/);
});
test('member sorting supports four keys, null last, stable ties and no mutation',()=>{
 for(const key of ['return_1d','return_5d','return_21d','rvol']){
  const rows=[{ticker:'A',[key]:{value:null}},{ticker:'B',[key]:{value:0}},{ticker:'C',[key]:{value:.1}},{ticker:'D',[key]:{value:.1}}];
  assert.deepEqual(sortedMembers(rows,key).map(x=>x.ticker),['C','D','B','A']);assert.equal(rows[0].ticker,'A');
 }
});
test('Japanese rows escape provider names, plus red/minus green classes, no horizontal table',()=>{
 const html=memberRows([{ticker:'MU',name:'<script>',role:'core',return_1d:{value:.03},return_5d:{value:-.02},rvol:{value:1.7}}]);
 assert.match(html,/&lt;script&gt;/);assert.match(html,/中核/);assert.match(html,/positive/);assert.match(html,/negative/);assert.match(html,/1.7x/);assert.doesNotMatch(html,/<table|<script>/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readDisplay,saveDisplay,sortTickers,sparkline} from '../assets/js/usability.js';
import {fresh} from '../assets/js/state.js';
import {stocksView} from '../assets/js/decision-ui.js';

test('bad or inaccessible display preferences never block private portfolio loading',()=>{
 assert.deepEqual(readDisplay({getItem:()=>'{bad'}),{hidden:false,density:'compact'});
 assert.deepEqual(readDisplay({getItem:()=>'{"hidden":true,"density":"detail"}'}),{hidden:true,density:'detail'});
 assert.equal(saveDisplay({}, {setItem(){throw Error('full');}}),false);
});
test('sorting and Japanese searching do not mutate the watch list or drop missing quotes',()=>{
 const tickers=['SNDK','MISSING','MU'],s=fresh();s.watch=[...tickers];
 const before=JSON.stringify(s);
 assert.deepEqual(sortTickers(tickers,{},'name',s),['MISSING','MU','SNDK']);
 assert.deepEqual(sortTickers(tickers,{},'up',s),tickers);
 assert.deepEqual(sortTickers(tickers,{},'name',s,'マイクロン'),['MU']);
 const view=stocksView({},s,'watch','',{query:'マイクロン',sort:'name'});
 assert.match(view,/hidden data-stock-ticker="SNDK"/);assert.doesNotMatch(view,/hidden data-stock-ticker="MU"/);
 assert.match(view,/value="マイクロン"/);assert.equal(JSON.stringify(s),before);
});
test('sparkline uses recorded closes only and exposes date count without invented points',()=>{
 assert.match(sparkline([{close:null}]),/推移未取得/);
 assert.match(sparkline([{close:20},{close:20}],'MU'),/直近2営業日/);
 assert.doesNotMatch(sparkline([{close:20},{close:20}]),/NaN|Infinity/);
 assert.match(sparkline([{close:20},{close:22}],'<x>'),/&lt;x&gt;/);
});

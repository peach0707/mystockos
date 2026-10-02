import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {scoreTint,decisionPill} from '../assets/js/visual.js';
import {themeCard} from '../assets/js/themes.js';
test('score colors are presentation only, with neutral missing values',()=>{
 assert.equal(scoreTint('strength',92),'tint-green');
 assert.equal(scoreTint('strength',70),'tint-yellow');
 assert.equal(scoreTint('strength',0),'tint-neutral');
 for(const value of [null,undefined,NaN,'92'])assert.equal(scoreTint('strength',value),'tint-neutral');
 assert.equal(scoreTint('heat',76),'tint-orange');
 assert.equal(scoreTint('heat',51),'tint-yellow');
 assert.equal(scoreTint('heat',20),'tint-green');
 assert.equal(scoreTint('heat',20,true),'tint-orange');
 assert.equal(scoreTint('heat',null,true),'tint-neutral');
 for(const [state,tint] of [['Leading','green'],['Improving','yellow'],['Weakening','orange'],['Lagging','neutral'],[undefined,'neutral']])assert.equal(scoreTint('velocity',null,state),`tint-${tint}`);
});
test('theme reading card preserves score and flags unconfirmed and indicative data',()=>{
 const t={theme_id:'memory_hbm',score_mode:'thin',core_members:['MU','SKHY'],data_quality:{status:'thin',core_total:2,strength_eligible_n:2,heat_eligible_n:2},strength:{score:92},velocity:{state:'Improving',candidate:'Leading',candidate_days:2,confirmed:false},heat:{score:76,hot:false,hot_eligible:false}};
 const before=JSON.stringify(t),html=themeCard(t);
 assert.match(html,/92\/100/);assert.match(html,/76\/100・参考/);
 assert.match(html,/未確認/);assert.match(html,/少数構成・順位なし/);assert.match(html,/参考値のみ/);assert.doesNotMatch(html,/比較\d+テーマ中/);assert.equal(JSON.stringify(t),before);
});
test('decision pills style exact saved labels without inventing a decision',()=>{
 assert.match(decisionPill('hold'),/tint-green/);assert.match(decisionPill('watching','watch'),/tint-blue/);
 assert.match(decisionPill('wait_pullback'),/tint-yellow/);assert.match(decisionPill('判断未記入'),/tint-neutral/);
 assert.match(decisionPill('保有継続とは限らない'),/tint-neutral/);
 assert.equal(decisionPill('<script>'),'<span class="decision-pill tint-neutral">未選択</span>');
});
test('app CSS does not use text smaller than 10px',()=>{
 const css=['app.css','portfolio-v2.css','noir.css'].map(path=>readFileSync(new URL('../assets/'+path,import.meta.url),'utf8')).join('\n');
 const sizes=[...css.matchAll(/font-size:\s*([\d.]+)px/g)].map(m=>Number(m[1]));
 assert.ok(sizes.length>0);assert.ok(sizes.every(n=>n>=10));
});

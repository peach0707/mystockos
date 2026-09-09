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
test('tinted theme row preserves score, unconfirmed state and input',()=>{
 const t={theme_id:'memory_hbm',score_mode:'thin',data_quality:{status:'ok'},strength:{score:92},velocity:{state:'Improving',confirmed:false},heat:{score:76,hot:false}};
 const before=JSON.stringify(t),html=themeCard(t);
 assert.match(html,/score tint-green">92/);assert.match(html,/score tint-orange">76/);
 assert.match(html,/未確認/);assert.match(html,/class="rank">—/);assert.equal(JSON.stringify(t),before);
});
test('decision pills style exact saved labels without inventing a decision',()=>{
 assert.match(decisionPill('hold'),/tint-green/);assert.match(decisionPill('watching','watch'),/tint-blue/);
 assert.match(decisionPill('wait_pullback'),/tint-yellow/);assert.match(decisionPill('判断未記入'),/tint-neutral/);
 assert.match(decisionPill('保有継続とは限らない'),/tint-neutral/);
 assert.equal(decisionPill('<script>'),'<span class="decision-pill tint-neutral">未選択</span>');
});
test('app CSS does not use text smaller than 10px',()=>{
 const css=readFileSync(new URL('../assets/app.css',import.meta.url),'utf8');
 const sizes=[...css.matchAll(/font-size:\s*([\d.]+)px/g)].map(m=>Number(m[1]));
 assert.ok(sizes.length>0);assert.ok(sizes.every(n=>n>=10));
});

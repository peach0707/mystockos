import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createPager,createNavigation,settledIndex} from '../assets/js/pager.js';
class Element {
 constructor(){this.children=[];this.handlers={};this.clientWidth=390;this.scrollLeft=0;this.scrollTop=0;this.dataset={};this.onscrollend=null;this.writes=0;}
 set innerHTML(v){this._htmlValue=v;this.writes++;} get innerHTML(){return this._htmlValue;}
 setAttribute(){} append(el){this.children.push(el);} replaceChildren(...els){this.children=els;}
 addEventListener(name,fn){this.handlers[name]=fn;} scrollTo({left}){this.scrollLeft=left;} focus(){}
}
function fixture(){const events={};const win={addEventListener:(n,f)=>events[n]=f,setTimeout,clearTimeout};const main=new Element();let rendered=0;const tabs=[];const pager=createPager(main,{win,doc:{createElement:()=>new Element()},html:(route,page='')=>{rendered++;return route+page;},onTab:t=>tabs.push(t)});pager.refresh();return {pager,tabs,events,count:()=>rendered};}
test('native snap settles all five pages without rendering or replacing retained DOM',()=>{const {pager,tabs,count}=fixture();const pane=pager.panes[1];pane.scrollTop=438;for(let round=0;round<10;round++)for(const i of [0,1,2,3,4,3,2,1,0]){pager.track.scrollLeft=i*390;pager.track.handlers.scrollend();}assert.equal(count(),5);assert.equal(pager.panes[1],pane);assert.equal(pane.scrollTop,438);assert.equal(tabs.at(-1),'home');});
test('unfinished native scroll does not change selected page or force a snap',()=>{const {pager,tabs}=fixture();pager.track.scrollLeft=181;pager.track.handlers.scrollend();assert.deepEqual(tabs,[]);assert.equal(pager.track.scrollLeft,181);assert.equal(settledIndex(779.5,390),2);assert.equal(settledIndex(0,0),null);});
test('details hide pager; stale scrollend cannot overwrite detail URL; returning retains vertical position',()=>{const {pager,tabs}=fixture();pager.select('stocks');pager.panes[2].scrollTop=620;pager.showDetail('stocks','MU');pager.track.scrollLeft=1170;pager.track.handlers.scrollend();assert.deepEqual(tabs,['stocks']);assert.equal(pager.track.hidden,true);pager.select('stocks');assert.equal(pager.panes[2].scrollTop,620);assert.equal(pager.track.scrollLeft,780);assert.equal(pager.detail.hidden,true);});
test('refresh preserves unchanged DOM and per-page vertical offsets',()=>{const {pager}=fixture();pager.panes[0].scrollTop=200;pager.refresh();assert.equal(pager.panes[0].writes,1);assert.equal(pager.panes[0].scrollTop,200);});
function historyFixture(hash='#home'){
 const events={},entries=[{hash,state:null}];let at=0;
 const win={location:{hash},addEventListener:(n,f)=>events[n]=f};
 win.history={get state(){return entries[at].state;},replaceState(state,_,hash){entries[at]={state,hash:hash||win.location.hash};win.location.hash=entries[at].hash;},pushState(state,_,hash){entries.splice(++at);entries.push({state,hash});win.location.hash=hash;},go(delta){at+=delta;win.location.hash=entries[at].hash;events.popstate();}};
 const seen=[];let nav;nav=createNavigation({win,onTop:tab=>{seen.push(tab);nav.sync(tab);},onDetail:(route,page)=>seen.push(route+'/'+page)});nav.show();return {nav,win,entries,seen};
}
test('100 top-level tab switches replace history rather than pushing entries',()=>{const {nav,entries,win}=historyFixture();for(let n=0;n<100;n++)nav.go(n%2?'#stocks':'#themes');assert.equal(entries.length,1);assert.equal(win.location.hash,'#stocks');});
test('nested details push history; browser Back restores the originating tab',()=>{const {nav,entries,win,seen}=historyFixture();nav.go('#stocks');nav.go('#portfolio/edit');nav.go('#settings');assert.equal(entries.length,3);win.history.go(-1);assert.equal(seen.at(-1),'portfolio/edit');win.history.go(-1);assert.equal(seen.at(-1),'stocks');});
test('top nav from child unwinds owned child entries then replaces tab, without a new history entry',()=>{const {nav,win,seen}=historyFixture();nav.go('#themes');nav.go('#themes/memory_hbm');nav.go('#portfolio');assert.equal(win.location.hash,'#portfolio');assert.equal(seen.at(-1),'portfolio');assert.equal(win.history.state.kabugorilla.depth,0);});
test('direct child deep link can return to a tab without going outside app',()=>{const {nav,win,entries}=historyFixture('#stocks/MU');nav.go('#stocks');assert.equal(win.location.hash,'#stocks');assert.equal(entries.length,1);});
test('top navigation contains no custom touch/transform engine; native snapping CSS and separate news form are present',()=>{const js=readFileSync('assets/js/pager.js','utf8');assert.doesNotMatch(js,/touchstart|touchmove|touchend|preventDefault|translate3d|requestAnimationFrame/);const css=readFileSync('assets/app.css','utf8');assert.match(css,/scroll-snap-type:x mandatory/);assert.doesNotMatch(css,/page-swipe-neighbor/);const views=readFileSync('assets/js/views.js','utf8');assert.match(views,/href="#news\/add"/);});

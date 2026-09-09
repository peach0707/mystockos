import test from 'node:test';
import assert from 'node:assert/strict';
import {bindPageSwipe,SWIPE_ROUTES} from '../assets/js/swipe.js';

function fixture(hash='#themes',{standalone=false,reduced=false}={}){
 const handlers={},windowHandlers={},animations=[],options=[];
 const main={parentElement:null,scrollWidth:390,clientWidth:390,closest:()=>null,isConnected:true,
  addEventListener:(n,f,o)=>{handlers[n]=f;options.push(o);},removeEventListener:n=>delete handlers[n],
  animate:(frames,timing)=>{const a={frames,timing,cancelled:false,cancel(){this.cancelled=true;}};animations.push(a);return a;}};
 const win={location:{hash},innerWidth:390,scrollY:0,navigator:{standalone},getComputedStyle:el=>({overflowX:el.overflowX||'visible'}),
  matchMedia:q=>({matches:q.includes('reduced-motion')?reduced:standalone}),
  addEventListener:(n,f)=>windowHandlers[n]=f,removeEventListener:n=>delete windowHandlers[n]};
 const doc={activeElement:{matches:()=>false},getSelection:()=>({toString:()=>''})};
 const cleanup=bindPageSwipe(main,win,doc);
 const touch=(x=220,y=200,id=1)=>({identifier:id,clientX:x,clientY:y});
 const emit=(name,touches,changedTouches=touches,extra={})=>handlers[name]?.({touches,changedTouches,timeStamp:100,target:main,defaultPrevented:false,...extra});
 const swipe=(dx=-110,dy=0,extra={})=>{emit('touchstart',[touch()],undefined,{timeStamp:0,...extra});emit('touchmove',[touch(220+dx,200+dy)]);emit('touchend',[],[touch(220+dx,200+dy)],{timeStamp:200});};
 return {main,win,doc,emit,touch,swipe,cleanup,options,animations,changed:()=>windowHandlers.hashchange()};
}
test('five parent screens navigate in order in Safari and standalone, without wrapping',()=>{
 for(const standalone of [false,true])for(let i=0;i<5;i++)for(const dir of [-1,1]){
  const f=fixture('#'+SWIPE_ROUTES[i],{standalone});f.swipe(-dir*110);
  assert.equal(f.win.location.hash,'#'+(SWIPE_ROUTES[i+dir]||SWIPE_ROUTES[i]));
 }
 const root=fixture('');root.swipe();assert.equal(root.win.location.hash,'#themes');
});
test('small, diagonal, vertical and slow gestures do not navigate',()=>{
 for(const [dx,dy]of [[-30,0],[-71,0],[-110,70],[0,150],[50,150]]){const f=fixture();f.swipe(dx,dy);assert.equal(f.win.location.hash,'#themes');}
 const f=fixture();f.emit('touchstart',[f.touch()],undefined,{timeStamp:0});f.emit('touchend',[],[f.touch(100)],{timeStamp:900});assert.equal(f.win.location.hash,'#themes');
});
test('a gesture that starts vertically cannot later become a page swipe',()=>{
 const f=fixture();f.emit('touchstart',[f.touch()]);f.emit('touchmove',[f.touch(225,230)]);f.emit('touchend',[],[f.touch(80,230)],{timeStamp:200});assert.equal(f.win.location.hash,'#themes');
});
test('both edges remain available for native browser navigation',()=>{
 for(const x of [0,20,28,362,380,390]){const f=fixture();f.emit('touchstart',[f.touch(x)]);f.emit('touchend',[],[f.touch(x<200?x+110:x-110)],{timeStamp:200});assert.equal(f.win.location.hash,'#themes');}
});
test('child screens, calendar, forms and settings never navigate between parents',()=>{
 for(const route of ['themes/memory_hbm','stocks/MU','portfolio/calendar','portfolio/day','portfolio/edit','settings','themes/','unknown']){const f=fixture('#'+route);f.swipe();assert.equal(f.win.location.hash,'#'+route);}
});
test('interactive targets, their descendants and explicit opt-out regions are excluded',()=>{
 for(const selector of ['input','textarea','select','button','a','label','summary','form','[role="slider"]','[role="dialog"]','[data-page-swipe="off"]','.calendar','.calendar-grid']){
  const f=fixture();const target={...f.main,closest:s=>s.split(',').includes(selector)?{}:null};f.swipe(-110,0,{target});assert.equal(f.win.location.hash,'#themes',selector);
 }
 const f=fixture();f.doc.activeElement.matches=()=>true;f.swipe();assert.equal(f.win.location.hash,'#themes');
 const s=fixture();s.doc.getSelection=()=>({toString:()=> 'selected text'});s.swipe();assert.equal(s.win.location.hash,'#themes');
});
test('horizontal scrolling ancestors and changing vertical scroll take priority',()=>{
 const f=fixture();const target={...f.main,parentElement:f.main,overflowX:'auto',scrollWidth:800};f.swipe(-110,0,{target});assert.equal(f.win.location.hash,'#themes');
 const g=fixture();g.emit('touchstart',[g.touch()]);g.win.scrollY=50;g.emit('touchend',[],[g.touch(80)]);assert.equal(g.win.location.hash,'#themes');
});
test('multi-touch, cancellation, consumed events and route changes cancel the gesture',()=>{
 for(const reason of ['multi','cancel','consumed','route','detached','identifier']){
  const f=fixture();f.emit('touchstart',[f.touch()]);
  if(reason==='multi')f.emit('touchmove',[f.touch(),f.touch(150,210,2)]);
  if(reason==='cancel')f.emit('touchcancel',[]);
  if(reason==='consumed')f.emit('touchmove',[f.touch(150)],undefined,{defaultPrevented:true});
  if(reason==='route')f.win.location.hash='#stocks/MU';
  if(reason==='detached')f.main.isConnected=false;
  f.emit('touchend',[],[f.touch(80,200,reason==='identifier'?2:1)],{timeStamp:200});
  assert.equal(f.win.location.hash,reason==='route'?'#stocks/MU':'#themes',reason);
 }
});
test('swipe animation runs after route change; reduced motion and ordinary navigation skip it',()=>{
 const f=fixture();f.swipe();assert.equal(f.animations.length,0);f.changed();assert.equal(f.animations.length,1);assert.equal(f.animations[0].frames[0].transform,'translateX(24px)');
 f.win.location.hash='#news';f.changed();assert.equal(f.animations.length,1);assert.equal(f.animations[0].cancelled,true);
 const r=fixture('#themes',{reduced:true});r.swipe();r.changed();assert.equal(r.animations.length,0);
 const back=fixture();back.swipe(110);back.changed();assert.equal(back.animations[0].frames[0].transform,'translateX(-24px)');
});
test('listeners are passive and cleanup stops navigation',()=>{
 const f=fixture();assert.equal(f.options.length,4);assert.ok(f.options.every(o=>o.passive===true));f.cleanup();f.swipe();assert.equal(f.win.location.hash,'#themes');
});

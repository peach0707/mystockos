import test from 'node:test';
import assert from 'node:assert/strict';
import {bindPageSwipe,SWIPE_ROUTES} from '../assets/js/swipe.js';
class Element {
 constructor(){this.style={transform:'',transition:'',willChange:''};this.handlers={};this.attrs={};this.parentElement=null;this.scrollWidth=390;this.clientWidth=390;this.isConnected=true;this.childNodes=[];}
 closest(){return null;}
 addEventListener(n,f,o){this.handlers[n]={f,o};}
 removeEventListener(n){delete this.handlers[n];}
 setAttribute(k,v){this.attrs[k]=v;}
 append(el){el.parentElement=this;this.childNodes.push(el);}
 remove(){if(this.parentElement)this.parentElement.childNodes=this.parentElement.childNodes.filter(x=>x!==this);this.parentElement=null;}
}
function fixture(hash='#themes',{standalone=false,reduced=false}={}){
 const main=new Element(),body=new Element(),raf=new Map(),timers=new Map(),windowHandlers={},renders=[];
 let serial=0;
 const win={location:{hash},innerWidth:390,scrollY:0,navigator:{standalone},performance:{now:()=>1000},
  getComputedStyle:el=>({overflowX:el.overflowX||'visible'}),matchMedia:q=>({matches:q.includes('reduced-motion')?reduced:standalone}),
  requestAnimationFrame:fn=>{raf.set(++serial,fn);return serial;},cancelAnimationFrame:id=>raf.delete(id),
  setTimeout:fn=>{timers.set(++serial,fn);return serial;},clearTimeout:id=>timers.delete(id),
  addEventListener:(n,f)=>windowHandlers[n]=f,removeEventListener:n=>delete windowHandlers[n]};
 const doc={body,createElement:()=>new Element(),activeElement:{matches:()=>false},getSelection:()=>({toString:()=>''})};
 const control=bindPageSwipe(main,win,doc,{preview:route=>{renders.push(route);return '<h1>'+route+'</h1>';}});
 const touch=(x=220,y=200,id=1)=>({identifier:id,clientX:x,clientY:y});
 const emit=(name,touches=[],changedTouches=touches,extra={})=>{
  const event={touches,changedTouches,timeStamp:100,target:main,defaultPrevented:false,cancelable:true,preventDefault(){this.defaultPrevented=true;},stopImmediatePropagation(){this.stopped=true;},...extra};
  main.handlers[name]?.f(event);return event;
 };
 const frame=()=>{const batch=[...raf.values()];raf.clear();batch.forEach(f=>f());};
 const settle=()=>{frame();frame();const batch=[...timers.values()];timers.clear();batch.forEach(f=>f());};
 const drag=(dx=-120,dy=0,extra={})=>{emit('touchstart',[touch()],undefined,{timeStamp:0,...extra});const event=emit('touchmove',[touch(220+dx,200+dy)],undefined,{timeStamp:100});frame();return event;};
 const release=(dx=-120,dy=0,time=200)=>emit('touchend',[],[touch(220+dx,200+dy)],{timeStamp:time});
 const swipe=(dx=-120,dy=0,extra={})=>{drag(dx,dy,extra);release(dx,dy);settle();};
 return {main,win,doc,body,raf,timers,renders,control,touch,emit,frame,settle,drag,release,swipe,windowHandlers};
}
test('five-screen order and edges in Safari/standalone; router waits for snap completion',()=>{
 for(const standalone of [false,true])for(let i=0;i<5;i++)for(const dir of [-1,1]){
  const f=fixture('#'+SWIPE_ROUTES[i],{standalone});f.drag(-dir*120);f.release(-dir*120);
  assert.equal(f.win.location.hash,'#'+SWIPE_ROUTES[i]);f.settle();
  assert.equal(f.win.location.hash,'#'+(SWIPE_ROUTES[i+dir]||SWIPE_ROUTES[i]));
 }
 const f=fixture('');f.swipe();assert.equal(f.win.location.hash,'#themes');
});
test('finger follows translate3d before release, coalesced into one RAF without repeated render',()=>{
 const f=fixture();f.emit('touchstart',[f.touch()]);assert.equal(f.renders.length,0);
 for(const x of [200,180,140])f.emit('touchmove',[f.touch(x)]);
 assert.equal(f.main.style.transform,'');assert.equal(f.raf.size,1);f.frame();
 assert.equal(f.main.style.transform,'translate3d(-80px,0,0)');assert.equal(f.main.style.transition,'none');assert.equal(f.main.style.willChange,'transform');
 assert.deepEqual(f.renders,['stocks']);assert.equal(f.body.childNodes[0].style.transform,'translate3d(310px,0,0)');
 for(const x of [130,120,110]){f.emit('touchmove',[f.touch(x)]);f.frame();}
 assert.deepEqual(f.renders,['stocks']);assert.equal(f.win.location.hash,'#themes');
});
test('release uses 240ms transition and hands existing neighbor DOM to the router',()=>{
 const f=fixture();f.drag();const pane=f.body.childNodes[0];assert.equal(pane.attrs['aria-hidden'],'true');assert.ok(Object.hasOwn(pane.attrs,'inert'));
 f.release();assert.equal(f.main.style.transition,'none');f.frame();f.frame();assert.match(f.main.style.transition,/transform 240ms/);
 assert.equal(f.main.style.transform,'translate3d(-390px,0,0)');assert.equal(pane.style.transform,'translate3d(0px,0,0)');
 f.emit('transitionend',[],[],{propertyName:'transform'});assert.equal(f.win.location.hash,'#stocks');assert.equal(f.main.style.willChange,'');
 assert.equal(f.control.takePrepared('stocks'),pane);assert.equal(f.body.childNodes.length,0);assert.deepEqual(f.renders,['stocks']);
});
test('sub-threshold slow drag smoothly returns without route or DOM change',()=>{
 const f=fixture();f.drag(-55);f.release(-55,0,400);f.frame();f.frame();
 assert.match(f.main.style.transition,/240ms/);assert.equal(f.main.style.transform,'translate3d(0px,0,0)');
 f.settle();assert.equal(f.win.location.hash,'#themes');assert.equal(f.body.childNodes.length,0);assert.equal(f.main.style.transform,'');assert.equal(f.main.style.willChange,'');
});
test('recent flick can commit short movement; pauses and tiny flicks cannot',()=>{
 const f=fixture();f.emit('touchstart',[f.touch()],undefined,{timeStamp:0});f.emit('touchmove',[f.touch(180)],undefined,{timeStamp:40});f.release(-40,0,60);f.settle();assert.equal(f.win.location.hash,'#stocks');
 const paused=fixture();paused.drag(-55);paused.release(-55,0,800);paused.settle();assert.equal(paused.win.location.hash,'#themes');
 const small=fixture();small.emit('touchstart',[small.touch()],undefined,{timeStamp:0});small.release(-20,0,20);small.settle();assert.equal(small.win.location.hash,'#themes');
});
test('reversing direction shows only the relevant neighbor and builds each at most once',()=>{
 const f=fixture();f.drag(-50);f.emit('touchmove',[f.touch(280)]);f.frame();assert.deepEqual(f.renders,['stocks','home']);
 assert.equal(f.body.childNodes[0].style.visibility,'hidden');assert.equal(f.main.style.transform,'translate3d(60px,0,0)');
 f.emit('touchmove',[f.touch(150)]);f.frame();assert.deepEqual(f.renders,['stocks','home']);f.control.cancel();assert.equal(f.body.childNodes.length,0);
});
test('clearly vertical motion releases immediately and is never prevented',()=>{
 for(const [dx,dy]of [[-30,60],[-70,100],[0,100]]){
  const f=fixture();const event=f.drag(dx,dy);assert.equal(event.defaultPrevented,false);f.release(dx,dy);f.settle();assert.equal(f.win.location.hash,'#themes');assert.equal(f.body.childNodes.length,0);
 }
 const f=fixture();f.drag(-30);const e=f.emit('touchmove',[f.touch(180,290)]);assert.equal(e.defaultPrevented,false);assert.equal(f.main.style.transform,'');assert.equal(f.body.childNodes.length,0);
 f.release(-180,60);f.settle();assert.equal(f.win.location.hash,'#themes');
});
test('edges, child pages and settings do not start page drag',()=>{
 for(const x of [0,20,28,362,380,390]){const f=fixture();f.emit('touchstart',[f.touch(x)]);f.release(-120);f.settle();assert.equal(f.win.location.hash,'#themes');assert.equal(f.renders.length,0);}
 for(const route of ['themes/memory_hbm','stocks/MU','portfolio/calendar','portfolio/day','portfolio/edit','settings','themes/','unknown']){const f=fixture('#'+route);f.swipe();assert.equal(f.win.location.hash,'#'+route);assert.equal(f.renders.length,0);}
});
test('controls, focus, selection and horizontal scrolling regions remain native',()=>{
 for(const selector of ['input','textarea','select','button','label','summary','form','[role="slider"]','[role="dialog"]','[data-page-swipe="off"]','.calendar','.calendar-grid']){
  const f=fixture(),target=new Element();target.closest=s=>s.split(',').includes(selector)?{}:null;f.swipe(-120,0,{target});assert.equal(f.win.location.hash,'#themes',selector);
 }
 for(const kind of ['focus','selection','horizontal']){const f=fixture();if(kind==='focus')f.doc.activeElement.matches=()=>true;if(kind==='selection')f.doc.getSelection=()=>({toString:()=> 'selected'});if(kind==='horizontal'){f.main.overflowX='auto';f.main.scrollWidth=800;}f.swipe();assert.equal(f.renders.length,0);}
});
test('cancel, multi-touch, resize, pagehide, scroll and external render remove all drag state',()=>{
 for(const reason of ['multi','cancel','resize','pagehide','scroll','render','uncancelable','consumed','identifier']){
  const f=fixture();f.drag(-70);
  if(reason==='multi')f.emit('touchmove',[f.touch(120),f.touch(130,200,2)]);
  if(reason==='cancel')f.emit('touchcancel');
  if(['resize','pagehide'].includes(reason))f.windowHandlers[reason]();
  if(reason==='scroll'){f.win.scrollY=40;f.windowHandlers.scroll();}
  if(reason==='render')f.control.cancel();
  if(reason==='uncancelable')f.emit('touchmove',[f.touch(100)],undefined,{cancelable:false});
  if(reason==='consumed')f.emit('touchmove',[f.touch(100)],undefined,{defaultPrevented:true});
  if(reason==='identifier')f.emit('touchmove',[f.touch(100,200,9)]);
  f.release();f.settle();assert.equal(f.win.location.hash,'#themes',reason);assert.equal(f.body.childNodes.length,0);assert.equal(f.main.style.willChange,'');
 }
});
test('route changes mid-gesture cannot commit stale data; pending prepared pane is discarded on render',()=>{
 const f=fixture();f.drag();f.win.location.hash='#stocks/MU';f.release();f.settle();assert.equal(f.body.childNodes.length,0);assert.equal(f.win.location.hash,'#stocks/MU');
 const g=fixture();g.swipe();assert.equal(g.body.childNodes.length,1);g.control.cancel();assert.equal(g.body.childNodes.length,0);assert.equal(g.control.takePrepared('stocks'),null);
});
test('reduced motion still tracks finger but skips release transition; cleanup restores preexisting styles',()=>{
 const f=fixture('#themes',{reduced:true});f.main.style.transition='opacity 100ms';f.drag();assert.equal(f.main.style.transform,'translate3d(-120px,0,0)');
 f.release();assert.equal(f.win.location.hash,'#stocks');assert.equal(f.timers.size,0);assert.equal(f.main.style.transition,'opacity 100ms');f.control.destroy();assert.equal(f.body.childNodes.length,0);
});
test('start/end are passive, only horizontal move is consumed and post-drag ghost click is suppressed',()=>{
 const f=fixture();assert.equal(f.main.handlers.touchstart.o.passive,true);assert.equal(f.main.handlers.touchend.o.passive,true);assert.equal(f.main.handlers.touchmove.o.passive,false);
 assert.equal(f.drag().defaultPrevented,true);f.release();const click=f.emit('click');assert.equal(click.defaultPrevented,true);assert.equal(click.stopped,true);
 f.control.destroy();f.settle();assert.equal(f.win.location.hash,'#themes');assert.equal(f.body.childNodes.length,0);assert.equal(f.raf.size,0);
});
test('theme/stock link rows and nested text can drag, while taps still open the link',()=>{
 for(const route of ['themes','stocks'])for(const nested of [false,true]){
  const f=fixture('#'+route),link=new Element(),target=nested?new Element():link;
  link.closest=s=>s.split(',').includes('a')?link:null;target.closest=link.closest;target.parentElement=nested?link:f.main;
  f.emit('touchstart',[f.touch()],undefined,{target});f.release(2,1);assert.equal(f.emit('click',[],[],{target,detail:1}).defaultPrevented,false);
  f.swipe(-75,35,{target});assert.equal(f.win.location.hash,'#'+(route==='themes'?'stocks':'news'));
  assert.equal(f.emit('click',[],[],{target,detail:1}).defaultPrevented,true);
  // A new intentional tap is allowed immediately, not swallowed by the old drag.
  f.emit('touchstart',[f.touch()],undefined,{target});f.release(1,0);
  assert.equal(f.emit('click',[],[],{target,detail:1}).defaultPrevented,false);
 }
});
test('6px horizontal lock follows light diagonals; under 6px remains a tap',()=>{
 const f=fixture();f.drag(-5,2);assert.equal(f.raf.size,0);assert.equal(f.renders.length,0);assert.equal(f.main.style.transform,'');
 f.emit('touchmove',[f.touch(214,203)]);f.frame();assert.equal(f.main.style.transform,'translate3d(-6px,0,0)');
});
test('slightly diagonal gestures and vertical wobble after lock work in both directions',()=>{
 for(const direction of [-1,1]){
  const f=fixture();f.drag(direction*8,4);f.emit('touchmove',[f.touch(220+direction*30,230)]);f.frame();
  assert.equal(f.main.style.transform,`translate3d(${direction*30}px,0,0)`);
  f.release(direction*75,55,900);f.settle();assert.equal(f.win.location.hash,direction<0?'#stocks':'#home');
  const direct=fixture();direct.swipe(direction*75,55);assert.equal(direct.win.location.hash,direction<0?'#stocks':'#home');
 }
});
test('uncertain direction waits; initially vertical gesture never relocks as horizontal',()=>{
 const f=fixture();f.drag(-8,8);assert.equal(f.renders.length,0);f.emit('touchmove',[f.touch(200,210)]);f.frame();assert.equal(f.main.style.transform,'translate3d(-20px,0,0)');
 const vertical=fixture();vertical.drag(-3,8);vertical.release(-100,30);vertical.settle();assert.equal(vertical.win.location.hash,'#themes');
});
test('slow drag commits at 17% viewport width, but below threshold returns',()=>{
 for(const width of [375,390,430])for(const above of [false,true]){
  const f=fixture();f.win.innerWidth=width;const dx=-(width*0.17+(above?1:-1));
  f.drag(dx,25);f.release(dx,25,1000);f.settle();assert.equal(f.win.location.hash,above?'#stocks':'#themes');
 }
});
test('24px flick at 0.4px/ms commits; slower or shorter flick does not',()=>{
 for(const [distance,time,expected]of [[24,60,'#stocks'],[24,80,'#themes'],[23,30,'#themes'],[28,60,'#stocks']]){
  const f=fixture();f.emit('touchstart',[f.touch()],undefined,{timeStamp:0});f.release(-distance,8,time);f.settle();assert.equal(f.win.location.hash,expected);
 }
});
test('drag-return suppresses link click, keyboard activation is preserved',()=>{
 const f=fixture();f.drag(-30);f.release(-30,0,800);f.settle();assert.equal(f.win.location.hash,'#themes');
 assert.equal(f.emit('click',[],[],{detail:1}).defaultPrevented,true);
 assert.equal(f.emit('click',[],[],{detail:0}).defaultPrevented,false);
});

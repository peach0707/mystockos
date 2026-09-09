// Navigation and presentation only. No business or saved-state dependencies.
export const SWIPE_ROUTES=Object.freeze(['home','themes','stocks','news','portfolio']);
const BLOCKED='input,textarea,select,button,a,label,summary,form,[contenteditable]:not([contenteditable="false"]),[role="button"],[role="slider"],[role="tab"],[role="dialog"],dialog,[data-page-swipe="off"],.calendar,.calendar-grid';
const EDITABLE='input,textarea,select,[contenteditable]:not([contenteditable="false"])';
const routeOf=hash=>SWIPE_ROUTES.includes(hash.replace(/^#/,''))?hash.replace(/^#/,''):hash===''||hash==='#'?'home':null;
const duration=240;

export function bindPageSwipe(main,win=window,doc=document,{preview=()=>null}={}){
 let gesture=null,prepared=null,suppressClickUntil=0;
 const selected=()=>!!doc.getSelection()?.toString();
 function blocked(target){
  if(!target?.closest||target.closest(BLOCKED))return true;
  for(let el=target;el;el=el.parentElement){
   if(/^(auto|scroll)$/.test(win.getComputedStyle(el).overflowX)&&el.scrollWidth>el.clientWidth+2)return true;
   if(el===main)break;
  }
  return false;
 }
 function cleanup(g){
  if(!g)return;
  if(g.frame)win.cancelAnimationFrame(g.frame);
  if(g.timer)win.clearTimeout(g.timer);
  main.removeEventListener('transitionend',g.finished);
  for(const pane of g.panes.values())pane.remove();
  if(g.original)Object.assign(main.style,g.original);
 }
 function cancel(){const g=gesture;gesture=null;prepared?.pane.remove();prepared=null;cleanup(g);}
 function start(event){
  if(gesture?.phase==='settling')return;
  cancel();
  const route=routeOf(win.location.hash),touch=event.touches[0];
  if(!route||event.defaultPrevented||event.touches.length!==1||blocked(event.target)||doc.activeElement?.matches(EDITABLE)||selected())return;
  // Preserve Safari's back/forward edge gestures in both browser and standalone.
  if(touch.clientX<=28||touch.clientX>=win.innerWidth-28)return;
  gesture={route,id:touch.identifier,x:touch.clientX,y:touch.clientY,scroll:win.scrollY,width:win.innerWidth,
   target:event.target,phase:'pending',dx:0,dy:0,frame:0,timer:0,panes:new Map(),samples:[{x:0,t:event.timeStamp}]};
 }
 function track(touch,time){
  const g=gesture;if(!g)return false;
  const dx=touch.clientX-g.x,dy=touch.clientY-g.y,x=Math.abs(dx),y=Math.abs(dy);
  // Release immediately on vertical/diagonal intent, even after horizontal lock.
  if((Math.max(x,y)>=10&&x<=y*1.6)||selected()){cancel();return false;}
  g.dx=dx;g.dy=dy;
  if(g.phase==='pending'&&x>=10){
   g.phase='dragging';
   g.original={transform:main.style.transform,transition:main.style.transition,willChange:main.style.willChange};
   main.style.transition='none';main.style.willChange='transform';
  }
  g.samples.push({x:dx,t:time});
  while(g.samples.length>2&&time-g.samples[1].t>100)g.samples.shift();
  return true;
 }
 function neighbor(g,direction){
  const route=SWIPE_ROUTES[SWIPE_ROUTES.indexOf(g.route)+direction];
  if(!route)return null;
  if(!g.panes.has(direction)){
   // Only the actual neighbor, once per direction per gesture. Never all 5 pages.
   const html=preview(route);
   if(typeof html!=='string')return null;
   const pane=doc.createElement('div');pane.className='page-swipe-neighbor';
   pane.setAttribute('aria-hidden','true');pane.setAttribute('inert','');
   pane.innerHTML=html;pane.style.transition='none';pane.style.willChange='transform';
   pane.style.transform=`translate3d(${direction*g.width}px,0,0)`;
   doc.body.append(pane);g.panes.set(direction,pane);
  }
  return g.panes.get(direction);
 }
 function paint(g){
  const direction=g.dx<0?1:-1;
  g.next=SWIPE_ROUTES[SWIPE_ROUTES.indexOf(g.route)+direction];g.direction=direction;
  g.pane=neighbor(g,direction);
  for(const [side,pane]of g.panes)pane.style.visibility=side===direction?'visible':'hidden';
  const offset=g.next?Math.max(-g.width,Math.min(g.width,g.dx)):Math.max(-40,Math.min(40,g.dx*0.18));
  main.style.transform=`translate3d(${offset}px,0,0)`;
  if(g.pane)g.pane.style.transform=`translate3d(${direction*g.width+offset}px,0,0)`;
 }
 function schedule(g){
  if(g.frame)return;
  g.frame=win.requestAnimationFrame(()=>{g.frame=0;if(gesture===g&&g.phase==='dragging')paint(g);});
 }
 function move(event){
  const g=gesture;if(!g||g.phase==='settling')return;
  if(event.defaultPrevented||event.touches.length!==1){cancel();return;}
  const touch=[...event.touches].find(t=>t.identifier===g.id);
  if(!touch){cancel();return;}
  if(!track(touch,event.timeStamp)||g.phase!=='dragging')return;
  // Only a confirmed horizontal drag consumes movement. Vertical scroll and
  // pinch zoom are never prevented at touchstart or before direction lock.
  if(!event.cancelable){cancel();return;}
  event.preventDefault();schedule(g);
 }
 function finish(g,commit){
  if(gesture!==g)return;
  // Keep the prepared DOM until the router consumes it synchronously.
  if(commit&&g.pane){prepared={route:g.next,pane:g.pane};g.panes.delete(g.direction);}
  gesture=null;cleanup(g);
  if(commit)win.location.hash='#'+g.next;
 }
 function end(event){
  const g=gesture;if(!g||g.phase==='settling')return;
  const touch=[...event.changedTouches].find(t=>t.identifier===g.id);
  if(!touch||event.touches.length||event.defaultPrevented||!g.target.isConnected||routeOf(win.location.hash)!==g.route){cancel();return;}
  if(!track(touch,event.timeStamp)||g.phase!=='dragging'){cancel();return;}
  if(g.frame)win.cancelAnimationFrame(g.frame);g.frame=0;
  paint(g);g.phase='settling';suppressClickUntil=win.performance.now()+400;
  const sample=g.samples[0],elapsed=event.timeStamp-sample.t;
  const velocity=elapsed>0?(g.dx-sample.x)/elapsed:0;
  const distance=Math.abs(g.dx),horizontal=distance>Math.abs(g.dy)*1.8;
  const flick=distance>=32&&Math.abs(velocity)>=0.5&&Math.sign(velocity)===Math.sign(g.dx);
  const commit=!!g.next&&horizontal&&(distance>=Math.max(72,g.width*0.25)||flick);
  const reduced=win.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if(reduced){finish(g,commit);return;}
  // Two RAFs let the final drag position paint before enabling transitions;
  // there is no forced layout read. Move frames only write transforms.
  g.frame=win.requestAnimationFrame(()=>{g.frame=win.requestAnimationFrame(()=>{
   g.frame=0;if(gesture!==g)return;
   const transition=`transform ${duration}ms cubic-bezier(.22,.61,.36,1)`;
   main.style.transition=transition;
   if(g.pane)g.pane.style.transition=transition;
   main.style.transform=`translate3d(${commit?-g.direction*g.width:0}px,0,0)`;
   if(g.pane)g.pane.style.transform=`translate3d(${commit?0:g.direction*g.width}px,0,0)`;
   g.finished=e=>{if(e.target===main&&e.propertyName==='transform')finish(g,commit);};
   main.addEventListener('transitionend',g.finished);
   g.timer=win.setTimeout(()=>finish(g,commit),duration+60);
  });});
 }
 function takePrepared(route){
  const result=prepared?.route===route?prepared.pane:null;
  prepared?.pane.remove();prepared=null;return result;
 }
 function abort(){prepared?.pane.remove();cancel();}
 const scroll=()=>{if(gesture&&Math.abs(win.scrollY-gesture.scroll)>12)abort();};
 const click=event=>{if(win.performance.now()<suppressClickUntil){event.preventDefault();event.stopImmediatePropagation();}};
 const listeners={touchstart:start,touchmove:move,touchend:end,touchcancel:abort};
 for(const [name,handler]of Object.entries(listeners))main.addEventListener(name,handler,{passive:name!=='touchmove'});
 main.addEventListener('click',click,true);
 // app.render calls cancel/takePrepared before changing DOM; browser/back,
 // normal nav, data refresh and form rerender cannot leave a stale overlay.
 win.addEventListener('scroll',scroll,{passive:true});
 win.addEventListener('resize',abort);win.addEventListener('pagehide',abort);
 return {cancel:abort,takePrepared,destroy(){abort();for(const [name,handler]of Object.entries(listeners))main.removeEventListener(name,handler);main.removeEventListener('click',click,true);win.removeEventListener('scroll',scroll);win.removeEventListener('resize',abort);win.removeEventListener('pagehide',abort);}};
}

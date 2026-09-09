// Navigation only: no portfolio, score, or saved-state dependencies.
export const SWIPE_ROUTES=Object.freeze(['home','themes','stocks','news','portfolio']);
const BLOCKED='input,textarea,select,button,a,label,summary,form,[contenteditable]:not([contenteditable="false"]),[role="button"],[role="slider"],[role="tab"],[role="dialog"],dialog,[data-page-swipe="off"],.calendar,.calendar-grid';
const EDITABLE='input,textarea,select,[contenteditable]:not([contenteditable="false"])';
const routeOf=hash=>SWIPE_ROUTES.includes(hash.replace(/^#/,''))?hash.replace(/^#/,''):hash===''||hash==='#'?'home':null;

export function bindPageSwipe(main,win=window,doc=document){
 let gesture=null,pending=null,animation=null;
 const reset=()=>{gesture=null;};
 function blocked(target){
  if(!target?.closest||target.closest(BLOCKED))return true;
  // Preserve native horizontal scrolling, charts, sliders and future carousels.
  for(let el=target;el;el=el.parentElement){
   const style=win.getComputedStyle(el);
   if(/^(auto|scroll)$/.test(style.overflowX)&&el.scrollWidth>el.clientWidth+2)return true;
   if(el===main)break;
  }
  return false;
 }
 const selected=()=>!!doc.getSelection()?.toString();
 function start(event){
  reset();
  const route=routeOf(win.location.hash),touch=event.touches[0];
  if(!route||event.defaultPrevented||event.touches.length!==1||blocked(event.target)||doc.activeElement?.matches(EDITABLE)||selected())return;
  // Leave both screen edges to Safari back/forward gestures, including in PWA.
  if(touch.clientX<=28||touch.clientX>=win.innerWidth-28)return;
  gesture={route,id:touch.identifier,x:touch.clientX,y:touch.clientY,time:event.timeStamp,scroll:win.scrollY,target:event.target,locked:false};
 }
 function movement(touch){
  if(!gesture)return null;
  const dx=touch.clientX-gesture.x,dy=touch.clientY-gesture.y,x=Math.abs(dx),y=Math.abs(dy);
  // Once a vertical/diagonal intent is seen, never reinterpret that gesture.
  if((Math.max(x,y)>=12&&x<=y*1.6)||Math.abs(win.scrollY-gesture.scroll)>12){reset();return null;}
  if(x>=12)gesture.locked=true;
  return {dx,x,y};
 }
 function move(event){
  if(!gesture)return;
  if(event.defaultPrevented||event.touches.length!==1){reset();return;}
  const touch=[...event.touches].find(t=>t.identifier===gesture.id);
  if(!touch){reset();return;}
  movement(touch);
 }
 function end(event){
  if(!gesture)return;
  const touch=[...event.changedTouches].find(t=>t.identifier===gesture.id);
  if(!touch||event.touches.length||event.defaultPrevented||selected()||!gesture.target.isConnected||routeOf(win.location.hash)!==gesture.route){reset();return;}
  const delta=movement(touch),g=gesture;reset();
  if(!g||!delta||!g.locked||delta.x<72||delta.x<=delta.y*1.8||event.timeStamp-g.time>700)return;
  const direction=delta.dx<0?1:-1,next=SWIPE_ROUTES[SWIPE_ROUTES.indexOf(g.route)+direction];
  if(!next)return; // No wrap from the last screen to the first.
  pending={hash:'#'+next,direction};
  win.location.hash=pending.hash;
 }
 function changed(){
  reset();animation?.cancel();animation=null;
  const next=pending;pending=null;
  // Registered after the existing hash renderer; that renderer owns nav/focus.
  if(next?.hash!==win.location.hash||win.matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  animation=main.animate?.([{transform:`translateX(${next.direction*24}px)`,opacity:0.8},{transform:'translateX(0)',opacity:1}],{duration:170,easing:'ease-out'});
 }
 const listeners={touchstart:start,touchmove:move,touchend:end,touchcancel:reset};
 for(const [name,handler]of Object.entries(listeners))main.addEventListener(name,handler,{passive:true});
 // Never preventDefault or change touch-action: browser scrolling/zoom wins.
 win.addEventListener('hashchange',changed);
 win.addEventListener('pagehide',reset);
 return ()=>{for(const [name,handler]of Object.entries(listeners))main.removeEventListener(name,handler);win.removeEventListener('hashchange',changed);win.removeEventListener('pagehide',reset);reset();animation?.cancel();};
}

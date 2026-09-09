// Native scrolling only: no touch interception, gesture thresholds or animation loop.
export const TAB_ROUTES=Object.freeze(['home','themes','stocks','news','portfolio']);
export function parseRoute(hash){const [route='home',page='']=hash.replace(/^#/,'').split('/');return {route:route||'home',page};}
export function settledIndex(left,width){if(width<=0)return null;const i=Math.round(left/width);return i>=0&&i<TAB_ROUTES.length&&Math.abs(left-i*width)<=2?i:null;}
export function createPager(main,{html,onTab,win=window,doc=document}){
 const track=doc.createElement('div');track.className='tab-pager';track.setAttribute('aria-label','メイン画面');
 const panes=TAB_ROUTES.map(route=>{const el=doc.createElement('section');el.className='tab-page';el.dataset.route=route;el.setAttribute('aria-label',({home:'ホーム',themes:'テーマ',stocks:'銘柄',news:'ニュース',portfolio:'保有'})[route]);track.append(el);return el;});
 const detail=doc.createElement('div');detail.className='detail-page';detail.tabIndex=-1;detail.hidden=true;main.replaceChildren(track,detail);
 let current=0,visible=true,timer;
 function settle(){if(!visible)return;const i=settledIndex(track.scrollLeft,track.clientWidth);if(i===null)return;current=i;panes.forEach((p,n)=>{p.inert=n!==i;});onTab(TAB_ROUTES[i]);}
 // scrollend is authoritative where available. Older Safari gets a read-only idle fallback.
 track.addEventListener('scrollend',settle);
 if(!('onscrollend' in track))track.addEventListener('scroll',()=>{win.clearTimeout(timer);timer=win.setTimeout(settle,180);},{passive:true});
 function select(route){current=TAB_ROUTES.indexOf(route);if(current<0)current=0;visible=true;detail.hidden=true;track.hidden=false;panes.forEach((p,n)=>{p.inert=n!==current;});track.scrollTo({left:current*track.clientWidth,behavior:'instant'});onTab(TAB_ROUTES[current]);}
 function refresh(){panes.forEach((p,i)=>{const next=html(TAB_ROUTES[i]);if(p._html!==next){const top=p.scrollTop;p.innerHTML=next;p._html=next;p.scrollTop=top;}});}
 function showDetail(route,page){visible=false;track.hidden=true;detail.hidden=false;detail.innerHTML=html(route,page);detail.scrollTop=0;detail.focus({preventScroll:true});}
 // A resized viewport must retain its selected tab. Never correct position on scroll.
 let width=track.clientWidth;
 const resize=()=>{const next=track.clientWidth;if(!visible||!next||next===width)return;width=next;track.scrollTo({left:current*next,behavior:'instant'});};
 win.addEventListener('resize',resize);
 return {select,refresh,showDetail,detail,track,panes};
}

// Tab entries replace the current URL. Only child screens push history.
export function createNavigation({win=window,onTop,onDetail}){
 let pendingTab=null;
 const h=win.history;
 const show=()=>{const {route,page}=parseRoute(win.location.hash);if(TAB_ROUTES.includes(route)&&!page)onTop(route);else onDetail(route,page);};
 const sync=route=>h.replaceState({...h.state,kabugorilla:{tab:route,depth:0}},'',`#${route}`);
 const go=hash=>{const {route,page}=parseRoute(hash);const state=h.state?.kabugorilla||{tab:'home',depth:0};
  if(TAB_ROUTES.includes(route)&&!page){if(state.depth>0){pendingTab=route;h.go(-state.depth);}else onTop(route);return;}
  h.pushState({...h.state,kabugorilla:{...state,depth:state.depth+1}},'',`#${route}${page?'/'+page:''}`);show();
 };
 // popstate also covers browser Back/Forward and same-document fragment navigation.
 win.addEventListener('popstate',()=>{if(pendingTab){const tab=pendingTab;pendingTab=null;onTop(tab);}else show();});
 if(!h.state?.kabugorilla)h.replaceState({...h.state,kabugorilla:{tab:'home',depth:0}},'');
 return {go,show,sync};
}

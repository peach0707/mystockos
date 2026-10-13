import {esc,num,pct,tone} from './ui.js';
import {companyName,normalizeSearch,searchText} from './company-names.js';
import {quoteFor} from './setups.js';
import {listingFor} from './symbols.js';

const KEY='mystockos.display.v1';
export function readDisplay(storage){
 try{storage??=globalThis.localStorage;const v=JSON.parse(storage?.getItem(KEY)||'{}');return {hidden:v.hidden===true,density:v.density==='detail'?'detail':'compact'};}catch{return {hidden:false,density:'compact'};}
}
export function saveDisplay(value,storage){try{storage??=globalThis.localStorage;storage?.setItem(KEY,JSON.stringify(value));return true;}catch{return false;}}

export function sortTickers(tickers,data,sort='saved',state={},query=''){
 const rows=tickers.filter(t=>normalizeSearch(searchText(t,state.securities?.[t]?.name||listingFor(t)?.name)).includes(normalizeSearch(query)));
 if(sort==='name')return rows.sort((a,b)=>a.localeCompare(b));
 if(!['up','down'].includes(sort))return rows;
 return rows.sort((a,b)=>{const x=quoteFor(data,a)?.day,y=quoteFor(data,b)?.day;
  if(!Number.isFinite(x))return Number.isFinite(y)?1:0;if(!Number.isFinite(y))return -1;
  return (sort==='up'?y-x:x-y)||a.localeCompare(b);
 });
}

export function sparkline(history=[],ticker=''){
 const rows=history.slice(-21).filter(r=>Number.isFinite(r.close)&&r.close>0);
 if(rows.length<2)return '<span class="spark-empty">推移未取得</span>';
 const values=rows.map(r=>r.close),lo=Math.min(...values),hi=Math.max(...values),span=hi-lo||1;
 const points=values.map((v,i)=>`${(i/(values.length-1)*76+2).toFixed(1)},${(29-(v-lo)/span*25).toFixed(1)}`).join(' ');
 return `<svg class="mini-spark ${tone(values.at(-1)-values[0])}" viewBox="0 0 80 34" role="img" aria-label="${esc(ticker)} 直近${rows.length}営業日の終値推移"><polyline points="${points}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

export function homeWatch(data,s){
 const held=[...new Set(s.holdings.map(h=>h.ticker))],tickers=held.length?held:s.watch;
 if(!tickers.length)return '';
 const sorted=sortTickers(tickers,data).sort((a,b)=>Math.abs(quoteFor(data,b)?.day||0)-Math.abs(quoteFor(data,a)?.day||0)).slice(0,4);
 return `<section class="home-watch"><div class="section-heading"><h2>${held.length?'保有株':'監視銘柄'}の値動き</h2><button class="text-button" data-stock-scope="${held.length?'held':'watch'}">すべて見る ›</button></div><p class="section-note">前営業日比の変化が大きい順 · 株価ベース</p><div class="watch-snapshot">${sorted.map(t=>{const q=quoteFor(data,t);return `<a href="#stocks/${encodeURIComponent(t)}"><span class="snapshot-symbol"><b>${esc(t)}</b><small>${esc(companyName(t)||s.securities?.[t]?.name||'')}</small><small class="snapshot-date">${esc(q?.date?.slice(5).replace('-','/')||'未取得')} ${q?.closed?'終値':'未確定'}</small></span><span>${sparkline(data.setups?.value?.stocks?.[t]?.history,t)}</span><span class="snapshot-price"><b>${q?.price? (q.currency==='JPY'?'¥':'$')+num(q.price,2):'—'}</b><small class="${tone(q?.day)}">${pct(q?.day)}</small></span></a>`;}).join('')}</div></section>`;
}

const originals=new WeakMap(),labels=new WeakMap();
export function applyDisplay(doc,prefs){
 doc.documentElement.dataset.density=prefs.density;
 doc.documentElement.dataset.amounts=prefs.hidden?'hidden':'visible';
 doc.querySelectorAll('[data-private-label]').forEach(el=>{if(!labels.has(el))labels.set(el,el.getAttribute('aria-label'));el.setAttribute('aria-label',prefs.hidden?el.dataset.privateLabel+' 金額は非表示':labels.get(el));});
 doc.querySelectorAll('[data-private]').forEach(el=>{
  if(prefs.hidden&&!originals.has(el)){
   const fragment=doc.createDocumentFragment();while(el.firstChild)fragment.append(el.firstChild);originals.set(el,fragment);
   el.textContent='••••';el.setAttribute('aria-label','金額は非表示');
  }else if(!prefs.hidden&&originals.has(el)){el.replaceChildren(originals.get(el));originals.delete(el);el.removeAttribute('aria-label');}
 });
 doc.querySelectorAll('[data-toggle-amounts]').forEach(b=>{b.setAttribute('aria-pressed',String(prefs.hidden));b.setAttribute('aria-label',prefs.hidden?'資産の金額を表示':'資産の金額を隠す');b.title=prefs.hidden?'金額を表示':'金額を隠す';});
 doc.querySelectorAll('[data-density]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.density===prefs.density)));
}

export function displaySwitch(){return '<div class="density-switch" role="group" aria-label="保有一覧の表示"><button data-density="compact">一覧</button><button data-density="detail">詳細</button></div>';}

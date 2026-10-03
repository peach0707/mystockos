import {ownTickers,relation,articleKey,articleVersion,dedupeNews} from './news-model.js';
import {quoteFor,setupFor} from './setups.js';
import {dateState,timeLabel} from './freshness.js';
import {esc,num,pct} from './ui.js';

// A separate, bounded device-local observation. Never feeds a decision or Shadow.
export function captureMorning(s,data,now=Date.now()){
 const old=s.morningBrief||{rows:{},news:null},next=structuredClone(old);let changed=false;
 if(!data.setups?.cached&&!data.setups?.error){
  for(const t of ownTickers(s)){
   const q=quoteFor(data,t,now),check=setupFor(data,t,now);
   if(!q?.closed||q.cached||q.fetchFailed||!Number.isFinite(q.price)||q.price<=0||dateState(q.date,data.calendar?.value,now).state!=='current')continue;
   const current={date:q.date,price:q.price,currency:q.currency||'USD',code:check.ready?check.code:null,label:check.label,observedAt:new Date(now).toISOString()},prior=old.rows[t]?.current;
   if(prior&&prior.date>q.date)continue;
   if(prior&&['date','price','currency','code'].every(k=>prior[k]===current[k]))continue;
   next.rows[t]={current,previous:prior||null};changed=true;
  }
 }
 const p=data.news?.value;
 // A partial feed can supply articles, but is never evidence that nothing happened.
 if(p&&!data.news.cached&&!data.news.error&&p.status!=='failed'&&now-Date.parse(p.checked_at)<=8*3600000&&Date.parse(p.checked_at)<=now){
  const keys=Object.fromEntries(dedupeNews(p.articles).map(n=>[articleKey(n),articleVersion(n)]));
  if(JSON.stringify(keys)!==JSON.stringify(old.news?.current?.keys)){
   next.news={current:{checkedAt:p.checked_at,keys},previous:old.news?.current||null};changed=true;
  }
 }
 if(changed){const keep=new Set(ownTickers(s));next.rows=Object.fromEntries(Object.entries(next.rows).filter(([t])=>keep.has(t)));s.morningBrief=next;}return changed;
}
export function importantChanges(data,s,now=Date.now()){
 return ownTickers(s).map(t=>{
  const check=setupFor(data,t,now),q=quoteFor(data,t,now),stored=s.morningBrief?.rows?.[t],previous=stored?.previous,current=stored?.current;
  const comparable=!!previous&&!!current&&q?.closed&&!q.cached&&!q.fetchFailed&&q.date===current.date&&q.price===current.price&&current.currency===previous.currency&&dateState(q.date,data.calendar?.value,now).state==='current'&&!data.setups?.error&&!data.setups?.cached;
  const change=comparable?(current.price/previous.price-1)*100:null;
  const transition=comparable&&check.ready&&previous.code&&check.code!==previous.code;
  return {ticker:t,check,previous,current,change,transition,comparable,important:!!transition||change!==null&&Math.abs(change)>=3};
 }).sort((a,b)=>Number(b.important)-Number(a.important)||Math.abs(b.change||0)-Math.abs(a.change||0));
}
export function changesView(data,s){
 const rows=importantChanges(data,s),important=rows.filter(r=>r.important),waiting=rows.filter(r=>!r.comparable);
 return `<section class="morning-changes"><div class="section-heading"><h2>前回からの重要な変化</h2><a href="#stocks">銘柄を見る ›</a></div>${important.slice(0,3).map(r=>`<a class="change-card" href="#stocks/${esc(r.ticker)}"><div class="row"><strong>${esc(r.ticker)}</strong><span class="tag">${r.transition?'条件の変化':'価格の変化'}</span></div><p>${r.transition?esc(r.previous.label)+' → '+esc(r.check.label):'前回取得した終値から '+pct(r.change)}</p><small>米国 ${esc(r.previous.date)} → ${esc(r.current.date)} · ${esc(timeLabel(r.current.observedAt))}確認</small><dl><dt>事実</dt><dd>終値 ${num(r.previous.price,2)} → ${num(r.current.price,2)} ${esc(r.current.currency)}</dd><dt>次に確認</dt><dd>${esc(r.check.buy)}</dd></dl></a>`).join('')||`<div class="quiet-state"><strong>${!rows.length?'銘柄を選ぶと確認できます':waiting.length===rows.length?'前回データを蓄積しています':'比較できた銘柄に重要な変化はありません'}</strong><p>${!rows.length?'気になる銘柄だけで始められます。':waiting.length===rows.length?'初回・追加直後・取得不足の銘柄は、変化を判定しません。':'前回取得値との条件の変化、または3%以上の価格変化を表示します。'}</p></div>`}${waiting.length?`<p class="method-note">${esc(waiting.map(r=>r.ticker).join('・'))}：前回比較なし、または最新データの確認待ち</p>`:''}${important.length>3?`<a href="#stocks">ほか${important.length-3}件は銘柄画面で確認 ›</a>`:''}<small class="method-note">前回取得との比較です。売買の推奨ではありません。</small></section>`;
}
export function newsNovelty(n,s){
 const previous=s.morningBrief?.news?.previous,key=articleKey(n);
 if(!previous)return '初回確認';
 if(!(key in previous.keys))return Date.parse(n.published_at)<Date.parse(previous.checkedAt)-7*86400000?'新たに取得した過去記事':'新着';
 return previous.keys[key]!==articleVersion(n)?'要約・内容の更新':'確認済み';
}
export function validateMorning(s){
 const b=s.morningBrief;if(b===undefined)return;
 const stamp=x=>typeof x==='string'&&Number.isFinite(Date.parse(x));
 const point=x=>x&&/^\d{4}-\d{2}-\d{2}$/.test(x.date)&&Number.isFinite(x.price)&&x.price>0&&['USD','JPY'].includes(x.currency)&&typeof x.label==='string'&&x.label.length<200&&(x.code===null||typeof x.code==='string'&&x.code.length<40)&&stamp(x.observedAt);
 const news=x=>x&&stamp(x.checkedAt)&&x.keys&&typeof x.keys==='object'&&!Array.isArray(x.keys)&&Object.keys(x.keys).length<=500&&Object.entries(x.keys).every(([k,v])=>k.length<2500&&typeof v==='string'&&v.length<2000);
 if(!b||!b.rows||typeof b.rows!=='object'||Array.isArray(b.rows)||Object.keys(b.rows).length>10000||Object.entries(b.rows).some(([t,r])=>!/^[A-Z0-9.^=-]{1,20}$/.test(t)||!point(r?.current)||r.previous!==null&&!point(r.previous))||b.news!==null&&(!news(b.news?.current)||b.news.previous!==null&&!news(b.news.previous)))throw Error('前回比較データの形式が不正です。');
}

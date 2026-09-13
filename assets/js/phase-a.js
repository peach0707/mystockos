import {esc,pct} from './ui.js';

export async function loadPhaseA(){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
 try{const r=await fetch(new URL('../../data/phase_a.json',import.meta.url),{cache:'no-store',signal:controller.signal});
  if(!r.ok)return null;const d=await r.json();
  return d?.schema_version==='phase_a_v1'&&d.usage==='display_and_observation_only'&&d.themes&&typeof d.themes==='object'?d:null;
 }catch{return null;}finally{clearTimeout(timer);}
}
const value=m=>typeof m?.value==='number'&&Number.isFinite(m.value)?m.value:null;
const color=v=>v===null?'':v>0?'positive':v<0?'negative':'';
const amount=m=>{const v=value(m);return `<b class="${color(v)}">${v===null?'—':pct(v*100)}</b>`;};
const volume=m=>value(m)===null?'—':`${value(m).toFixed(1)}x`;
const count=n=>Number.isInteger(n)&&n>=0?String(n):'—';
const coverage=m=>m&&Number.isInteger(m.total_n)?`${count(m.eligible_n)} / ${count(m.total_n)} 銘柄`:'取得待ち';
export function rankChange(m){const n=m?.rank_change_5d;return typeof n==='number'&&Number.isFinite(n)?`<small class="phase-rank-change">5日前比 ${n>0?'↑'+n:n<0?'↓'+Math.abs(n):'→'}</small>`:'<small class="phase-rank-change">順位推移 —</small>';}

export function sortedMembers(rows,key){
 const allowed=['return_1d','return_5d','return_21d','rvol'];if(!allowed.includes(key))key='return_1d';
 return rows.map((row,i)=>({row,i})).sort((a,b)=>{
  const av=value(a.row[key]),bv=value(b.row[key]);return av===null?(bv===null?a.i-b.i:1):bv===null?-1:bv-av||a.i-b.i;
 }).map(x=>x.row);
}
export function memberRows(rows,key='return_1d'){
 return sortedMembers(rows,key).map(m=>`<a class="phase-member" href="#stocks/${encodeURIComponent(m.ticker)}"><span class="phase-member-heading"><strong>${esc(m.ticker)}</strong><span>${esc(m.name||m.ticker)}</span><em>${esc({core:'中核',related:'関連',watch:'観察'}[m.role]||'—')}</em></span><span class="phase-member-values"><span><small>1日</small>${amount(m.return_1d)}</span><span><small>5日</small>${amount(m.return_5d)}</span><span><small>1ヶ月</small>${amount(m.return_21d)}</span><span><small>RVOL</small><b>${volume(m.rvol)}</b></span></span></a>`).join('');
}
export function phaseDetails(m,asOf){
 return `<section class="phase-a-detail"><h2>期間別リターン</h2><p class="muted">価格リターン・配当を含まない／中核銘柄の有効値を均等平均</p><div class="phase-returns">${[[1,'1日'],[5,'5日'],[21,'1ヶ月'],[63,'3ヶ月']].map(([n,label])=>`<div><span>${label}</span>${amount(m?.['return_'+n+'d'])}<small>${coverage(m?.['return_'+n+'d'])}</small></div>`).join('')}</div><h2>出来高の状況</h2><div class="phase-volume"><span>テーマRVOL <b>${volume(m?.rvol)}</b></span><span>1.0倍超 ${m?.rvol?count(m.rvol_elevated_n)+' / '+count(m.rvol.eligible_n):'—'}<small>有効 ${coverage(m?.rvol)}</small></span></div><p class="muted">中核銘柄の中央値。各銘柄は当日出来高 ÷ 前20営業日の平均。売買推奨ではありません。</p><h2>強さ順位の推移</h2><div class="phase-ranks">${[[5,'5日前'],[3,'3日前'],[1,'1日前'],[0,'現在']].map(([n,label])=>`<span><small>${label}</small><b>${Number.isInteger(m?.rank_history?.[n]?.rank)?m.rank_history[n].rank+'位':'—'}</b></span>`).join('')}</div><h2>構成銘柄を比較</h2><label class="phase-sort">並び順 <select data-phase-sort><option value="return_1d">1日リターン</option><option value="return_5d">5日リターン</option><option value="return_21d">1ヶ月リターン</option><option value="rvol">RVOL</option></select></label><div data-phase-members>${memberRows(m?.members||[])||'<p class="muted">構成銘柄データは取得待ちです。</p>'}</div><p class="muted">基準日 ${esc(asOf||'—')} · 1ヶ月=21営業日、3ヶ月=63営業日。欠損値・履歴未蓄積は「—」。</p></section>`;
}
export function bindPhaseSort(getMetric){
 document.addEventListener('change',event=>{
  if(!event.target.matches('[data-phase-sort]'))return;
  const section=event.target.closest('.phase-a-detail'),target=section?.querySelector('[data-phase-members]');
  if(target)target.innerHTML=memberRows(getMetric()?.members||[],event.target.value);
 });
}

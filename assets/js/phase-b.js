// Read-only presentation of frozen output and Phase A observations.
import {esc,pct,label} from './ui.js';
import {themeName,ja} from './display-ja.js';

export function breadthViewModel(theme){
 const b=theme?.heat?.breadth,n=b?.eligible_n;
 const valid=Number.isInteger(n)&&n>0&&[b?.now_above,b?.past_above].every(x=>Number.isInteger(x)&&x>=0&&x<=n);
 return {status:valid?'ok':'insufficient',eligible_n:valid?n:null,now:valid?b.now_above/n:null,past:valid?b.past_above/n:null,change:valid?(b.now_above-b.past_above)/n:null};
}
const percent=x=>x===null?'—':`${(x*100).toFixed(1)}%`;
export function breadthPanel(theme,asOf){
 const b=breadthViewModel(theme);
 return `<section class="phase-b"><h2>上昇の広がり</h2><p class="muted">50日移動平均を上回る中核銘柄の割合</p><div class="phase-b-grid"><div><small>現在</small><b>${percent(b.now)}</b></div><div><small>10営業日前</small><b>${percent(b.past)}</b></div><div><small>変化</small><b>${b.change===null?'—':`${b.change>0?'+':''}${(b.change*100).toFixed(1)}pt`}</b></div></div><p class="muted">有効 ${b.eligible_n??'—'} 銘柄 · テーマ基準日 ${esc(asOf||'—')}${b.status!=='ok'?' · データ不足':''}。既存の過熱度内訳を表示しています。</p></section>`;
}
export const earlyThemes=themes=>themes.filter(t=>t.turning_watch?.active);
export function earlyPanel(themes,asOf){
 const active=earlyThemes(themes);
 return `<section class="phase-b"><p class="muted">反転兆候 ${active.length}テーマ · 基準日 ${esc(asOf||'—')}。既存条件の該当のみ。先行予測・買い推奨ではありません。</p>${active.map(t=>`<article class="phase-b-early"><a href="#themes/${encodeURIComponent(t.theme_id)}"><strong>${esc(themeName(t))}</strong><span class="badge">反転兆候 ›</span></a><p>${esc((t.turning_watch.reasons||[]).map(ja).join(' / ')||'判定理由は取得待ち')}</p><p class="muted">勢い ${esc(label(t.velocity?.state))} · ${t.velocity?.state?(t.velocity.confirmed?'確認済み':'未確認'):'データ不足'}${t.turning_watch.stress_caution?' · 市場ストレスに注意':''}</p>${breadthPanel(t,asOf)}</article>`).join('')||'<p>反転兆候に該当するテーマはありません。</p>'}</section>`;
}
const finite=m=>m?.status==='ok'&&typeof m.value==='number'&&Number.isFinite(m.value)?m.value:null;
export function stockIndicators(stock){
 return `<section class="phase-b"><h2>価格・出来高の補助指標</h2><div class="phase-b-grid phase-b-stock">${[[1,'1日'],[5,'5日'],[21,'1ヶ月'],[63,'3ヶ月']].map(([n,title])=>{const m=stock?.['return_'+n+'d'],v=finite(m);return `<div><small>${title}</small><b class="${v>0?'positive':v<0?'negative':''}">${v===null?'—':pct(v*100)}</b><small>${esc(m?.as_of||'取得待ち')}</small></div>`;}).join('')}</div><p>RVOL <b>${finite(stock?.rvol)===null?'—':finite(stock.rvol).toFixed(1)+'x'}</b><small> · 基準日 ${esc(stock?.rvol?.as_of||'—')}</small></p><p class="muted">1ヶ月=21営業日、3ヶ月=63営業日。価格リターン（配当を含まない）。RVOLは当日出来高 ÷ 前20営業日の平均。欠損は「—」、売買判断には使用しません。</p><p class="muted">情報源 ${esc(stock?.return_1d?.data_source||stock?.rvol?.data_source||'取得待ち')} · テーマ指標とは基準日が異なる場合があります。</p></section>`;
}

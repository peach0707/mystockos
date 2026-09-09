import {esc} from './ui.js';
export const RATIONALE_VERSION=1;
export const MAX_RATIONALES=5;
// Fixed manual thesis vocabulary; labels may evolve without reusing enum meanings.
export const RATIONALES=Object.freeze({theme_growth:'テーマ成長',earnings_growth:'業績成長',undervaluation:'割安',supply_demand:'需給',technology_edge:'技術優位',catalyst:'カタリスト',market_share:'市場シェア',policy_tailwind:'政策追い風'});
export const validTags=tags=>Array.isArray(tags)&&tags.length<=MAX_RATIONALES&&tags.every(x=>typeof x==='string'&&Object.hasOwn(RATIONALES,x))&&new Set(tags).size===tags.length;
const canonical=tags=>Object.keys(RATIONALES).filter(k=>tags.includes(k));
export function recordRationales(s,ticker,tags,recordedAt=new Date().toISOString(),id=crypto.randomUUID()){
 if(!validTags(tags))throw Error('投資根拠は選択肢から最大5個まで選んでください。');
 const held=s.holdings.some(h=>h.ticker===ticker),watch=s.watch.includes(ticker);
 if(!held&&!watch)throw Error('登録済みの銘柄を選んでください。');
 const before=canonical(s.rationales[ticker]||[]),after=canonical(tags);
 if(JSON.stringify(before)===JSON.stringify(after))return;
 s.rationales[ticker]=after;
 s.rationaleHistory.push({id,recorded_at:recordedAt,ticker,security_id:s.securities?.[ticker]?.id||null,contexts:[...(held?['held']:[]),...(watch?['watch']:[])],before,after:[...after],added:after.filter(x=>!before.includes(x)),removed:before.filter(x=>!after.includes(x)),source:'manual',enum_version:RATIONALE_VERSION});
}
export function toggleRationale(s,ticker,tag){
 if(typeof tag!=='string'||!Object.hasOwn(RATIONALES,tag))throw Error('投資根拠の選択肢が不正です。');
 const tags=s.rationales[ticker]||[];
 recordRationales(s,ticker,tags.includes(tag)?tags.filter(x=>x!==tag):[...tags,tag]);
}
export function rationaleFields(tags=[]){
 return `<fieldset class="rationale-fields"><legend>投資根拠（最大5個）</legend><div class="rationale-options">${Object.entries(RATIONALES).map(([key,label])=>`<label class="rationale-option"><input type="checkbox" name="rationaleTags" value="${key}" ${tags.includes(key)?'checked':''}><span>${label}</span></label>`).join('')}</div><small>現在維持している根拠を選択してください。</small></fieldset>`;
}
export function rationaleDetail(s,ticker){
 const tags=s.rationales[ticker]||[],events=s.rationaleHistory.filter(x=>x.ticker===ticker);
 const names=values=>values.map(x=>RATIONALES[x]).join('・')||'なし';
 return `<section class="rationale-detail"><div class="row"><h2>投資根拠</h2><strong>維持中 ${tags.length} / ${MAX_RATIONALES}件</strong></div><small>自分で選択した根拠・タップで切り替え</small><div class="rationale-options">${Object.entries(RATIONALES).map(([key,label])=>`<button type="button" class="rationale-toggle" data-rationale-ticker="${esc(ticker)}" data-rationale-tag="${key}" aria-pressed="${tags.includes(key)}" ${tags.length>=MAX_RATIONALES&&!tags.includes(key)?'disabled':''}><span aria-hidden="true">${tags.includes(key)?'✓':'＋'}</span> ${label}</button>`).join('')}</div><small>最大5個。選択を外すと別の根拠を追加できます。</small>${events.length?`<details><summary>投資根拠の変更履歴（${events.length}件）</summary>${events.slice(-10).reverse().map(e=>`<div class="rationale-event"><time datetime="${esc(e.recorded_at)}">${esc(new Date(e.recorded_at).toLocaleString('ja-JP'))}</time><p>追加：${esc(names(e.added))}<br>解除：${esc(names(e.removed))}</p></div>`).join('')}<small>直近10件を表示。全履歴はバックアップに含まれます。</small></details>`:''}</section>`;
}

import {esc,num,field} from './ui.js';
import {picker,listingFor} from './symbols.js';
import {decisionSelect} from './decisions.js';
import {rationaleFields} from './rationales.js';
import {findHolding,holdingKey,brokerName} from './holdings.js';

const unit=(cost,currency)=>`${currency==='USD'?'$':'¥'}${num(cost,6)}`;
export function holdingForm(s,editKey='',addTicker=''){
 const h=editKey?findHolding(s,editKey):null;
 if(editKey&&!h)return '<section class="card"><p>編集する保有が見つかりません。保有一覧から開き直してください。</p><a href="#portfolio">保有一覧へ</a></section>';
 const ticker=h?.ticker||addTicker;
 const existing=s.holdings.find(row=>row.ticker===ticker);
 return `<section class="card"><h2>${h?'保有の内訳を編集':'保有銘柄を登録'}</h2><p class="holding-help">証券会社ごとの株数と取得単価を入力すると、同じ銘柄を合算します。</p><form id="holding-form"><input type="hidden" name="holding_id" value="${esc(h?holdingKey(h):'')}">${picker('ticker',ticker,false,s.securities?.[ticker]||listingFor(ticker))}${field('broker','証券会社（任意）','text',`list="holding-brokers" maxlength="60" placeholder="楽天証券・moomoo証券など" value="${esc(h?.broker||'')}"`)}<datalist id="holding-brokers">${['楽天証券','moomoo証券','SBI証券','その他'].map(b=>`<option value="${b}"></option>`).join('')}</datalist>${field('quantity','株数','number',`required min="0" step="any" value="${esc(h?.quantity??'')}"`)}${field('cost','1株あたり取得単価','number',`required min="0" step="any" value="${esc(h?.cost??'')}"`)}<label>取得単価の通貨<select name="currency"><option value="USD" ${(h?.currency||existing?.currency)==='USD'?'selected':''}>米ドル</option><option value="JPY" ${(h?.currency||existing?.currency)==='JPY'?'selected':''}>日本円</option></select></label><p class="holding-help">${h?'この登録分だけを変更します。':'今回追加する分だけを入力してください。登録済みの株数には加算されます。'} 保有判断と投資根拠は同じ銘柄で共通です。</p>${decisionSelect('held',h?.decision||existing?.decision)}${rationaleFields(s.rationales[ticker]||[])}<button>保存</button>${h?`<button type="button" class="danger" data-remove-holding="${esc(holdingKey(h))}">この登録分を削除</button>`:''}</form></section>`;
}

export function positionsHTML(r){
 return `<details class="holding-positions"><summary>証券会社別の内訳（${r.positions.length}件）</summary>${r.positions.map(h=>`<div class="holding-position" data-position="${esc(holdingKey(h))}"><div><b>${esc(brokerName(h))}</b><span>${num(h.quantity,6)}株 · 取得単価 ${unit(h.cost,h.currency)}</span></div><button class="subtle" data-edit-holding="${esc(holdingKey(h))}" aria-label="${esc(r.ticker)}・${esc(brokerName(h))}の登録分を編集">編集</button></div>`).join('')}</details><button class="subtle holding-add" data-add-holding="${esc(r.ticker)}">＋ この銘柄を追加</button>`;
}

export function averageCostHTML(r){
 return r.costBreakdown.map(c=>`<span>${unit(c.averageCost,c.currency)}${r.costBreakdown.length>1?`<small>${num(c.quantity,6)}株分</small>`:''}</span>`).join('<br>');
}

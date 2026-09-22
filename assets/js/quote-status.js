import {quoteFor} from './setups.js';
import {dateState} from './freshness.js';
import {esc} from './ui.js';

// Registration and valuation share the same quote status. A searchable security
// is not proof of price coverage; a stale quote is not an up-to-date quote.
export function quoteStatus(data,ticker,now=Date.now()){
 const q=quoteFor(data,ticker,now),row=data.setups?.value?.stocks?.[ticker];
 if(q?.closed&&Number.isFinite(q.price)&&q.price>0){
  const stale=dateState(q.date,data.calendar?.value,now).state!=='current'||q.quality==='stale'||!!data.setups?.cached;
  return {code:stale?'stale':'current',usable:true,label:stale?'前回終値で参考評価':'価格自動更新',
   detail:stale?`${q.date}の終値を使用中。最新の価格は次回の定期取得で再確認します。`:`${q.date}の終値を取得済み。保存後に株数から評価額を自動計算します。`};
 }
 if(!data.setups?.value)return {code:'checking',usable:false,label:'価格の取得状況を確認中',detail:'公開データを読み込めていません。更新ボタンで再確認してください。'};
 if(!row)return {code:'unsupported',usable:false,label:'価格自動取得の対象外',detail:'この銘柄は検索できますが、現在の自動取得対象には含まれません。登録だけでは評価額は表示されません。'};
 const failure=row.failure;
 const reason=failure==='rate_limited'?'取得元の利用上限に達したため、次回の定期取得で再試行します。':
  failure==='secret_missing'?'価格取得サービスの設定を確認する必要があります。':
  failure==='unavailable'||failure==='http_404'?'取得元がこの銘柄の価格を返していません。次回の定期取得で再確認します。':
  failure==='unclosed_bar'?'確定した終値を待っています。次回の定期取得で再確認します。':
  failure==='identity_or_currency_mismatch'?'取得元の銘柄・通貨が一致しないため、価格を使用していません。':
  failure==='incomplete_history'?'価格履歴に欠けがあるため、次回の定期取得で再確認します。':
  '自動取得対象です。未取得分は次回の定期取得で再試行します。';
 return {code:'pending',usable:false,label:'価格未取得・自動取得待ち',detail:reason};
}

export function holdingQuoteNotice(ticker,data,editing=false){
 if(!ticker)return '<p class="holding-help">銘柄を選ぶと価格の取得状況を確認できます。</p>';
 const status=quoteStatus(data,ticker);
 return `<div class="${status.code==='current'?'holding-help':'warning'}"><b>${esc(ticker)}：${esc(status.label)}</b><p>${esc(status.detail)}</p>${!status.usable&&!editing?'<label class="quote-confirm"><input type="checkbox" name="quote_ack" required><span>評価額が未表示になることを確認し、保有情報だけ保存する</span></label>':''}</div>`;
}

export function validateQuoteConsent(data,ticker,acknowledged,editing=false){
 if(!editing&&!quoteStatus(data,ticker).usable&&!acknowledged)throw Error('価格が未取得です。取得状況を確認し、保有情報だけ保存する場合は確認欄を選択してください。');
}

export function updateHoldingQuoteNotice(form,data){
 const target=form?.querySelector('[data-holding-quote]');if(!target)return;
 const ticker=form.elements.ticker_id.value?form.elements.ticker.value:'';
 const html=holdingQuoteNotice(ticker,data,!!form.elements.holding_id.value);
 if(target.dataset.noticeHtml!==html){if(target.innerHTML!==html)target.innerHTML=html;target.dataset.noticeHtml=html;}
}

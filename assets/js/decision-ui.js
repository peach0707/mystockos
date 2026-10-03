import {companyName,searchText} from './company-names.js';
import {memoryRelevant} from './news-model.js';
import {changesView} from './morning.js';
import {esc,num,pct,tone,empty,tabs,label} from './ui.js';
import {picker,listingFor,isLeveraged} from './symbols.js';
import {list,ranked,memberships} from './themes.js';
import {themeName} from './display-ja.js';
import {themeInsight,themeFreshness} from './theme-insights.js';
import {decisionPill,decisionSelect} from './decisions.js';
import {rationaleDetail} from './rationales.js';
import {stockIndicators} from './phase-b.js';
import {quoteFor,setupFor} from './setups.js';
import {freshnessBar,updateDetails} from './freshness.js';
import {newsPreview,articlesFor,newsCard} from './news-ui.js';
import {marketContext,memoryWatch} from './market-context.js';
import {homePortfolio} from './valuation-ui.js';

const money=n=>Number.isFinite(n)?'$'+num(n,2):'—';
const ownTickers=s=>[...new Set([...s.holdings.map(h=>h.ticker),...s.watch])];
export function stockCard(data,s,ticker,requestedScope=null){
 const check=setupFor(data,ticker),price=check.quote,held=s.holdings.find(h=>h.ticker===ticker),scope=requestedScope||(held?'held':'watch');
 const saved=(scope==='held'?held?.decision:s.watchDecisions[ticker])||'unset';
 return `<a class="stock-row decision-card" href="#stocks/${encodeURIComponent(ticker)}" data-stock-ticker="${esc(ticker)}" data-stock-search="${esc(searchText(ticker,s.securities?.[ticker]?.name||listingFor(ticker)?.name))}"><div class="decision-top"><div><strong>${esc(ticker)}</strong><span class="company-name">${esc(companyName(ticker)||s.securities?.[ticker]?.name||listingFor(ticker)?.name||'')}</span><small>${held?'保有銘柄':s.watch.includes(ticker)?'監視銘柄':'主要銘柄'}</small></div><div class="quote"><b>${money(price?.price)}</b><span class="${tone(price?.day)}">${pct(price?.day)}</span></div></div><div class="decision-line"><span class="tag ${check.tint}">${esc(check.label)}</span>${saved!=='unset'?decisionPill(saved,scope):''}<span class="chevron">›</span></div><p>${esc(check.reason)}</p><small class="quote-date">米国 ${esc(price?.date||'価格未取得')} · ${price?.closed?'終値':'日足・未確定'}</small></a>`;
}
export function homeView(data,s){
 const tickers=ownTickers(s);
 return `<div class="page-heading"><div><span class="eyebrow">持ち株の変化を、毎朝1分で。</span><h1>今日のまとめ</h1></div><span class="day-label">${new Date().toLocaleDateString('ja-JP',{timeZone:'Asia/Tokyo',month:'numeric',day:'numeric',weekday:'short'})}</span></div>${freshnessBar(data)}${!tickers.length?`<section class="card onboarding"><h2>気になる銘柄を選びましょう</h2><p>まずは1銘柄から。株数や取得単価は後から登録できます。</p><a class="button" href="#stocks/add">銘柄を選んで始める</a><a class="restore-link" href="#settings">バックアップから復元する ›</a></section>`:''}${homePortfolio(s,data)|| (tickers.length?`<section class="card asset-start"><h2>資産と増減</h2><p>選んだ${tickers.length}銘柄を確認中。株数を登録すると評価額も見られます。</p><a href="#portfolio/edit">保有株を登録する ›</a></section>`:'')}${changesView(data,s)}<section class="morning-news"><div class="section-heading"><h2>自分に関係するニュース</h2><a href="#news">すべて見る ›</a></div>${newsPreview(data,s)}</section><details class="card home-more"><summary>もう少し詳しく見る</summary>${memoryRelevant(s)?memoryWatch(data):''}<h2>自分の銘柄</h2><div class="decision-list">${tickers.slice(0,5).map(t=>stockCard(data,s,t)).join('')}</div><a class="restore-link" href="#stocks">すべての銘柄を見る ›</a>${marketContext(data)}<a class="restore-link" href="#themes">テーマの詳しい分析 ›</a></details>${s.policy?`<section class="card"><h2>自分の確認事項</h2><p>${esc(s.policy)}</p></section>`:''}${updateDetails(data)}<a class="restore-link" href="#settings">表示設定・バックアップ ›</a>`;
}

function chart(setup){
 const rows=(setup?.history||[]).filter(r=>Number.isFinite(r.close));
 if(rows.length<2)return '';
 const values=rows.map(r=>r.close),low=Math.min(...values),high=Math.max(...values),range=high-low||1;
 const points=values.map((v,i)=>`${(i/(values.length-1)*320).toFixed(1)},${(92-(v-low)/range*75).toFixed(1)}`).join(' ');
 return `<figure class="price-chart"><svg viewBox="0 0 320 108" role="img" aria-label="${esc(setup.ticker)}の直近${rows.length}営業日の終値推移"><defs><linearGradient id="stock-chart-wash" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#298eff" stop-opacity=".35"/><stop offset="100%" stop-color="#298eff" stop-opacity="0"/></linearGradient></defs><polygon points="0,94 ${points} 320,94" fill="url(#stock-chart-wash)"/><path d="M0 94H320M0 55H320M0 16H320" stroke="#e8eef4" fill="none"/><polyline points="${points}" fill="none" stroke="#1677ff" stroke-width="2.5" stroke-linejoin="round"/></svg><figcaption><span>${esc(rows[0].date)}</span><span>終値 ${money(low)}〜${money(high)}</span><span>${esc(rows.at(-1).date)}</span></figcaption></figure>`;
}
function checkPanel(check){
 const p=check.setup;
 return `<section class="card conditions-panel"><div class="row"><h2>変化の根拠と確認ポイント</h2><span class="tag ${check.tint}">${esc(check.label)}</span></div><p><span class="tag">${check.ready?'観測した事実':'未確認'}</span> ${esc(check.reason)}</p><p class="muted">米国 ${esc(p?.as_of||'基準日未取得')} 時点。以下は条件付きの解釈です。</p><div class="condition-block buy"><span class="condition-icon">＋</span><div><h3>次に確認すること</h3><p>${esc(check.buy)}</p></div></div><div class="condition-block sell"><span class="condition-icon">−</span><div><h3>保有中の確認事項</h3><p>${esc(check.sell)}</p></div></div>${check.ready?`<div class="price-levels"><div><small>押し目の確認位置<br>20日移動平均</small><b>${money(p.ma20)}</b></div><div><small>上抜けの確認位置<br>直近20日終値高値</small><b>${money(p.prior_high20)}</b></div><div><small>トレンドの確認位置<br>50日移動平均</small><b>${money(p.ma50)}</b></div><div><small>崩れの確認位置<br>直近20日終値安値</small><b>${money(p.prior_low20)}</b></div></div><details><summary>条件と計算の根拠</summary><p>終値と移動平均、前日までの20営業日の終値高値・安値で確認します。過熱は14日単純RSIが70以上、または20日平均から10%以上の乖離。押し目候補の位置は20日平均の±3%です。出来高の確認は前20日平均の1.2倍を目安にしています。</p><p>過去の利益率を検証した売買モデルではありません。表示価格は自動注文や目標株価ではありません。決算・業績・投資根拠も合わせて判断してください。</p><small>${esc(p.source)} · ${esc(p.as_of)} 日足 · 配当を含まない価格</small></details>`:'<p class="method-note">欠損・古い日付では、売買の条件を判定しません。</p>'}</section>`;
}
export function stocksView(data,s,tab='watch',page=''){
 if(page==='add')return `<a class="back" href="#stocks">‹ 銘柄一覧</a><h1>監視銘柄を追加</h1><section class="card"><form id="watch-form">${picker()}<button>監視銘柄に登録</button></form></section>`;
 if(page){
  const ticker=decodeURIComponent(page),held=s.holdings.find(h=>h.ticker===ticker),watch=s.watch.includes(ticker),check=setupFor(data,ticker),p=check.quote,themes=memberships(data,ticker),related=articlesFor(data,s).filter(n=>[...n.direct_tickers,...n.related_tickers].includes(ticker)).slice(0,3);
  return `<a class="back" href="#stocks">‹ 銘柄一覧</a><section class="stock-heading"><div><span class="eyebrow">${held?'保有銘柄':watch?'監視銘柄':'銘柄チェック'}</span><h1>${esc(ticker)}</h1><p>${esc(companyName(ticker)||s.securities?.[ticker]?.name||listingFor(ticker)?.name||'')}</p></div><div class="quote"><strong>${money(p?.price)}</strong><span class="${tone(p?.day)}">${pct(p?.day)}</span></div></section><p class="muted">米国 ${esc(p?.date||'価格未取得')} ${p?.closed?'終値':'日足・未確定'} · ${esc(p?.source||'Twelve Data')}</p>${isLeveraged(s.securities?.[ticker]||listingFor(ticker))?'<p class="warning">レバレッジ・インバースETFです。日々の値動きを対象とする商品で、複数日では原資産の騰落率×倍率にはなりません。ETF自身の価格で評価しています。</p>':''}${chart(check.setup)}${checkPanel(check)}${held||watch?`<section class="card"><h2>自分の判断と投資根拠</h2>${held?`<p>${decisionPill(held.decision,'held')}</p><button data-manage-holding="${esc(ticker)}">保有・判断を編集</button>`:''}${watch?`<form data-form="watch-decision-form"><input type="hidden" name="ticker" value="${esc(ticker)}">${decisionSelect('watch',s.watchDecisions[ticker])}<button>自分の判断を保存</button></form>`:''}<details><summary>投資根拠を確認・編集</summary>${rationaleDetail(s,ticker)}</details></section>`:''}<div class="section-heading"><h2>関連ニュースの影響</h2><a href="#news">すべて ›</a></div>${related.map(n=>newsCard(n,s)).join('')||empty('この銘柄に関連する公式発表は取得されていません。')}<details class="card"><summary>テーマ・期間別リターンを確認</summary>${themes.map(t=>`<p><a href="#themes/${encodeURIComponent(t.theme_id)}">${esc(themeName(t))} ›</a><br><small>${esc(themeInsight(t,themeFreshness(data)).title)}</small></p>`).join('')||'<p>所属テーマ未登録</p>'}${stockIndicators(data.phaseA?.stocks?.[ticker])}</details><div class="actions">${watch?`<button class="subtle" data-remove-watch="${esc(ticker)}">監視から外す</button>`:`<button data-add-watch="${esc(ticker)}">監視に追加</button>`}</div>`;
 }
 const all=[...new Set([...Object.keys(data.setups?.value?.stocks||{}),...list(data).flatMap(t=>[...(t.core_members||[]),...(t.related_members||[]),...(t.watch_members||[])]),...ownTickers(s)])];
 const tickers=tab==='memory'?['MU','SKHY','SNDK']:tab==='held'?[...new Set(s.holdings.map(h=>h.ticker))]:tab==='watch'?s.watch:all;
 return `<div class="page-heading"><div><span class="eyebrow">選んだ銘柄の状況</span><h1>銘柄をチェック</h1></div><a class="add-button" href="#stocks/add" aria-label="監視銘柄を追加">＋</a></div><p class="page-intro">何が起きているか、根拠と次の確認事項を。</p>${tabs([['watch','監視銘柄'],['held','保有銘柄'],...(memoryRelevant(s)?[['memory','メモリ3社']]:[]),['all','すべて']],tab,'stockTab')}<label class="stock-search-label"><span class="sr-only">表示銘柄を絞り込む</span><input type="search" data-stock-search placeholder="会社名・ティッカーで絞り込む" autocomplete="off" autocapitalize="characters"></label><p class="list-count">${tickers.length}銘柄 · 銘柄をタップすると条件を確認できます</p><div class="decision-list">${tickers.map(t=>stockCard(data,s,t,tab==='watch'?'watch':null)).join('')||`<div class="empty">${tab==='held'?'保有銘柄を登録すると、見直し条件を確認できます。':'監視銘柄を追加して確認を始めましょう。'}</div>`}</div><p data-no-stock-results hidden class="empty">該当する銘柄はありません。</p><div class="actions"><a class="button" href="#stocks/add">＋ 監視銘柄</a><a class="button secondary" href="#portfolio/edit">＋ 保有銘柄</a></div><p class="method-note">日足・価格取得の対象は主要${Object.keys(data.setups?.value?.stocks||{}).length||'確認中の'}銘柄（ETFを含む）です。対象外・データ未取得の銘柄は判断を保留します。</p>${updateDetails(data)}`;
}

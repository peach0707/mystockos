import {holdingKey} from './holdings.js';
import {positionsHTML,averageCostHTML} from './holdings-ui.js';
import {esc,num,yen,pct,tone,empty,field,today} from './ui.js';
import {valueHoldings,observationResult} from './valuation.js';
import {listingFor,isLeveraged} from './symbols.js';

const amount=(n,c='JPY')=>Number.isFinite(n)?c==='USD'?'$'+num(n,2):yen(n):'—';
const signed=(n,c='JPY')=>Number.isFinite(n)?(n>0?'+':'')+amount(n,c):'—';

export function valuationOverview(s,data){
 const v=valueHoldings(s,data);
 const nativeOnly=!v.complete&&v.convertedCount===0&&v.pricedCount===v.rows.length&&v.rows.every(r=>r.quoteCurrency==='USD')&&!v.cashKnown;
 const partial=(!v.complete||v.cashKnown&&v.cashJpy===null)&&!nativeOnly;
 const heading=nativeOnly?'保有株の評価額（米ドル）':v.cashKnown?(v.assetsJpy!==null?'資産総額（登録株＋現金）':'登録資産の参考評価'):'保有株の評価額';
 let total=v.cashKnown?v.assetsJpy:v.stockJpy;
 let shown=amount(total);
 if(total===null&&v.convertedCount)shown=amount(v.subtotalJpy+(v.cashJpy||0));
 else if(total===null&&v.pricedCount&&v.rows.every(r=>r.quoteCurrency==='USD'))shown=amount(v.native.USD,'USD');
 const missing=v.rows.filter(r=>r.valueJpy===null),dated=v.dates.length?`${v.dates[0]}${v.dates.length>1?'〜'+v.dates.at(-1):''} 米国終値`:'価格を確認しています';
 const ownOnly=!v.cashKnown?'<a href="#portfolio/cash">＋ 現金も含める</a>':'<a href="#portfolio/cash">現金残高を編集</a>';
 return `<section class="valuation-hero" aria-label="保有株の自動評価"><div class="row"><span class="eyebrow">PORTFOLIO</span><span class="tag ${v.fresh?'blue':'muted'}">${v.fresh?'自動計算':v.pricedCount?'参考評価':'取得待ち'}</span></div><h2>${heading}</h2>${partial?'<span class="valuation-partial">一部のみ・総額ではありません</span>':''}<strong class="valuation-total" data-valuation-total>${s.holdings.length||v.cashKnown?shown:'保有株を登録'}</strong><p>${s.holdings.length?esc(dated):'銘柄・株数・取得単価を登録すると自動計算します。'}</p><div class="valuation-sub"><div><small>取得単価との差（参考）</small><b class="${tone(v.pnlJpy)}">${signed(v.pnlJpy)}</b></div><div><small>価格の取得状況</small><b>${v.pricedCount} / ${v.rows.length} 銘柄</b></div></div><div class="valuation-foot"><span>${v.cashKnown?`現金 ${amount(v.cashJpy)}（${esc(s.cashBalance.updatedAt)}登録）`:'現金は未登録・集計に含みません'}</span>${ownOnly}</div></section>
 ${missing.length?`<p class="warning">${missing.map(r=>`${esc(r.ticker)}：${esc(r.reason)}`).join(' / ')}。取得できた分は表示し、不明な価格を0円にはしません。</p>`:''}
 ${v.cashKnown&&v.cashJpy===null?'<p class="warning">米ドル現金の円換算に必要な為替を確認中です。現金を含む総額はまだ表示できません。</p>':''}
 ${v.rows.some(r=>r.stale)||v.fx?.stale?'<p class="warning">一部は前回取得した価格・為替です。最新の確定値を確認するまで参考評価として表示します。</p>':''}
 ${s.holdings.length?`<p class="valuation-basis">${v.fx?`円換算：1ドル＝${num(v.fx.rate,4)}円（${esc(v.fx.as_of)} UTC日足終値 / ${esc(v.fx.source)}）。`:'ドル建ての円換算は為替取得後に表示します。'} USD取得単価との差は同じ換算レートで比較するため、購入時からの為替損益・配当・手数料は含みません。</p>`:''}
 <div class="actions"><a class="button" href="#portfolio/edit">＋ 保有銘柄を登録</a><a class="button secondary" href="#portfolio/auto-calendar">評価の自動記録</a></div>
 <div class="section-heading"><h2>保有銘柄</h2><small>価格更新で自動再計算</small></div><div class="holding-list">${v.rows.map(r=>{
  const record=s.securities?.[r.ticker]||listingFor(r.ticker),leverage=isLeveraged(record);
  return `<article class="holding-card" data-holding="${esc(r.ticker)}"><div class="row"><div><a class="holding-ticker" href="#stocks/${esc(r.ticker)}">${esc(r.ticker)} ›</a>${leverage?'<span class="tag caution">レバ・インバース</span>':''}<small>${num(r.quantity,6)}株${r.positions.length>1?` · ${r.positions.length}件を合算`:``} · ${esc(record?.name||'')}</small></div><button class="subtle" ${r.positions.length===1?`data-edit-holding="${esc(holdingKey(r.positions[0]))}"`:`data-manage-holding="${esc(r.ticker)}"`} aria-label="${esc(r.ticker)}の保有を編集">編集</button></div><dl><dt>評価額</dt><dd><strong>${amount(r.valueJpy)}</strong>${r.quoteCurrency==='USD'?`<small>${amount(r.value,'USD')}</small>`:''}</dd><dt>終値</dt><dd>${amount(r.price,r.quoteCurrency)}</dd><dt>平均取得単価</dt><dd data-average-cost="${esc(r.ticker)}">${averageCostHTML(r)}</dd><dt>取得単価との差</dt><dd class="${tone(r.pnl??r.pnlJpy)}">${r.pnl!==null?`${signed(r.pnl,r.quoteCurrency)} (${pct(r.pnlRate)})`:signed(r.pnlJpy)}${r.pnl!==null&&r.quoteCurrency==='USD'&&r.pnlJpy!==null?`<small>円換算 ${signed(r.pnlJpy)}</small>`:''}</dd></dl><small>${esc(r.asOf||'価格未取得')}${r.reason?' · '+esc(r.reason):' 終値'}</small>${r.costBreakdown.length>1?'<p class="holding-help">取得通貨が異なるため、平均取得単価は通貨別に表示しています。</p>':''}${positionsHTML(r)}</article>`;
 }).join('')||empty('登録した保有株がここに並びます。毎日の評価額入力は不要です。')}</div>
 ${v.convertedCount?`<section class="card holdings-allocation"><h2>${v.complete?'保有株の配分':'取得済み分の配分'}</h2>${v.allocation.sort((a,b)=>b.value-a.value).map(r=>`<div><div class="row"><span>${esc(r.name)}</span><b>${num(r.value/v.subtotalJpy*100,1)}%</b></div><div class="allocation-track"><span style="width:${r.value/v.subtotalJpy*100}%"></span></div></div>`).join('')}<p class="muted">株式の円換算評価額で計算。現金はこの配分に含めません。</p></section>`:''}`;
}

export function cashForm(s){
 return `<section class="card"><h2>資産総額に含める現金</h2><p>証券口座などの現金残高を入力します。持っていない通貨は0にしてください。保有株の売買や入出金では自動増減しません。</p><form id="cash-balance-form">${field('JPY','日本円の現金残高','number',`required min="0" step="any" value="${esc(s.cashBalance?.JPY??0)}"`)}${field('USD','米ドルの現金残高','number',`required min="0" step="any" value="${esc(s.cashBalance?.USD??0)}"`)}<button>現金を含めて保存</button></form>${s.cashBalance?`<p class="muted">残高の登録日 ${esc(s.cashBalance.updatedAt)}</p>`:''}<p class="muted">入出金台帳・配当台帳から重ねて加算しません。口座全体の運用損益を記録する場合は、日次評価と入出金台帳をご利用ください。</p></section>`;
}

export function valuationSummary(s,data){
 const v=valueHoldings(s,data),history=s.holdingObservations||[];
 return `<section class="card"><h2>自動集計のサマリー</h2><dl><dt>保有銘柄</dt><dd>${v.rows.length}銘柄（${s.holdings.length}件）</dd><dt>保有株評価額</dt><dd>${amount(v.stockJpy)}</dd><dt>登録現金</dt><dd>${v.cashKnown?amount(v.cashJpy):'未登録（集計対象外）'}</dd><dt>自動評価の記録</dt><dd>${history.length}日</dd><dt>最終自動記録</dt><dd>${esc(history.at(-1)?.date||'最新データの確認後に開始')}</dd></dl><a href="#portfolio/auto-calendar">評価の記録を見る ›</a></section>`;
}

export function autoCalendar(s,month,selected,detail=false){
 const [year,m]=month.split('-').map(Number),history=s.holdingObservations||[];
 const days=new Date(Date.UTC(year,m,0)).getUTCDate(),offset=new Date(`${month}-01T00:00:00Z`).getUTCDay();
 const rows=history.filter(r=>r.date.startsWith(month)),last=rows.at(-1);
 const hint='この端末で確認した保有株の評価を自動記録します。現金・配当・売買の損益は含みません。登録前の日付は埋めません。';
 const switcher='<div class="history-switch"><a class="button secondary" href="#portfolio/auto-calendar">保有株（自動）</a><a class="button secondary" href="#portfolio/calendar">口座全体（手動記録）</a></div>';
 if(detail){const d=observationResult(s,selected);return `${switcher}<a class="back" href="#portfolio/auto-calendar">‹ 自動評価カレンダー</a><section class="card"><h2>${esc(selected)}</h2><small>保有株の評価額</small><p class="hero-number">${amount(d.current?.assetsJpy)}</p><h3>前回記録からの評価差</h3><p class="hero-number ${tone(d.change)}">${signed(d.change)}</p><p>${esc(d.reason)}</p>${d.current?`<dl><dt>株価の基準日</dt><dd>${esc(d.current.priceDate)} 米国終値</dd><dt>為替の基準日</dt><dd>${esc(d.current.fxDate||'換算不要')} ${d.current.fxRate?`1ドル＝${num(d.current.fxRate,4)}円`:''}</dd><dt>記録日時</dt><dd>${esc(new Date(d.current.observedAt).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'}))} 日本時間</dd><dt>比較元</dt><dd>${esc(d.previous?.date||'開始日')}</dd></dl>`:''}<p class="method-note">${hint} 売買などで保有内容を変更した日には、差額を損益とみなさず比較を再開します。</p></section>`;}
 let cells=Array.from({length:offset},()=>'<span></span>').join('');
 for(let i=1;i<=days;i++){
  const date=`${month}-${String(i).padStart(2,'0')}`,d=observationResult(s,date);
  cells+=`<button class="day ${date===selected?'selected':''}" data-auto-date="${date}" aria-label="${date} ${d.current?amount(d.current.assetsJpy):'記録なし'}"><span>${i}</span><b class="${tone(d.change)}">${d.change!==null?(d.change>0?'+':'')+num(d.change/10000,1)+'万':d.current?'基準':'—'}</b><small>${d.current?num(d.current.assetsJpy/10000,1)+'万':'—'}</small></button>`;
 }
 cells+=Array.from({length:(7-(offset+days)%7)%7},()=>'<span></span>').join('');
 return `${switcher}<section class="card calendar-card auto-calendar"><div class="row month-toolbar"><button data-month="-1" aria-label="前月">‹</button><h2>${year}年${m}月</h2><button data-month="1" aria-label="翌月">›</button></div><div class="auto-calendar-summary"><small>この月の最新の保有評価</small><strong>${last?amount(last.assetsJpy):'記録を開始します'}</strong><span>${last?`${esc(last.date)} · ${rows.length}日の記録`:'価格と為替が揃うと自動保存されます'}</span></div><p class="calendar-note">上段：前回記録からの評価差 / 下段：評価額（万円）<br>最初の評価・保有変更日は「基準」。推定した過去損益ではありません。</p><div class="calendar">${['日','月','火','水','木','金','土'].map(x=>`<small>${x}</small>`).join('')}${cells}</div></section><p class="method-note">${hint} アプリを開いていない日は記録されません。前回との間隔が空くと、その期間の評価差を表示します。</p>`;
}

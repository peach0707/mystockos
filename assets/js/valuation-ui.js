import {companyName,searchText,normalizeSearch} from './company-names.js';
import {holdingKey} from './holdings.js';
import {positionsHTML,averageCostHTML} from './holdings-ui.js';
import {esc,num,yen,pct,tone,empty,field} from './ui.js';
import {valueHoldings} from './valuation.js';
import {listingFor,isLeveraged} from './symbols.js';
import {historyRows,dailyResult} from './portfolio-history.js';
import {trendView,calendarView,signedYen} from './history-ui.js';

const amount=(n,c='JPY')=>Number.isFinite(n)?c==='USD'?'$'+num(n,2):yen(n):'—';
const signed=(n,c='JPY')=>Number.isFinite(n)?(n>0?'+':n<0?'−':'')+amount(Math.abs(n),c):'—';
function latestDay(s,data,v){const last=historyRows(s).at(-1);const d=last&&v.dates.length===1&&last.priceDate===v.dates[0]?dailyResult(s,last.date,data):{change:null,rate:null,waiting:true};return {...d,note:d.change!==null?pct(d.rate):d.waiting?'同日の終値・為替が揃うと表示':d.previous?'保有変更の基準日':'前営業日の記録待ち'};}
export function homePortfolio(s,data){
 if(!s.holdings.length&&!s.cashBalance)return '';
 const v=valueHoldings(s,data),d=latestDay(s,data,v),total=v.cashKnown?v.assetsJpy:v.stockJpy;
 return '<section class="home-portfolio" aria-label="資産のサマリー"><div class="row"><span>'+(v.cashKnown?'登録資産（株＋現金）':'保有株の評価額')+'</span><a href="#portfolio">詳しく ›</a></div><strong data-home-total>'+amount(total)+'</strong>'+'<p class="valuation-context">'+(v.fresh?'米国 '+esc(v.dates.join('・'))+' 終値':v.rows.length?'参考評価・価格または為替の更新確認が必要':'登録した現金残高')+'</p>'+(!v.complete?'<p>一部の価格を確認中です。保有画面で確認できます。</p>':'')+'<div class="home-portfolio-metrics"><div><small>前営業日比・保有株</small><b class="'+tone(d.change)+'">'+signedYen(d.change)+'</b><small>'+esc(d.note)+'</small></div><div><small>評価損益（参考）</small><b class="'+tone(v.pnlJpy)+'">'+signedYen(v.pnlJpy)+'</b><small>登録した取得単価との差</small></div></div><a class="home-history-link" href="#portfolio/auto-calendar">カレンダーで日別の変化を見る <span>›</span></a></section>';
}
export function valuationOverview(s,data,{range='1m',sort='value',query=''}={}){
 const v=valueHoldings(s,data),d=latestDay(s,data,v);
 const nativeOnly=!v.complete&&v.convertedCount===0&&v.pricedCount===v.rows.length&&v.rows.every(r=>r.quoteCurrency==='USD')&&!v.cashKnown;
 const partial=(!v.complete||v.cashKnown&&v.cashJpy===null)&&!nativeOnly;
 const heading=partial?'取得済み分の参考評価':nativeOnly?'保有株の評価額（米ドル）':v.cashKnown?(v.assetsJpy!==null?'資産総額（登録株＋現金）':'登録資産の参考評価'):'保有株の評価額';
 const total=v.cashKnown?v.assetsJpy:v.stockJpy;let shown=amount(total);
 if(total===null&&v.convertedCount)shown=amount(v.subtotalJpy+(v.cashJpy||0));
 else if(total===null&&v.pricedCount&&v.rows.every(r=>r.quoteCurrency==='USD'))shown=amount(v.native.USD,'USD');
 const missing=v.rows.filter(r=>r.valueJpy===null),dated=v.dates.length?v.dates[0]+(v.dates.length>1?'〜'+v.dates.at(-1):'')+' 米国終値':'価格を確認しています';
 const sorted=[...v.rows].sort((a,b)=>sort==='name'?a.ticker.localeCompare(b.ticker):sort==='pnl'?(b.pnlJpy??-Infinity)-(a.pnlJpy??-Infinity):(b.valueJpy??-Infinity)-(a.valueJpy??-Infinity));
 const match=r=>!query||normalizeSearch(searchText(r.ticker,s.securities?.[r.ticker]?.name||listingFor(r.ticker)?.name)).includes(normalizeSearch(query));
 let html='<section class="valuation-hero" aria-label="保有株の自動評価"><div class="row"><span class="eyebrow">PORTFOLIO</span><span class="tag '+(v.fresh?'blue':'muted')+'">'+(v.fresh?'終値更新済み':v.pricedCount?'参考評価':'取得待ち')+'</span></div><h2>'+heading+'</h2>'+(partial&&s.holdings.length?'<span class="valuation-partial">取得できた分のみ・総額ではありません</span>':'')+'<strong class="valuation-total" data-valuation-total>'+(s.holdings.length||v.cashKnown?shown:'保有株を登録')+'</strong><p>'+(s.holdings.length?esc(dated):'株数と取得単価を入力するだけで、自動集計します。')+'</p><div class="valuation-sub"><div><small>前営業日比・保有株</small><b class="'+tone(d.change)+'">'+signedYen(d.change)+'</b><span>'+esc(d.note)+'</span></div><div><small>評価損益（参考）</small><b class="'+tone(v.pnlJpy)+'">'+signedYen(v.pnlJpy)+'</b><span>登録した取得単価との差</span></div></div><div class="valuation-foot"><span>'+(v.cashKnown?'現金 '+amount(v.cashJpy):'現金は未登録・集計に含みません')+'</span><a href="#portfolio/cash">'+(v.cashKnown?'現金を編集':'＋ 現金も含める')+'</a></div></section><div class="portfolio-actions"><a class="button" href="#portfolio/edit">＋ 保有銘柄を登録</a><a class="button secondary" href="#portfolio/auto-calendar">カレンダー</a><a class="button secondary" href="#portfolio/dividends">配当</a></div>';
 if(missing.length)html+='<p class="warning">'+missing.map(r=>esc(r.ticker)+'：'+esc(r.reason)).join(' / ')+'。不明な価格を0円にはしません。</p>';
 if(v.cashKnown&&v.cashJpy===null)html+='<p class="warning">米ドル現金の円換算に必要な為替を確認中です。現金を含む総額はまだ表示できません。</p>';
 if(v.rows.some(r=>r.stale)||v.fx?.stale)html+='<p class="warning">一部は前回取得した価格・為替です。最新の確定値を確認するまで参考評価として表示します。</p>';
 if(s.holdings.length)html+=trendView(s,data,range);
 html+='<div class="section-heading"><h2>保有銘柄 <small>'+v.rows.length+'</small></h2><span class="coverage-label">価格 '+v.pricedCount+'/'+v.rows.length+'件</span></div>';
 if(s.holdings.length)html+='<div class="holding-tools"><label><span class="sr-only">保有銘柄を検索</span><input type="search" data-holding-search placeholder="銘柄名・ティッカーで検索" value="'+esc(query)+'"></label><label><span class="sr-only">保有銘柄の並び順</span><select data-holding-sort>'+[['value','評価額順'],['pnl','評価損益順'],['name','銘柄名順']].map(([value,label])=>'<option value="'+value+'" '+(sort===value?'selected':'')+'>'+label+'</option>').join('')+'</select></label></div>';
 html+='<div class="holding-list">'+(sorted.map(r=>{
  const record=s.securities?.[r.ticker]||listingFor(r.ticker),leverage=isLeveraged(record);
  return '<article class="holding-card" data-holding="'+esc(r.ticker)+'" data-holding-search-text="'+esc(searchText(r.ticker,record?.name))+'" '+(match(r)?'':'hidden')+'><div class="holding-card-head"><div><a class="holding-ticker" href="#stocks/'+esc(r.ticker)+'">'+esc(r.ticker)+' ›</a>'+(leverage?'<span class="tag caution">レバ</span>':'')+'<small>'+num(r.quantity,6)+'株'+(r.positions.length>1?' · '+r.positions.length+'件を合算':'')+'</small></div><div class="holding-amount"><strong>'+amount(r.valueJpy)+'</strong>'+(r.quoteCurrency==='USD'?'<small>'+amount(r.value,'USD')+'</small>':'')+'</div></div><p class="holding-name">'+esc(companyName(r.ticker)||record?.name||'')+'</p><div class="holding-pnl"><span>評価損益（参考）</span><b class="'+tone(r.pnl??r.pnlJpy)+'">'+(r.pnl!==null?signed(r.pnl,r.quoteCurrency)+' <small>'+pct(r.pnlRate)+'</small>':signed(r.pnlJpy))+'</b></div><dl class="holding-prices"><dt>平均取得</dt><dd data-average-cost="'+esc(r.ticker)+'">'+averageCostHTML(r)+'</dd><dt>終値</dt><dd>'+amount(r.price,r.quoteCurrency)+'</dd></dl><div class="holding-card-foot"><small>'+(r.asOf?esc(r.asOf)+(r.reason?' · '+esc(r.reason):' 終値'):esc(r.reason||'価格未取得'))+'</small><button class="subtle" '+(r.positions.length===1?'data-edit-holding="'+esc(holdingKey(r.positions[0]))+'"':'data-manage-holding="'+esc(r.ticker)+'"')+' aria-label="'+esc(r.ticker)+'の保有を編集">編集</button></div>'+(r.priceHelp?'<p class="holding-help">'+esc(r.priceHelp)+'</p><button type="button" class="subtle" data-refresh>価格の取得状況を再確認</button>':'')+(r.costBreakdown.length>1?'<p class="holding-help">取得通貨が異なるため、平均取得単価は通貨別に表示しています。</p>':'')+positionsHTML(r)+'</article>';
 }).join('')||empty('保有銘柄を登録して、資産の推移を見てみましょう。'))+'</div><p class="empty" data-no-holdings '+(sorted.some(match)||!sorted.length?'hidden':'')+'>該当する保有銘柄はありません。</p>';
 if(v.convertedCount)html+='<details class="card holdings-allocation"><summary>'+(v.complete?'保有株の配分':'取得済み分の配分')+'を見る</summary>'+v.allocation.sort((a,b)=>b.value-a.value).map(r=>'<div><div class="row"><span>'+esc(r.name)+'</span><b>'+num(r.value/v.subtotalJpy*100,1)+'%</b></div><div class="allocation-track"><span style="width:'+r.value/v.subtotalJpy*100+'%"></span></div></div>').join('')+'<p class="muted">株式の円換算評価額で計算。現金はこの配分に含めません。</p></details>';
 return html+'<details class="valuation-basis"><summary>評価額・評価損益の計算について</summary><p>'+(v.fx?'円換算：1ドル＝'+num(v.fx.rate,4)+'円（'+esc(v.fx.as_of)+' UTC日足終値 / '+esc(v.fx.source)+'）。':'ドル建ての円換算は為替取得後に表示します。')+' USD取得単価との差は同じ換算レートで比較するため、購入時からの為替損益・配当・手数料は含みません。前営業日比は保有株だけの評価差です。</p></details>';
}
export function cashForm(s){
 return '<section class="card"><h2>資産総額に含める現金</h2><p>証券口座などの現金残高を入力します。持っていない通貨は0にしてください。保有株の売買や入出金では自動増減しません。</p><form id="cash-balance-form">'+field('JPY','日本円の現金残高','number','required min="0" step="any" value="'+esc(s.cashBalance?.JPY??0)+'"')+field('USD','米ドルの現金残高','number','required min="0" step="any" value="'+esc(s.cashBalance?.USD??0)+'"')+'<button>現金を含めて保存</button></form>'+(s.cashBalance?'<p class="muted">残高の登録日 '+esc(s.cashBalance.updatedAt)+'</p>':'')+'<p class="muted">入出金台帳・配当台帳から重ねて加算しません。口座全体の運用損益を記録する場合は、日次評価と入出金台帳をご利用ください。</p></section>';
}
export function valuationSummary(s,data){
 const v=valueHoldings(s,data),history=historyRows(s);
 return '<section class="card"><h2>自動集計のサマリー</h2><dl><dt>保有銘柄</dt><dd>'+v.rows.length+'銘柄（'+s.holdings.length+'件）</dd><dt>保有株評価額</dt><dd>'+amount(v.stockJpy)+'</dd><dt>登録現金</dt><dd>'+(v.cashKnown?amount(v.cashJpy):'未登録（集計対象外）')+'</dd><dt>日別評価の記録</dt><dd>'+history.length+'日</dd><dt>最終評価日</dt><dd>'+esc(history.at(-1)?.date||'価格と為替が揃うと開始')+'</dd></dl><a href="#portfolio/auto-calendar">カレンダーを見る ›</a></section>';
}
export const autoCalendar=calendarView;

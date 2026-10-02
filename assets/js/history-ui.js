import {esc,num,yen,pct,tone} from './ui.js';
import {historyRows,dailyResult,historyDayState,japanDate,shiftDate} from './portfolio-history.js';

export const signedYen=n=>Number.isFinite(n)?`${n>0?'+':n<0?'−':''}${yen(Math.abs(n))}`:'—';
const compact=n=>{if(!Number.isFinite(n))return '—';const a=Math.abs(n);return (n>0?'+':n<0?'−':'')+(a>=1e8?num(a/1e8,1)+'億':a>=1e5?num(a/1e4,0)+'万':a>=1e4?num(a/1e4,1)+'万':a>=1e3?num(a/1e3,1)+'千':num(a,0));};
export const historyHelp=`<details class="history-help"><summary>自動記録のしくみ・計算の範囲</summary><p>毎日の終値・為替はサーバーで蓄積しています。アプリを開くと、この端末の保有履歴に合わせて、開かなかった日の評価もまとめて補完します。保有数量は外部へ送信しません。</p><p>米国市場の終値を、日本時間の翌朝の日付で表示します。金曜日の米国終値は土曜日に載ります。現金・配当・手数料・実現損益は含みません。売買したときは保有数量も更新してください。</p><p>登録前・保有が不明な期間・価格や同日為替が不足する日は推測で埋めません。数量・取得単価を変更した日は比較を区切ります。旧版の記録はバックアップ内に保持しています。</p></details>`;

export function trendView(s,data,range='1m',small=false){
 const all=historyRows(s),last=all.at(-1),end=last?.date||japanDate(),days={ '1m':31,'3m':93,'1y':366 }[range];
 const rows=all.filter(r=>!days||r.date>=shiftDate(end,-days));
 const first=rows[0],same=rows.length>1&&rows.every((r,i)=>!i||dailyResult(s,r.date,data).change!==null);
 const delta=same?last.assetsJpy-first.assetsJpy:null;
 let chart=`<div class="trend-empty">${s.holdings.length?'同じ日付の終値・為替が揃うと、営業日ごとの推移を表示します。':'保有銘柄を登録すると、営業日ごとの推移がここに並びます。'}</div>`;
 if(rows.length){
  const low=Math.min(...rows.map(r=>r.assetsJpy)),high=Math.max(...rows.map(r=>r.assetsJpy)),spread=(high-low)||Math.max(high*.01,1);
  const point=(r,i)=>[18+(rows.length===1?.5:i/(rows.length-1))*304,112-(r.assetsJpy-low)/spread*82];
  const segments=[];let line=[];
  rows.forEach((r,i)=>{if(i&&dailyResult(s,r.date,data).change===null){if(line.length)segments.push(line);line=[];}line.push(point(r,i));});if(line.length)segments.push(line);
  chart=`<figure class="portfolio-chart"><svg viewBox="0 0 340 145" role="img" aria-label="${esc(first.date)}から${esc(last.date)}までの保有株評価額。${rows.length}営業日。${yen(last.assetsJpy)}"><defs><linearGradient id="portfolio-chart-wash" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#298eff" stop-opacity=".35"/><stop offset="100%" stop-color="#298eff" stop-opacity="0"/></linearGradient></defs><path d="M18 30H322M18 71H322M18 112H322" stroke="#e6edf5" fill="none"/>${segments.map(points=>points.length>1?`<path d="M${points[0][0]},112 L${points.map(p=>p.join(',')).join(' L')} L${points.at(-1)[0]},112 Z" fill="url(#portfolio-chart-wash)"/><path d="M${points.map(p=>p.join(',')).join(' L')}" fill="none" stroke="#1677ff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`:`<circle cx="${points[0][0]}" cy="${points[0][1]}" r="3" fill="#1677ff"/>`).join('')}<circle cx="${point(last,rows.length-1)[0]}" cy="${point(last,rows.length-1)[1]}" r="4" fill="#1677ff" stroke="white" stroke-width="2"/><text x="18" y="138">${esc(first.date.slice(5).replace('-','/'))}</text><text x="322" y="138" text-anchor="end">${esc(last.date.slice(5).replace('-','/'))}</text></svg></figure>`;
 }
 return `<section class="card portfolio-trend ${small?'compact-trend':''}" aria-label="保有株の評価推移"><div class="row"><h2>資産の推移 <small>保有株</small></h2><a href="#portfolio/auto-calendar">日別を見る ›</a></div>${small?'':`<div class="trend-ranges" role="group" aria-label="推移の表示期間">${[['1m','1か月'],['3m','3か月'],['1y','1年'],['all','すべて']].map(([id,label])=>`<button data-history-range="${id}" aria-pressed="${range===id}">${label}</button>`).join('')}</div>`}<div class="trend-caption"><b class="${tone(delta)}">${delta!==null?signedYen(delta):rows.length?`${rows.length}営業日の記録`:'これから自動記録'}</b><span>${delta!==null?'表示期間の評価差':rows.length>1?'保有変更・欠損をまたぐ損益は合算しません':'未起動の日も、次回起動時に補完'}</span></div>${chart}</section>`;
}

export function calendarView(s,month,selected,detail,data={},mode='change'){
 const history=historyRows(s),rows=history.filter(r=>r.date.startsWith(month)),last=rows.at(-1),today=japanDate();
 const valueScale=rows.some(r=>r.assetsJpy>=1e8)?1e8:1e4,valueUnit=valueScale===1e8?'億円':'万円';
 const [year,m]=month.split('-').map(Number),days=new Date(Date.UTC(year,m,0)).getUTCDate(),offset=new Date(`${month}-01T00:00:00Z`).getUTCDay();
 if(detail){
  const d=historyDayState(s,selected,data),parts=d.current?.parts||[],previous=d.previous?.parts||[];
  return `<a class="back" href="#portfolio/auto-calendar">‹ カレンダーへ</a><section class="card daily-detail"><div class="row"><h2>${esc(selected.replaceAll('-','/'))}</h2><span class="tag blue">${esc(d.label||'未確定')}</span></div><small>保有株の評価額</small><p class="hero-number">${d.current?yen(d.current.assetsJpy):'—'}</p><div class="daily-change"><span>前営業日比</span><b class="${tone(d.change)}">${signedYen(d.change)}</b><small>${pct(d.rate)}</small></div><p>${esc(d.kind==='closed'?'この日本日付に対応する米国市場の取引はありません。評価差を0円として記録しません。':d.kind==='unregistered'?'この日の保有内容が分からないため、推測の評価額は作っていません。':d.reason)}</p>${parts.length?`<h3>銘柄別の内訳</h3><div class="daily-parts">${parts.map(p=>{const old=previous.find(q=>q.ticker===p.ticker),change=d.change!==null&&old?p.valueJpy-old.valueJpy:null;return `<a href="#stocks/${esc(p.ticker)}"><div><b>${esc(p.ticker)}</b><small>${num(p.quantity,6)}株</small></div><div><b>${yen(p.valueJpy)}</b><small class="${tone(change)}">${signedYen(change)}</small></div></a>`;}).join('')}</div><details><summary>価格・為替の基準</summary><dl><dt>米国の終値</dt><dd>${esc(d.current.priceDate)}</dd><dt>ドル円</dt><dd>${d.current.fxRate?`${num(d.current.fxRate,4)}円（${esc(d.current.fxDate)}）`:'換算なし'}</dd><dt>比較元</dt><dd>${esc(d.previous?.date||'比較なし')}</dd></dl></details>`:'<button type="button" data-refresh>最新の価格を確認</button>'}</section>${historyHelp}`;
 }
 let cells=Array.from({length:offset},()=>'<span class="calendar-blank" aria-hidden="true"></span>').join('');
 let missing=0;
 for(let i=1;i<=days;i++){
  const date=`${month}-${String(i).padStart(2,'0')}`,d=historyDayState(s,date,data);if(d.kind==='missing')missing++;
  const label=d.current?(mode==='value'?num(d.current.assetsJpy/valueScale,valueScale===1e8?2:0):d.change!==null?compact(d.change):'基準'):d.kind==='closed'?'休':d.kind==='missing'?'待ち':'';
  const aria=`${date} ${d.current?yen(d.current.assetsJpy)+' 前営業日比 '+signedYen(d.change):d.label||'未確定'}`;
  cells+=`<button class="day history-day ${d.kind} ${d.change>0?'gain':d.change<0?'loss':''} ${date===today?'today':''}" data-auto-date="${date}" aria-label="${esc(aria)}" ${d.kind==='future'?'disabled':''}><span>${i}</span><b class="${mode==='change'?tone(d.change):''}">${label}</b></button>`;
 }
 cells+=Array.from({length:(7-(offset+days)%7)%7},()=>'<span class="calendar-blank" aria-hidden="true"></span>').join('');
 return `<div class="history-status"><span class="status-dot"></span><span>開かなかった日も自動補完</span><button type="button" data-refresh aria-label="評価履歴を更新">↻</button></div><section class="card calendar-card auto-calendar"><div class="month-toolbar row"><button data-month="-1" aria-label="前月">‹</button><h2>${year}年${m}月</h2><button data-month="1" aria-label="翌月">›</button></div><div class="auto-calendar-summary"><div><small>この月の最新評価</small><strong>${last?yen(last.assetsJpy):'—'}</strong></div><span>${rows.length}日の記録<button type="button" data-month-today>今月へ</button></span></div><div class="calendar-mode" role="group" aria-label="カレンダーの表示"><button data-calendar-mode="change" aria-pressed="${mode==='change'}">前営業日比</button><button aria-label="評価額" data-calendar-mode="value" aria-pressed="${mode==='value'}">評価額（${valueUnit}）</button></div><div class="calendar">${['日','月','火','水','木','金','土'].map(x=>`<small>${x}</small>`).join('')}${cells}</div><div class="calendar-legend"><span><i class="gain"></i>増加</span><span><i class="loss"></i>減少</span><span>休＝米国休場</span><span>待ち＝取得待ち</span></div></section>${missing?`<p class="warning">${missing}日分は価格・為替の取得待ちです。データが揃うと自動で補完します。</p>`:''}<p class="history-caption">米国終値を翌朝の日本日付で表示。セルは概数です。日付をタップすると正確な金額・増減率・内訳を確認できます。</p>${historyHelp}<details class="manual-switch"><summary>口座全体の手動記録・旧版の記録</summary><p>現金・入出金を含む記録と、保有株だけの自動評価は別々に管理します。</p><a href="#portfolio/calendar">口座全体の損益カレンダー ›</a><p>旧版で確認した評価：${(s.holdingObservations||[]).length}件。元の記録は削除せず、バックアップに残しています。</p></details>`;
}

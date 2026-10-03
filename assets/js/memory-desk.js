import {esc,num,pct,tone} from './ui.js';
import {setupFor} from './setups.js';
import {dateState,timeLabel} from './freshness.js';

const members=[['MU','Micron','DRAM・HBM・NAND'],['SKHY','SK hynix','DRAM・HBM・NAND'],['SNDK','Sandisk','NAND・SSD']];
const price=n=>Number.isFinite(n)?'$'+num(n,2):'—';
export function memoryReadings(data,now=Date.now()){
 return members.map(([ticker,name,focus])=>{
  const check=setupFor(data,ticker,now),q=check.setup||{};
  const ready=check.ready&&!data.setups?.error&&dateState(q.as_of,data.calendar?.value,now).state==='current';
  const trend=!ready?'更新待ち':q.price>q.ma50&&q.ma20>q.ma50?'上昇基調':q.price<q.ma50&&q.ma20<q.ma50?'下落基調':'方向が混在';
  const hot=ready&&(q.rsi14_simple>=70||q.distance_ma20_pct>=10);
  const broken=ready&&(q.price<q.prior_low20||q.price<q.ma50);
  const near=ready&&q.trend_up&&Math.abs(q.distance_ma20_pct)<=3;
  const action=!ready?'最新日足を確認':broken?'保有理由を再点検':hot?'追い買いを慎重に':q.breakout?'高値更新の維持を確認':near?'下げ止まりを確認':trend==='上昇基調'?'上昇基調の維持を確認':'方向がそろうか確認';
  const explanation=!ready?check.reason:broken?'終値が50日平均または直近20日の終値安値を下回っています。業績・需給の悪化を伴うか確認。':hot?'上昇基調と短期の過熱は両立します。過熱だけで天井とは判断しません。':q.breakout?'直近20日の終値高値を更新。翌営業日も上回るか、出来高を伴うか確認。':near?'20日平均に近い位置です。安いという意味ではなく、反発を確認する段階です。':trend==='上昇基調'?'終値と20日平均が50日平均を上回っています。短期の下げと基調の崩れを分けて確認。':'平均線の位置がそろっていません。強弱を一方向に決めつけず、次の終値を確認。';
  return {ticker,name,focus,q,ready,trend,hot,broken,near,action,explanation};
 });
}
function metrics(r){
 const q=r.q;
 return '<dl class="memory-metrics">'+[['前日比',pct(q.day),tone(q.day)],['5営業日',pct(q.returns?.['5']),tone(q.returns?.['5'])],['1か月',pct(q.returns?.['21']),tone(q.returns?.['21'])],['20日平均',price(q.ma20),''],['50日平均',price(q.ma50),''],['20日平均との距離',pct(q.distance_ma20_pct),'']].map(([label,value,color])=>'<div><dt>'+label+'</dt><dd class="'+color+'">'+value+'</dd></div>').join('')+'</dl>';
}
function stockCard(r,compact){
 const q=r.q;
 return '<article class="memory-stock" data-memory-stock="'+r.ticker+'"><div class="row"><div><a href="#stocks/'+r.ticker+'"><b>'+r.ticker+'</b> '+r.name+' ›</a><small>'+r.focus+'</small></div><div class="memory-price"><strong>'+price(q.price)+'</strong><small>'+esc(q.as_of||'未取得')+' 終値</small></div></div><div class="memory-badges"><span class="tag '+(r.broken||r.hot?'caution':r.ready?'blue':'')+'">'+r.trend+'</span><span>'+(r.hot?'短期過熱あり':r.ready?'過熱条件なし':'取得状況を確認')+'</span></div><h3>'+r.action+'</h3><p>'+esc(r.explanation)+'</p>'+(compact?'':metrics(r))+
 (compact?'':'<details><summary>次に見る価格・根拠</summary><dl><dt>上抜けを確認する終値高値（直前20日）</dt><dd>'+price(q.prior_high20)+'</dd><dt>下抜けに注意する終値安値（直前20日）</dt><dd>'+price(q.prior_low20)+'</dd><dt>RSI（14日・単純平均）</dt><dd>'+num(q.rsi14_simple,1)+'</dd><dt>出来高 / 前20日平均</dt><dd>'+num(q.rvol,2)+'倍</dd></dl><p>水準に触れただけで売買を決めず、次の終値・出来高・業績の変化を確認します。</p><small>'+esc(q.source||'取得元未確認')+' / '+(q.history_sessions||0)+'営業日の履歴 / '+esc(timeLabel(q.retrieved_at))+'取得（日本時間）。'+(r.ready?'50日平均まで確認可能。':'表示値は保存時点の参考値です。')+'</small></details>')+'</article>';
}
function memoryNews(data){
 const available=(data.news?.value?.articles||[]).filter(n=>n.brief?.status==='ready'&&n.brief?.basis==='article_body').sort((a,b)=>b.published_at.localeCompare(a.published_at));
 const articles=members.map(([t])=>available.find(n=>n.direct_tickers?.includes(t))).filter(Boolean);
 const pending=members.filter(([t])=>!articles.some(n=>n.direct_tickers.includes(t))).map(([t])=>'<p class="memory-news-pending">'+t+'：本文を確認できた日本語要約はまだありません。<a href="#news">ニュースの取得状況を見る ›</a></p>').join('');
 return '<section class="memory-fundamentals"><h3>業績・需給の確認材料</h3><p>販売価格・供給計画・次期見通しを確認します。株価が強いだけでは需給の改善と断定しません。</p>'+(articles.length?articles.map(n=>'<a class="memory-news-link" href="#news/'+encodeURIComponent(n.id)+'"><small>'+esc(n.direct_tickers.join('・'))+' · '+esc(n.published_at.slice(0,10))+' 公表</small><b>'+esc(n.brief.headline_ja)+'</b><p>'+esc(n.brief.summary_ja)+'</p><span>本文の要点と確認項目 ›</span></a>').join(''):'<p>本文を確認できた日本語ニュースを取得待ちです。</p>') +pending+'<details><summary>メモリ投資で追う3つの変化</summary><dl><dt>価格と需要</dt><dd>DRAM・NANDの販売価格、出荷量、顧客在庫。価格上昇と数量増を分けて確認。</dd><dt>供給と契約</dt><dd>HBMの契約・量産計画、DRAM/NAND増産と稼働時期。契約と単なる計画を区別。</dd><dt>収益</dt><dd>売上・粗利益率・次期見通しの上方/下方修正。MU・SK hynixのHBMとSNDKのNANDを混同しない。</dd></dl></details></section>';
}
export function memoryDesk(data,{compact=false,card=false,now=Date.now()}={}){
 const readings=memoryReadings(data,now),ready=readings.filter(r=>r.ready),up=ready.filter(r=>r.trend==='上昇基調').length,hot=ready.filter(r=>r.hot).length,weak=ready.filter(r=>r.broken).length;
 const title=ready.length===3?(weak?'基調の崩れがある銘柄を確認':up===3?hot?'3社とも上昇基調。過熱には差':'3社とも上昇基調':up+'/3社が上昇基調。銘柄差を確認'):ready.length+'/3社を確認済み';
 return '<section class="memory-desk memory-watch '+(compact?'memory-compact ':'')+(card?'theme-reading-card':'')+'" '+(card?'data-theme-card data-theme-id="memory_hbm" data-theme-search="メモリ hbm nand memory mu skhy sndk semiconductor"':'')+'><div class="row"><div><span class="eyebrow">MEMORY DESK</span><h2>'+(compact?'メモリ3社の判断材料':'メモリ・HBM / NANDを判断する')+'</h2></div>'+(compact?'<a href="#themes/memory_hbm">詳しく ›</a>':'')+'</div><div class="memory-conclusion"><strong>'+title+'</strong><p>中期の基調と短期の過熱を分けて確認。'+(hot?hot+'社に過熱条件。':'')+(weak?weak+'社が50日平均または直近安値を下回っています。':'')+'</p><small>個別の日足で確認 '+ready.length+'/3社。取得済みの20日・50日データを使います。</small></div><div class="memory-stock-grid">'+readings.map(r=>stockCard(r,compact)).join('')+'</div>'+(compact?'<a class="memory-more" href="#themes/memory_hbm">価格水準・需給ニュースまで確認する →</a>':memoryNews(data)+'<details class="memory-method"><summary>判定方法と使える範囲</summary><p>上昇基調＝終値と20日平均が50日平均より上。下落基調＝両方が50日平均より下。過熱条件＝14日RSI（単純平均）70以上、または20日平均との乖離10%以上。20日平均の±3%は接近の目安です。アプリの確認ルールで、売買の成功率は検証されていません。</p><p>1か月＝21営業日、価格リターン・配当なし。3社を合成した投資指数やテーマ順位ではありません。履歴不足・古いデータの銘柄は個別に更新待ちとし、他の取得済み銘柄の確認を止めません。</p><p>テーマ判定v1の長期スコアは別管理です。長期履歴が不足する間も、この画面では個別の日足を読み取れます。</p><a href="https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/RSI" target="_blank" rel="noopener noreferrer">RSIの一般的な読み方（Fidelity） ↗</a></details>')+'</section>';
}

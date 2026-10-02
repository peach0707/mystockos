import {esc,num,pct,tone} from './ui.js';
import {dateState,timeLabel} from './freshness.js';
import {quoteFor} from './setups.js';

export function vixReading(data,now=Date.now()){
 const live=data.vix?.value,r=data.regime?.value;
 const v=live||{close:r?.instability?.factors?.vix?.raw,as_of:r?.data?.vix_as_of,source:r?.data?.vix_source};
 const state=dateState(v.as_of,data.calendar?.value,now);
 const ready=Number.isFinite(v.close)&&v.close>0&&state.state==='current'&&!data.vix?.cached&&v.fetch_status!=='failed';
 const level=!ready?'更新を確認中':v.close<15?'値動きの警戒は低め':v.close<20?'値動きの警戒は中程度':v.close<30?'大きな値動きに注意':'強い警戒が必要';
 const explanation=!ready?'古い値や取得失敗では、現在の市場の落ち着きは判定しません。':v.close<15?'市場が織り込む変動は小さめ。ただし、急落しないという意味ではありません。':v.close<20?'変動への備えは必要です。保有の偏りや決算予定も合わせて確認しましょう。':v.close<30?'変動への警戒が高まる水準です。レバレッジと一度に買う金額を確認しましょう。':'大きな変動を織り込む水準です。売買を急ぐ前に、許容できる下落幅を確認しましょう。';
 return {v,state,ready,level,explanation};
}
export function marketContext(data){
 const {v,ready,level,explanation}=vixReading(data),r=data.regime?.value,rs=dateState(r?.as_of,data.calendar?.value);
 const change=Number.isFinite(v.previous_close)&&Number.isFinite(v.close)?v.close-v.previous_close:null;
 return `<section class="card vix-context"><div class="row"><h2>市場の値動きへの警戒</h2><span class="tag ${ready?'blue':'caution'}">${ready?'終値を確認済み':'更新待ち'}</span></div><div class="vix-reading"><strong>VIX ${num(v.close,2)}</strong><span>${esc(level)}</span></div><p>${esc(explanation)}</p><small>米国 ${esc(v.as_of||'未取得')} 終値${change===null?'':` · 前回比 ${change>=0?'+':''}${num(change,2)}ポイント`}</small><details><summary>VIXの読み方・データの時点</summary><p>S&P 500のオプション価格から計算する、今後約30日の予想変動率です。株価が上がるか下がるかを示す数字ではありません。</p><p>このアプリの目安：15未満＝低め / 15〜20未満＝中程度 / 20〜30未満＝高め / 30以上＝強い警戒。売買の合図や公式の区分ではありません。</p><p>出典：${esc(v.source||'確認中')}。日中のリアルタイム値ではなく日次終値を約3時間ごとに確認します。確認時刻：${esc(timeLabel(v.checked_at))}（日本時間）。</p><p>市場判定の基準日：${esc(r?.as_of||'未取得')} · ${esc(rs.label)}。VIXとは更新時点が異なる場合があります。</p><a href="https://www.cboe.com/tradable-products/vix/" target="_blank" rel="noopener noreferrer">Cboeの説明 ↗</a></details></section>`;
}
export function memoryWatch(data){
 return `<section class="card memory-watch"><div class="row"><h2>メモリ3社を比較</h2><a href="#news">関連ニュース ›</a></div><p class="muted">DRAM・HBMとNANDをまとめて確認</p>${[['MU','Micron','DRAM・HBM・NAND'],['SKHY','SK hynix','DRAM・HBM・NAND'],['SNDK','Sandisk','NAND・SSD']].map(([t,name,focus])=>{const q=quoteFor(data,t);return `<a class="memory-row" href="#stocks/${t}"><div><b>${t}</b><small>${name} · ${focus}</small></div><div><b>${Number.isFinite(q?.price)?'$'+num(q.price,2):'価格未取得'}</b><span class="${tone(q?.day)}">${pct(q?.day)}</span><small>${esc(q?.date||'更新待ち')}</small></div><span>›</span></a>`;}).join('')}<small>テーマの順位とは別の比較です。銘柄をタップするとチャート・確認条件・ニュースを表示します。</small></section>`;
}

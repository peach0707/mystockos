import {relation,dedupeNews,newsHealth,briefState} from './news-model.js';
import {newsNovelty} from './morning.js';
import {esc,empty,field,today,safeURL} from './ui.js';
import {picker} from './symbols.js';
import {timeLabel} from './freshness.js';

const TOPICS={all:'すべて',mine:'自分の銘柄',memory:'メモリ',optical:'光通信',compute:'AI半導体',equipment:'装置',storage:'NAND・ストレージ',MU:'MU',SKHY:'SKHY',SNDK:'SNDK',foundry:'先端半導体'};
export function articlesFor(data,s,filter='all'){
 const own=new Set([...s.watch,...s.holdings.map(h=>h.ticker)]);
 return dedupeNews(data.news?.value?.articles||[]).filter(n=>Date.parse(n.published_at)<=Date.now()).filter(n=>filter==='all'?true:filter==='mine'?!!relation(n,s).label:['MU','SKHY','SNDK'].includes(filter)?n.direct_tickers.includes(filter):filter==='memory'?n.topic==='memory'||n.direct_tickers.some(t=>['MU','SKHY','SNDK'].includes(t)):n.topic===filter).sort((a,b)=>b.published_at.localeCompare(a.published_at));
}
const brief=n=>n.brief?.status==='ready'&&n.brief?.basis==='article_body'?n.brief:null;
export function newsCard(n,s=null){const b=brief(n),state=briefState(n),related=s?relation(n,s).label:'';return `<a class="brief-card" href="#news/${encodeURIComponent(n.id)}"><div class="brief-meta"><span>${esc(s?newsNovelty(n,s):n.topic_label)}</span><time>${esc(n.published_at.slice(0,10))}</time></div>${related?`<p class="news-relation">${esc(related)}</p>`:''}<h3>${esc(b?.headline_ja||n.headline_ja)}</h3><p class="brief-impact">${esc(state.text)}</p><div class="brief-foot"><span>${esc(n.source)} · ${esc(state.label)}</span><b>要点を読む ›</b></div></a>`;}
export function newsPreview(data,s){
 const health=newsHealth(data),related=articlesFor(data,s,'mine'),unread=related.filter(n=>['新着','要約・内容の更新'].includes(newsNovelty(n,s)));
 const articles=[...unread,...related.filter(n=>!unread.includes(n))].slice(0,2);
 return `<p class="${health.ok?'muted':'warning'}">${esc(health.label)}</p>`+(health.ok&&s.morningBrief?.news?.previous&&!unread.length?'<p class="muted">前回取得以降、関連する新着・要約更新はありません。</p>':'')+(articles.map(n=>newsCard(n,s)).join('')||empty(health.ok?'取得した配信元の範囲では、関連する新情報はありません。':'関連ニュースの取得状況を確認できません。'))+`<p class="method-note">現在は半導体関連の公式発表を収集しています。対象外の銘柄はニュース未対応です。関連候補は波及が確定した企業ではありません。</p>`;
}

export function reportText(n){const b=brief(n);return `${b?.headline_ja||n.headline_ja}\n${b?.summary_ja||'本文要約待ち'}\n原文見出し：${n.title}\n公開：${n.published_at}\n\n影響の見立て（条件付き）\n${b?.impact_ja||n.impact}\n${b?.watch_ja||n.follow_up}\n発表元の銘柄：${n.direct_tickers.join(', ')||'米国上場銘柄なし'}\n波及を確認：${n.related_tickers.join(', ')}\n${n.url}`;}
export function weeklyGroups(articles,s,now=Date.now()){
 const own=new Set([...s.watch,...s.holdings.map(h=>h.ticker)]),groups=new Map();
 for(const n of articles){
  const age=now-Date.parse(n.published_at);
  if(age<0||age>7*86400000||!Number.isFinite(age))continue;
  if(!groups.has(n.topic))groups.set(n.topic,{label:n.topic_label,articles:[],tickers:new Set(),subjects:new Set()});
  const group=groups.get(n.topic);group.articles.push(n);
  [...n.direct_tickers,...n.related_tickers].filter(t=>own.has(t)).forEach(t=>group.tickers.add(t));
  (n.subjects||[]).forEach(t=>group.subjects.add(t));
 }
 return [...groups.values()].sort((a,b)=>b.articles.length-a.articles.length);
}
export function weeklyReportText(data,s,filter='all'){
 const groups=weeklyGroups(articlesFor(data,s,filter),s);
 return `半導体ニュース・直近7日の影響レポート\n取得確認：${timeLabel(data.news?.value?.checked_at)}（日本時間）\n本文の日本語要約と、事実とは区別した確認ポイントです。\n\n`+groups.map(g=>`${g.label}：${g.articles.length}件\n自分の関連銘柄：${[...g.tickers].join(', ')||'登録なし'}\n\n${g.articles.map(reportText).join('\n\n')}`).join('\n\n——\n\n');
}
function weeklyImpact(articles,s){
 const groups=weeklyGroups(articles,s);
 return `<section class="card impact-digest"><div class="row"><h2>分野別・7日間の影響</h2><button class="subtle" data-copy-week>まとめをコピー</button></div>${groups.map(g=>{const lead=g.articles.find(n=>n.importance==='high')||g.articles[0];return `<div class="digest-topic"><h3>${esc(g.label)} <span class="tag">${g.articles.length}件</span></h3><p class="digest-subjects">${esc([...g.subjects].slice(0,3).join(' / ')||'企業発表の動向')}</p><p>${esc(brief(lead)?.watch_ja||lead.follow_up)}</p>${g.tickers.size?`<small>自分の関連銘柄：${esc([...g.tickers].join('・'))}</small>`:''}<a href="#news/${encodeURIComponent(lead.id)}">${esc(lead.source)}の主な発表を確認 ›</a></div>`;}).join('')||'<p>直近7日の該当記事はありません。</p>'}<p class="method-note">取得した公式発表の範囲を集計しています。業界全体の網羅や、関連銘柄の株価上昇・下落を示すものではありません。</p></section>`;
}
function articleDetail(n,s){const b=brief(n);return `<a class="back" href="#news">‹ 半導体ニュース</a><article class="news-detail card"><div class="eyebrow">${esc(n.topic_label)} · 公式発表</div><h1>${esc(b?.headline_ja||n.headline_ja)}</h1><p class="muted">${esc(n.source)} · ${esc(timeLabel(n.published_at))} 公開（日本時間）</p><div class="fact-block"><h2>事実：発表の要点</h2><p>${esc(briefState(n).text)}</p><small>${b?'公式本文から日本語要約 · '+esc(timeLabel(b.checked_at))+' 確認（日本時間）':esc(briefState(n).label)}</small><details><summary>原文の見出し</summary><p lang="en">${esc(n.title)}</p></details></div><div class="impact-block"><h2>投資への影響を整理</h2><span class="tag caution">条件付きの見立て</span><p>${esc(b?.impact_ja||n.impact)}</p><h3>未確認・次に確認すること</h3><p>${esc(b?.watch_ja||n.follow_up)}</p></div><h2>自分との関連</h2><p>${esc(relation(n,s).label||'登録銘柄との関連は未確認')}</p><h2>関連する銘柄</h2><p class="muted">発表元</p><div class="ticker-links">${n.direct_tickers.map(t=>`<a href="#stocks/${encodeURIComponent(t)}">${esc(t)} ›</a>`).join('')||'<span>米国上場銘柄の登録なし</span>'}</div><p class="muted">波及を確認する候補</p><div class="ticker-links">${n.related_tickers.map(t=>`<a href="#stocks/${encodeURIComponent(t)}">${esc(t)} ›</a>`).join('')}</div><p class="method-note">関連候補は業界内の確認先です。発注先や受益企業として確定した情報ではありません。対象期間：${esc(n.horizon)}。</p><div class="actions">${safeURL(b?.article_url||n.url)?`<a class="button" href="${esc(safeURL(b?.article_url||n.url))}" target="_blank" rel="noopener noreferrer">公式発表を読む ↗</a>`:''}<button class="secondary" data-copy-report="${esc(n.id)}">レポートをコピー</button></div><details><summary>レポートの作成方法</summary><p>公式リンク先の本文を取得し、日本語で短くAI要約します。原文の数値・固有名詞は公式発表でも確認できます。本文取得・要約に失敗した記事は要約待ちと表示します。影響の見立ては推論であり、企業発表の独立した事実確認や将来の株価予測ではありません。</p><p>${b?.method==='source_review'?'この記事は公式本文と照合して要点を編集しています。':'要約モデル：Qwen2.5。更新サーバー内で処理しています。AI要約には誤りが含まれることがあります。'}</p><small>初回取得 ${esc(timeLabel(n.first_seen_at))}（日本時間）</small></details></article>`;}
function manualForm(){return `<a class="back" href="#news">‹ 半導体ニュース</a><section class="card"><h1>自分のニュースメモ</h1><form id="news-form">${field('title','タイトル','text','required maxlength="300"')}${field('date','公開日','date',`required value="${today()}"`)}${field('source','情報源','text','required')}${field('url','元ソース URL','url','required')}<label>重要度<select name="importance"><option value="normal">通常</option><option value="high">重要</option><option value="low">参考</option></select></label><label>方向<select name="sentiment"><option value="neutral">中立</option><option value="positive">ポジティブ</option><option value="negative">ネガティブ</option></select></label>${picker('tickers','',true)}${field('themes','関連テーマID（カンマ区切り）')}<label>3行の要点<textarea name="summary" rows="3" required></textarea></label><label>なぜ重要か<textarea name="why" required></textarea></label><label class="check"><input name="verified" type="checkbox">自分で一次情報を確認した</label><button>メモを保存</button></form></section>`;}
export function newsView(data,s,page='',filter='all'){
 if(page==='add')return manualForm();
 const payload=data.news?.value,articles=articlesFor(data,s,filter);
 if(page){const n=(payload?.articles||[]).find(n=>n.id===decodeURIComponent(page));return n?articleDetail(n,s):`<a class="back" href="#news">‹ ニュース</a>${empty('この記事は現在の保存対象外です。ニュース一覧を確認してください。')}`;}
 const now=Date.now(),week=articles.filter(n=>now-Date.parse(n.published_at)<=7*86400000&&Date.parse(n.published_at)<=now);
 const timely=newsHealth(data,now).ok;
 const healthy=payload?.sources?.filter(s=>s.status==='ok').length||0;
 const highlights=week.filter(n=>n.importance==='high'&&n.event!=='calendar').slice(0,3);
 return `<div class="page-heading"><div><span class="eyebrow">日本語で発表を確認</span><h1>ニュース</h1></div><button class="icon-button" data-refresh aria-label="ニュースを更新">↻</button></div><p class="page-intro">発表の要点と、自分の銘柄との関連を。</p><p class="method-note">半導体関連の公式発表が収集対象です。本文未取得・対象外の銘柄は、情報なしと判断しません。</p><section class="weekly-brief"><div class="row"><h2>直近7日の確認ポイント</h2><span class="tag">${week.length}件</span></div>${highlights.length?highlights.map(n=>`<a href="#news/${encodeURIComponent(n.id)}"><strong>${esc(brief(n)?.headline_ja||n.headline_ja)}</strong><span>${esc(briefState(n).text)}</span></a>`).join(''):`<p>${timely?'取得範囲では、この条件に合う重要な新情報はありません。':newsHealth(data,now).label}</p>`}<small>公式発表 ${healthy} / ${payload?.sources?.length||'—'} ソース取得 · ${esc(timeLabel(payload?.checked_at))} 確認（日本時間）</small></section>${!timely||payload?.status!=='ok'?`<p class="warning">${payload?.status==='failed'?'ニュース取得に失敗しました。保存済みの記事を表示しています。':!timely?'ニュースの更新確認が必要です。記事の公開日をご確認ください。':'一部の配信元を取得できません。取得できた記事を表示しています。'}</p>`:''}<div class="filter-chips" aria-label="ニュースの絞り込み">${Object.entries(TOPICS).map(([key,name])=>`<button data-news-filter="${key}" aria-pressed="${filter===key}">${name}</button>`).join('')}</div><details class="weekly-optional"><summary>7日間の分野別まとめ</summary>${weeklyImpact(articles,s)}</details><div class="brief-list">${articles.slice(0,40).map(n=>newsCard(n,s)).join('')||empty('この条件に合う記事はありません。')}</div><details class="card"><summary>配信元・取得状況</summary>${payload?.sources?.map(s=>`<p>${esc(s.name)} <span class="tag ${s.status==='ok'?'blue':'caution'}">${s.status==='ok'?'取得済み':'取得失敗'}</span></p>`).join('')||'<p>取得状況を読み込んでいます。</p>'}<p class="method-note">${esc(payload?.method||'公式フィードを自動収集します。')}</p></details><section class="card"><div class="row"><h2>自分のメモ</h2><a href="#news/add">＋ 追加</a></div>${s.news.map(n=>`<article class="manual-news"><small>${esc(n.date)} · 自分の記録</small><h3>${esc(n.title)}</h3><p>${n.summary.map(esc).join('<br>')}</p><p>${esc(n.why)}</p>${safeURL(n.url)?`<a target="_blank" rel="noopener noreferrer" href="${esc(safeURL(n.url))}">元ソース ↗</a>`:''}<button class="subtle" data-remove-news="${esc(n.id)}">削除</button></article>`).join('')||'<p class="muted">気になった材料を残せます。</p>'}</section>`;
}

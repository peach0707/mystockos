import {esc,empty,field,today,safeURL} from './ui.js';
import {picker} from './symbols.js';
import {timeLabel} from './freshness.js';

const TOPICS={all:'すべて',mine:'自分の銘柄',memory:'メモリ',optical:'光通信',compute:'AI半導体',equipment:'装置',storage:'ストレージ',foundry:'先端半導体'};
export function articlesFor(data,s,filter='all'){
 const own=new Set([...s.watch,...s.holdings.map(h=>h.ticker)]);
 return (data.news?.value?.articles||[]).filter(n=>filter==='all'||filter==='mine'?[...n.direct_tickers,...n.related_tickers].some(t=>own.has(t))||filter==='all':n.topic===filter).sort((a,b)=>b.published_at.localeCompare(a.published_at));
}
export function newsCard(n){return `<a class="brief-card" href="#news/${encodeURIComponent(n.id)}"><div class="brief-meta"><span>${esc(n.topic_label)}</span><time>${esc(n.published_at.slice(5,10).replace('-','/'))}</time></div><h3>${esc(n.headline_ja)}</h3><p class="brief-original" lang="en">${esc(n.title)}</p><p class="brief-impact">${esc(n.impact)}</p><div class="brief-foot"><span>${esc(n.source)} · 公式発表</span><b>影響を読む ›</b></div></a>`;}
export function newsPreview(data,s){const related=articlesFor(data,s,'mine');const articles=(related.length?related:articlesFor(data,s)).slice(0,2);return articles.map(newsCard).join('')||empty(data.news?.error?'ニュースを取得できません。更新状況を確認してください。':'ニュースを取得しています。公開済みの記事をここにまとめます。');}
export function reportText(n){return `${n.headline_ja}\n${n.title}\n公開：${n.published_at}\n\n影響の見立て（条件付き）\n${n.impact}\n${n.follow_up}\n発表元の銘柄：${n.direct_tickers.join(', ')||'米国上場銘柄なし'}\n波及を確認：${n.related_tickers.join(', ')}\n${n.url}`;}
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
 return `半導体ニュース・直近7日の影響レポート\n取得確認：${timeLabel(data.news?.value?.checked_at)}（日本時間）\n公式見出しの整理と条件付きの確認ポイントです。\n\n`+groups.map(g=>`${g.label}：${g.articles.length}件\n自分の関連銘柄：${[...g.tickers].join(', ')||'登録なし'}\n\n${g.articles.map(reportText).join('\n\n')}`).join('\n\n——\n\n');
}
function weeklyImpact(articles,s){
 const groups=weeklyGroups(articles,s);
 return `<section class="card impact-digest"><div class="row"><h2>分野別・7日間の影響</h2><button class="subtle" data-copy-week>まとめをコピー</button></div>${groups.map(g=>{const lead=g.articles.find(n=>n.importance==='high')||g.articles[0];return `<div class="digest-topic"><h3>${esc(g.label)} <span class="tag">${g.articles.length}件</span></h3><p class="digest-subjects">${esc([...g.subjects].slice(0,3).join(' / ')||'企業発表の動向')}</p><p>${esc(lead.follow_up)}</p>${g.tickers.size?`<small>自分の関連銘柄：${esc([...g.tickers].join('・'))}</small>`:''}<a href="#news/${encodeURIComponent(lead.id)}">${esc(lead.source)}の主な発表を確認 ›</a></div>`;}).join('')||'<p>直近7日の該当記事はありません。</p>'}<p class="method-note">取得した公式発表の範囲を集計しています。業界全体の網羅や、関連銘柄の株価上昇・下落を示すものではありません。</p></section>`;
}
function articleDetail(n){return `<a class="back" href="#news">‹ 半導体ニュース</a><article class="news-detail card"><div class="eyebrow">${esc(n.topic_label)} · 公式発表</div><h1>${esc(n.headline_ja)}</h1><p class="muted">${esc(n.source)} · ${esc(timeLabel(n.published_at))} 公開（日本時間）</p><div class="fact-block"><h2>発表されたこと</h2><p lang="en">${esc(n.title)}</p><small>公式RSSの見出し。本文全体の要約ではありません。</small></div><div class="impact-block"><h2>投資への影響を整理</h2><span class="tag caution">条件付きの見立て</span><p>${esc(n.impact)}</p><h3>次に確認すること</h3><p>${esc(n.follow_up)}</p></div><h2>関連する銘柄</h2><p class="muted">発表元</p><div class="ticker-links">${n.direct_tickers.map(t=>`<a href="#stocks/${encodeURIComponent(t)}">${esc(t)} ›</a>`).join('')||'<span>米国上場銘柄の登録なし</span>'}</div><p class="muted">波及を確認する候補</p><div class="ticker-links">${n.related_tickers.map(t=>`<a href="#stocks/${encodeURIComponent(t)}">${esc(t)} ›</a>`).join('')}</div><p class="method-note">関連候補は業界内の確認先です。発注先や受益企業として確定した情報ではありません。対象期間：${esc(n.horizon)}。</p><div class="actions">${safeURL(n.url)?`<a class="button" href="${esc(safeURL(n.url))}" target="_blank" rel="noopener noreferrer">公式発表を読む ↗</a>`:''}<button class="secondary" data-copy-report="${esc(n.id)}">レポートをコピー</button></div><details><summary>レポートの作成方法</summary><p>公式フィードの見出しからイベントを分類し、日本語の確認ポイントを作成しています。業績予想や株価方向を検証したレポートではありません。</p><small>初回取得 ${esc(timeLabel(n.first_seen_at))}（日本時間）</small></details></article>`;}
function manualForm(){return `<a class="back" href="#news">‹ 半導体ニュース</a><section class="card"><h1>自分のニュースメモ</h1><form id="news-form">${field('title','タイトル','text','required maxlength="300"')}${field('date','公開日','date',`required value="${today()}"`)}${field('source','情報源','text','required')}${field('url','元ソース URL','url','required')}<label>重要度<select name="importance"><option value="normal">通常</option><option value="high">重要</option><option value="low">参考</option></select></label><label>方向<select name="sentiment"><option value="neutral">中立</option><option value="positive">ポジティブ</option><option value="negative">ネガティブ</option></select></label>${picker('tickers','',true)}${field('themes','関連テーマID（カンマ区切り）')}<label>3行の要点<textarea name="summary" rows="3" required></textarea></label><label>なぜ重要か<textarea name="why" required></textarea></label><label class="check"><input name="verified" type="checkbox">自分で一次情報を確認した</label><button>メモを保存</button></form></section>`;}
export function newsView(data,s,page='',filter='all'){
 if(page==='add')return manualForm();
 const payload=data.news?.value,articles=articlesFor(data,s,filter);
 if(page){const n=(payload?.articles||[]).find(n=>n.id===decodeURIComponent(page));return n?articleDetail(n):`<a class="back" href="#news">‹ ニュース</a>${empty('この記事は現在の保存対象外です。ニュース一覧を確認してください。')}`;}
 const now=Date.now(),week=articles.filter(n=>now-Date.parse(n.published_at)<=7*86400000&&Date.parse(n.published_at)<=now);
 const timely=payload?.last_success_at&&now-Date.parse(payload.last_success_at)<8*3600000&&!data.news?.cached;
 const healthy=payload?.sources?.filter(s=>s.status==='ok').length||0;
 const highlights=week.filter(n=>n.importance==='high'&&n.event!=='calendar').slice(0,3);
 return `<div class="page-heading"><div><span class="eyebrow">SEMICONDUCTOR BRIEF</span><h1>半導体ニュース</h1></div><button class="icon-button" data-refresh aria-label="ニュースを更新">↻</button></div><p class="page-intro">発表の要点と、自分の銘柄への影響を。</p><section class="weekly-brief"><div class="row"><h2>直近7日の確認ポイント</h2><span class="tag">${week.length}件</span></div>${highlights.length?highlights.map(n=>`<a href="#news/${encodeURIComponent(n.id)}"><strong>${esc(n.headline_ja)}</strong><span>${esc(n.impact)}</span></a>`).join(''):`<p>${timely?'この条件に合う重要発表はありません。': '最新の取得状況を確認しています。'}</p>`}<small>公式発表 ${healthy} / ${payload?.sources?.length||'—'} ソース取得 · ${esc(timeLabel(payload?.checked_at))} 確認（日本時間）</small></section>${!timely||payload?.status!=='ok'?`<p class="warning">${payload?.status==='failed'?'ニュース取得に失敗しました。保存済みの記事を表示しています。':!timely?'ニュースの更新確認が必要です。記事の公開日をご確認ください。':'一部の配信元を取得できません。取得できた記事を表示しています。'}</p>`:''}<div class="filter-chips" aria-label="ニュースの絞り込み">${Object.entries(TOPICS).map(([key,name])=>`<button data-news-filter="${key}" aria-pressed="${filter===key}">${name}</button>`).join('')}</div>${weeklyImpact(articles,s)}<div class="brief-list">${articles.slice(0,40).map(newsCard).join('')||empty('この条件に合う記事はありません。')}</div><details class="card"><summary>配信元・取得状況</summary>${payload?.sources?.map(s=>`<p>${esc(s.name)} <span class="tag ${s.status==='ok'?'blue':'caution'}">${s.status==='ok'?'取得済み':'取得失敗'}</span></p>`).join('')||'<p>取得状況を読み込んでいます。</p>'}<p class="method-note">${esc(payload?.method||'公式フィードを自動収集します。')}</p></details><section class="card"><div class="row"><h2>自分のメモ</h2><a href="#news/add">＋ 追加</a></div>${s.news.map(n=>`<article class="manual-news"><small>${esc(n.date)} · 自分の記録</small><h3>${esc(n.title)}</h3><p>${n.summary.map(esc).join('<br>')}</p><p>${esc(n.why)}</p>${safeURL(n.url)?`<a target="_blank" rel="noopener noreferrer" href="${esc(safeURL(n.url))}">元ソース ↗</a>`:''}<button class="subtle" data-remove-news="${esc(n.id)}">削除</button></article>`).join('')||'<p class="muted">気になった材料を残せます。</p>'}</section>`;
}

import {breadthPanel} from './phase-b.js';
import {phaseDetails} from './phase-a.js';
import {esc,num,pct,empty,tabs} from './ui.js';
import {themeName,familyName,ja} from './display-ja.js';
import {themeInsight,themeFreshness,holdingLinks,returnMetric,velocityNames} from './theme-insights.js';

export const list = data => data.themes?.value?.themes || [];
export const ranked = data => list(data).filter(t => t.score_mode === 'ranked' && t.data_quality?.status === 'ok' && Number.isFinite(t.strength?.score)).sort((a,b) => b.strength.score - a.strength.score);
export const memberships = (data,ticker) => list(data).filter(t => [...(t.core_members || []), ...(t.related_members || []), ...(t.watch_members || [])].includes(ticker));
const link = t => `#themes/${encodeURIComponent(t.theme_id)}`;
const modeName = mode => ({ranked:'比較対象', thin:'少数構成・順位なし', heat_only:'短期の動き・順位なし', none:'ニュース・事業を観察'})[mode] || '参考表示';
const chip = (text,tone = 'neutral') => `<span class="theme-chip theme-${tone}">${esc(text)}</span>`;

function returnsPreview(t, phaseDate) {
  return `<div class="theme-performance">${[[5,'直近5日'],[21,'1か月']].map(([n,title]) => {
    const m = returnMetric(t.phaseA?.[`return_${n}d`]);
    return `<div><span>${title}</span><b class="${m?.value > 0 ? 'positive' : m?.value < 0 ? 'negative' : ''}">${m ? `${m.value > 0 ? '+' : ''}${num(m.value * 100,1)}%` : '取得待ち'}</b><small>${m ? `${m.eligible}/${m.total}銘柄${m.partial ? '・一部のみ' : ''}` : '必要な履歴を待っています'}</small></div>`;
  }).join('')}<small class="theme-performance-date">価格リターン・配当なし / ${esc(phaseDate || '基準日未確認')}</small></div>`;
}

function evidence(t,m) {
  const out = [], v = t.velocity || {}, b = t.heat?.breadth;
  if (m.insufficient) out.push(`${m.heatOnly ? '熱量' : '強さ'}の計算対象 ${m.heatOnly ? m.heatN : m.strengthN}/${m.total}銘柄`);
  if (m.changing && !m.insufficient) out.push(`直前：${velocityNames[v.state]} → 候補：${velocityNames[v.candidate] || velocityNames[v.raw_state] || '未取得'}（${num(v.candidate_days,0)}/5回確認）`);
  else if (m.strengthScore !== null && !m.insufficient && !m.heatOnly && !m.observation) out.push(`中期の強さ ${num(m.strengthScore)}/100・${m.strengthLabel}`);
  if (Number.isInteger(b?.eligible_n) && b.eligible_n > 0 && Number.isInteger(b.now_above) && b.now_above >= 0 && b.now_above <= b.eligible_n) out.push(`50日平均線より上の銘柄 ${b.now_above}/${b.eligible_n}`);
  if (m.missing.length) out.push(`計算対象外：${m.missing.join('・')}（必要な履歴等が不足）`);
  return out.slice(0,2);
}

export function themeCard(t,i,context = {}) {
  const m = themeInsight(t,context.freshness), held = holdingLinks(t,context.state);
  const isRanked = t.score_mode === 'ranked' && Number.isInteger(i);
  const searchable = [themeName(t),t.name,familyName(t.family),...(t.core_members || []),...(t.related_members || []),...(t.watch_members || [])].join(' ').toLowerCase();
  return `<article class="theme-reading-card" data-theme-card data-theme-id="${esc(t.theme_id)}" data-theme-search="${esc(searchable)}">
    <div class="theme-card-heading"><div><span class="theme-category">${isRanked ? `比較${context.rankCount || 5}テーマ中 ${i + 1}位` : esc(modeName(t.score_mode))}</span><h3><a href="${link(t)}">${esc(themeName(t))}<span aria-hidden="true"> ›</span></a></h3></div>${chip(m.coverageLabel,m.insufficient || m.partial ? 'caution' : 'neutral')}</div>
    ${held.length ? `<p class="theme-held">保有との関係：${held.map(h => `${esc(h.ticker)}（${h.role}）`).join('・')}</p>` : ''}
    <div class="theme-verdict theme-${m.tone}"><strong>${esc(m.title)}</strong><p>${esc(m.summary)}</p></div>
    ${m.observation ? '' : `<div class="theme-three-metrics"><div><span>中期の強さ</span><b>${m.strengthLabel}</b><small>${m.insufficient || m.heatOnly || m.strengthScore === null ? '順位で比較しません' : `${num(m.strengthScore)}/100`}</small></div><div><span>勢いの変化</span><b>${esc(m.velocityLabel)}</b><small>${m.changing && !m.insufficient ? 'まだ未確認' : m.insufficient ? '必要な履歴が不足' : '比較指数に対する動き'}</small></div><div><span>短期の熱量</span><b>${m.heatLabel}</b><small>${m.heatScore === null ? '数値なし' : m.insufficient ? '参考値・判断には不足' : `${num(m.heatScore)}/100${t.heat?.hot_eligible !== true ? '・参考' : ''}`}</small></div></div>`}
    ${evidence(t,m).length ? `<ul class="theme-evidence">${evidence(t,m).map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
    ${m.observation ? `<p class="theme-observe-members">${esc([...(t.core_members || []),...(t.related_members || []),...(t.watch_members || [])].slice(0,7).join(' · ') || '公開された関連銘柄を待っています')}</p>` : returnsPreview(t,context.phaseDate)}
    <div class="theme-card-footer"><span>${esc(context.freshness?.asOf || '基準日未確認')}時点</span><a href="${link(t)}" aria-label="${esc(themeName(t))}の根拠・確認ポイント">根拠・確認ポイント <span aria-hidden="true">→</span></a></div>
  </article>`;
}

function guide() {
  return `<details class="theme-guide"><summary>見方・信頼性を確認 <span>予測精度は未検証</span></summary><div class="theme-guide-content">
    <p>まず状態を読み、根拠と個別銘柄を確認します。テーマの順位は購入順位ではありません。</p>
    <dl><dt>中期の強さ</dt><dd>約3か月の比較指数に対する強さ。高いほど相対的に強く、割安さとは別です。</dd><dt>勢いの変化</dt><dd>相対的な位置と直近1か月の方向。「先行」は未来予測ではないため「相対的に上向き」と表示します。</dd><dt>短期の熱量</dt><dd>短期上昇・上昇銘柄の広がり・売買代金を合わせた指標。高い＝売り、低い＝買いではありません。</dd></dl>
    <p>データが揃っていることと、予測が当たることは別です。将来の勝率・予測精度は未検証です。</p>
  </div></details>`;
}

function trust(t,m,context) {
  const f = context.freshness;
  return `<section class="theme-panel theme-trust"><h2>この表示をどこまで使える？</h2>
    <dl><dt>データの時点</dt><dd>${esc(f?.asOf || context.themeDate || '未確認')} / ${esc(f?.label || '更新状況未確認')}</dd><dt>計算できた範囲</dt><dd>強さ ${m.strengthN}/${m.total}銘柄・熱量 ${m.heatN}/${m.total}銘柄<br>${esc(m.coverageLabel)}</dd><dt>予測の信頼性</dt><dd><b>予測精度は未検証</b><br>現在までの値動きの整理です。勝率や将来リターンの保証はありません。</dd><dt>データ取得元</dt><dd>${esc(context.source || '未確認')} / 日足</dd><dt>比較基準</dt><dd>${esc(t.benchmark || '対象外')}${t.benchmark === 'SPY' ? '（S&P 500連動ETF）' : ''}</dd></dl>
    ${m.missing.length ? `<p class="theme-data-note">計算対象外：${esc(m.missing.join('・'))}。価格が表示できても、スコアに必要な長期履歴が不足している場合があります。</p>` : ''}
    ${t.score_mode === 'thin' ? '<p class="theme-data-note">少数構成のため個別銘柄の影響が大きく、ほかのテーマとは順位を比較しません。</p>' : ''}
    ${context.phaseDate !== context.themeDate ? `<p class="theme-data-note">期間別リターンの基準日は ${esc(context.phaseDate || '未確認')}。テーマ判定とは基準日が異なります。</p>` : ''}
  </section>`;
}

function scoreBreakdown(t,m) {
  const v = t.velocity || {}, h = t.heat || {}, s = t.strength || {};
  const factors = (values,labels) => `<dl>${labels.map(([key,name]) => `<dt>${name}</dt><dd>${num(values?.[key])}/100</dd>`).join('')}</dl>`;
  return `<details class="theme-panel theme-calculation"><summary>計算の内訳・判定ルールを見る</summary><div>
    <h3>中期の強さ：${num(m.strengthScore)}/100</h3><p>63営業日のリスク調整後の相対強度を70%、比較指数を上回る日々の一貫性を30%で集計。75以上は強い、60以上はやや強い、45以上は中立、30以上はやや弱い、30未満は弱い。</p>
    ${factors(s.factor_scores,[['risk_adjusted_relative_strength','値動きの大きさを調整した相対強度'],['relative_trend_consistency','比較指数を上回る一貫性']])}
    <h3>勢い：${esc(m.velocityLabel)}</h3><p>比較指数に対する価格系列の63日平均からの位置と、21営業日の変化を組み合わせます。状態の切替は同じ候補を5回確認する条件です。「確認済み」は予測の的中を意味しません。</p>
    <dl><dt>保存されている状態</dt><dd>${esc(velocityNames[v.state] || '判定対象外')}</dd><dt>いまの候補</dt><dd>${esc(velocityNames[v.candidate] || velocityNames[v.raw_state] || '判定対象外')}${m.changing ? ` / ${num(v.candidate_days,0)}回確認・未確認` : ''}</dd><dt>相対系列の63日平均からの位置</dt><dd>${pct(Number.isFinite(v.rs_level) ? v.rs_level * 100 : null)}</dd><dt>相対系列の21日変化</dt><dd>${pct(Number.isFinite(v.rs_momentum) ? v.rs_momentum * 100 : null)}</dd></dl>
    <h3>短期の熱量：${num(m.heatScore)}/100</h3><p>10営業日のリスク調整後の超過リターン、50日平均線を上回る銘柄割合の変化、売買代金の異常度を各3分の1で集計。</p>
    ${factors(h.factor_scores,[['risk_adjusted_excess_return','短期の超過リターン'],['breadth_change','上昇の広がりの変化'],['dollar_volume_robust_z','売買代金の異常度']])}
    <p>正式な過熱条件は、有効3銘柄以上・75点以上・過半数が上昇・主導銘柄を除いても60点以上・1銘柄の売買代金比率60%以下。点数だけでは判定しません。1〜2銘柄の場合は参考値です。</p>
    <dl><dt>主導銘柄を除いた熱量</dt><dd>${num(h.leave_one_out?.score)}${h.leave_one_out?.removed ? `（${esc(h.leave_one_out.removed)}を除外）` : ''}</dd><dt>最大1銘柄の売買代金比率</dt><dd>${Number.isFinite(h.activity?.max_dollar_volume_share) ? `${num(h.activity.max_dollar_volume_share * 100)}%` : '未取得'}</dd><dt>反転条件</dt><dd>${t.turning_watch?.eligible !== true ? '判定対象外' : m.turning ? '該当' : '非該当'}</dd></dl>
    <p>反転は売られすぎと改善条件の両方が必要です。確認できた要素：${esc((t.turning_watch?.reasons || []).map(ja).join('・') || 'なし')}。一部の要素だけでは反転とは扱いません。</p>
    <p>計算はテーマ判定システム v1.0。ニュースなどの材料はスコアに加算しません。</p>
  </div></details>`;
}

export function themeDetail(t,phaseA = null,asOf = null,themeAsOf = null,context = {}) {
  const m = themeInsight(t,context.freshness), ctx = {...context,phaseDate:asOf,themeDate:themeAsOf};
  const held = holdingLinks(t,context.state);
  return `<div class="theme-workspace theme-detail-v2"><a class="back" href="#themes">‹ テーマ一覧</a><div class="theme-detail-heading"><span class="eyebrow">${esc(familyName(t.family))} / ${esc(modeName(t.score_mode))}</span><h1>${esc(themeName(t))}</h1>${chip(m.coverageLabel,m.insufficient ? 'caution' : 'neutral')}</div>
    <section class="theme-verdict theme-detail-verdict theme-${m.tone}"><span>今の読み取り</span><h2>${esc(m.title)}</h2><p>${esc(m.summary)}</p>${context.freshness && !context.freshness.usable && !m.observation ? `<small>記録時点：${esc(m.snapshotTitle)}</small>` : ''}</section>
    <section class="theme-panel theme-next"><h2>次に確認すること</h2><div><span>これから調べるなら</span><p>${esc(m.explore)}</p></div><div><span>保有しているなら</span><p>${esc(m.holding)}</p></div>${held.length ? `<p class="theme-held">あなたの保有：${held.map(h => `<a href="#stocks/${encodeURIComponent(h.ticker)}">${esc(h.ticker)}（${h.role}） ›</a>`).join('　')}</p>` : ''}<small>売買指示ではなく、確認する順番の目安です。</small></section>
    ${trust(t,m,ctx)}
    ${!m.observation ? `<section class="theme-panel"><h2>読み取りの根拠</h2><ul class="theme-evidence">${evidence(t,m).map(x => `<li>${esc(x)}</li>`).join('')}</ul>${breadthPanel(t,themeAsOf)}</section>` : ''}
    <section class="theme-panel">${phaseDetails(phaseA,asOf,{ranked:t.score_mode === 'ranked'})}</section>
    <section class="theme-panel"><h2>銘柄を詳しく見る</h2>${[['計算対象',t.core_members],['関連銘柄・スコア対象外',t.related_members],['観察銘柄・スコア対象外',t.watch_members]].filter(([,xs])=>xs?.length).map(([label,xs])=>`<p>${label}</p><div class="theme-member-links">${xs.map(x=>`<a href="#stocks/${encodeURIComponent(x)}">${esc(x)}${x==='SNDK'?'（NAND・SSD）':''} ›</a>`).join('')}</div>`).join('')}</section>
    ${!m.observation ? scoreBreakdown(t,m) : ''}
    ${t.overlay ? `<section class="theme-panel"><h2>参考情報（スコア対象外）</h2><p>${esc(t.overlay.ticker)} · 1日 ${pct(t.overlay.return_1d * 100)} / 10日 ${pct(t.overlay.return_10d * 100)} / 21日 ${pct(t.overlay.return_21d * 100)}</p></section>` : ''}
    ${guide()}<p class="theme-footnote">基準日 ${esc(themeAsOf || '未確認')}。現在の値動きから将来の上昇確率や資金流入を断定しません。</p></div>`;
}

export const themeTable = (ts,context = {}) => `<div class="theme-cards">${ts.map(t => themeCard(t,context.ranks?.get(t.theme_id),context)).join('')}</div>`;
function groups(ts,context) {
  let html = '';
  const titles = {ranked:'比較できるテーマ',thin:'少数銘柄のテーマ',heat_only:'短期の動きに注目するテーマ',none:'ニュース・事業を観察するテーマ'};
  const notes = {ranked:'中期の強さ順。購入順位ではありません。',thin:'銘柄数が少ないため、テーマ間の順位は付けません。',heat_only:'中期の強さでは比較せず、短期の熱量を見ます。',none:'スコアの対象外。関連銘柄と事業の進展を確認します。'};
  for (const mode of ['ranked','thin','heat_only','none']) {
    const group = ts.filter(t => t.score_mode === mode);if (!group.length) continue;
    const body = mode === 'ranked' ? themeTable(group,context) : [...new Set(group.map(t => t.family))].map(f => `<section class="theme-family" data-theme-group><h3 class="theme-family-title">${esc(familyName(f))}</h3>${themeTable(group.filter(t => t.family === f),context)}</section>`).join('');
    html += `<section class="theme-section" data-theme-group>${mode === 'none' ? '<details data-theme-observations><summary>' : '<div class="theme-section-title">'}<h2>${titles[mode]}</h2><span data-theme-group-count>${group.length}テーマ</span>${mode === 'none' ? '</summary>' : '</div>'}<p class="theme-section-note">${notes[mode]}</p>${body}${mode === 'none' ? '</details>' : ''}</section>`;
  }
  return html;
}

export function themesView(data,tab = 'rank',page,state = {}) {
  const freshness = themeFreshness(data), ordered = ranked(data), ranks = new Map(ordered.map((t,i) => [t.theme_id,i]));
  const ts = list(data).map(t => ({...t,phaseA:data.phaseA?.themes?.[t.theme_id]})).sort((a,b) => (ranks.get(a.theme_id) ?? 100) - (ranks.get(b.theme_id) ?? 100));
  const context = {freshness,state,phaseDate:data.phaseA?.as_of,source:data.themes?.value?.data_source,ranks,rankCount:ordered.length};
  if (page) {
    let id;try {id = decodeURIComponent(page);} catch {return empty('テーマが見つかりません。');}
    const t = ts.find(t => t.theme_id === id);return t ? themeDetail(t,t.phaseA,data.phaseA?.as_of,freshness.asOf,context) : empty('テーマが見つかりません。');
  }
  if (!data.themes?.value) return '<h1>テーマ</h1>' + empty('テーマデータを取得できません。更新ボタンで再確認してください。') + '<button data-refresh>再読み込み</button>';
  const models = ts.map(t => ({t,m:themeInsight(t,freshness)}));
  const held = models.filter(({t}) => holdingLinks(t,state).length), early = models.filter(({m}) => !m.insufficient && !m.observation && (m.changing || m.turning)), weak = models.filter(({m}) => m.attention);
  const shown = tab === 'held' ? held : tab === 'early' ? early : tab === 'weak' ? weak : models;
  const scope = {rank:'すべてのテーマ',held:'保有銘柄に関係するテーマ',early:'変化を観察するテーマ',weak:'注意点があるテーマ'};
  return `<div class="theme-workspace" data-theme-search-root><div class="page-heading"><div><span class="eyebrow">相場の流れを、根拠から。</span><h1>テーマを読む</h1></div><span class="theme-version">新しい見方</span></div>
    <div class="theme-freshness"><span class="status-dot ${freshness.usable ? 'is-current' : ''}"></span><span>${esc(freshness.asOf || '未取得')} 米国日足<br><b>${esc(freshness.label)}</b></span><button data-refresh aria-label="テーマデータを更新">↻</button></div>
    <section class="theme-overview"><span>${freshness.usable ? '今日の見どころ' : '保存された日足の状態・最新ではありません'}</span><div class="theme-overview-counts"><div><strong>${models.filter(({m}) => m.hot).length}</strong><span>短期が活発</span></div><div><strong>${early.length}</strong><span>変化を確認中</span></div><div><strong>${models.filter(({m}) => m.insufficient).length}</strong><span>データ不足</span></div></div></section>
    ${guide()}
    ${tabs([['rank','すべて'],['held',`保有に関連 ${held.length}`],['early','変化の兆し'],['weak','注意点']],tab,'themeTab')}
    <label class="theme-search"><input type="search" data-theme-query placeholder="テーマ・銘柄を検索（メモリ、MU…）" aria-label="テーマ名・銘柄コードで絞り込む"></label>
    <div class="theme-results-heading"><h2>${scope[tab] || scope.rank}</h2><span data-theme-count aria-live="polite">${shown.length}テーマ</span></div>
    ${shown.length ? groups(shown.map(x => x.t),context) : `<div class="theme-empty"><h3>${tab === 'held' ? '関連するテーマはありません' : tab === 'early' ? '変化の確認対象はありません' : '該当するテーマはありません'}</h3><p>${tab === 'held' ? 'このアプリに登録された保有銘柄と、中核・関連・観察銘柄を照合しています。テーマに未分類の銘柄やETFは表示されない場合があります。' : '条件に該当しないことは、今後の安全性や上昇を保証するものではありません。'}</p>${tab === 'held' ? '<a href="#portfolio">保有銘柄を確認する ›</a>' : ''}</div>`}
    <div class="theme-empty" data-theme-no-results hidden>一致するテーマはありません。別の名前や銘柄コードで検索してください。</div>
    <p class="theme-footnote">テーマ判定システム v1.0 / ${esc(context.source || '取得元未確認')}。先行予測・下落確率の未検証スコアは表示しません。</p></div>`;
}

export function filterThemeCards(root,query) {
  const q = query.trim().normalize('NFKC').toLowerCase();let visible = 0;
  root.querySelectorAll('[data-theme-card]').forEach(card => {card.hidden = !card.dataset.themeSearch.normalize('NFKC').includes(q);if (!card.hidden) visible++;});
  root.querySelectorAll('[data-theme-group]').forEach(group => {const size=group.querySelectorAll('[data-theme-card]:not([hidden])').length;group.hidden = !size;const label=group.querySelector('[data-theme-group-count]');if(label)label.textContent=`${size}テーマ`;});
  root.querySelectorAll('[data-theme-observations]').forEach(details => {if (q && details.dataset.searchOpen === undefined) details.dataset.searchOpen = String(details.open);if (q) details.open = true;else if (details.dataset.searchOpen !== undefined) {details.open = details.dataset.searchOpen === 'true';delete details.dataset.searchOpen;}});
  const count = root.querySelector('[data-theme-count]'), none = root.querySelector('[data-theme-no-results]');
  if (count) count.textContent = `${visible}テーマ`;if (none) none.hidden = visible > 0 || !q;
}

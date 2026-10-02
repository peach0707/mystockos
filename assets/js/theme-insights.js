// Read-only explanations of the frozen v1 output. These are not new signals.
import {dateState} from './freshness.js';

const finite = x => typeof x === 'number' && Number.isFinite(x);
const score = x => finite(x) && x >= 0 && x <= 100 ? x : null;
const count = x => Number.isInteger(x) && x >= 0 ? x : null;
export const velocityNames = {Leading:'相対的に上向き', Improving:'改善中', Weakening:'勢いが鈍化', Lagging:'相対的に下向き'};

export function themeFreshness(data = {}, now = Date.now()) {
  const feed = data.themes, asOf = feed?.value?.as_of;
  const result = dateState(asOf, data.calendar?.value, now);
  const cached = !!(feed?.cached || feed?.error);
  return {...result, asOf, cached, usable:result.state === 'current' && !cached,
    label:cached ? '再取得待ち・保存データ' : result.state === 'current' ? '確定日足・更新済み' : result.state === 'stale' ? '更新待ち・以前の日足' : result.state === 'invalid' ? '基準日を確認' : '更新状況を確認中'};
}

export function themeInsight(t, freshness = null) {
  const q = t.data_quality || {}, v = t.velocity || {}, h = t.heat || {};
  const total = count(q.core_total) ?? t.core_members?.length ?? 0;
  const strengthN = count(q.strength_eligible_n) ?? count(t.strength?.eligible_n) ?? 0;
  const heatN = count(q.heat_eligible_n) ?? count(h.eligible_n) ?? 0;
  const observation = t.score_mode === 'none', heatOnly = t.score_mode === 'heat_only';
  const strengthScore = score(t.strength?.score), heatScore = score(h.score);
  const minimum = t.score_mode === 'ranked' ? 4 : 2;
  const insufficient = !observation && (q.status === 'insufficient' || (heatOnly ? heatN < 2 || heatScore === null : strengthN < minimum || strengthScore === null));
  const partial = !insufficient && !observation && (heatOnly ? heatN < total : strengthN < total);
  const unavailable = freshness && !freshness.usable;
  const changing = !!velocityNames[v.state] && v.confirmed !== true;
  const hot = h.hot === true && h.hot_eligible === true && heatN >= 3 && heatScore !== null;
  const concentrated = h.single_stock_driven === true && heatScore !== null;
  const turning = t.turning_watch?.active === true && t.turning_watch?.eligible === true;
  const strengthLabel = observation || heatOnly ? '対象外' : insufficient ? '判定保留' : strengthScore >= 75 ? '強い' : strengthScore >= 60 ? 'やや強い' : strengthScore >= 45 ? '中立' : strengthScore >= 30 ? 'やや弱い' : '弱い';
  const heatLabel = observation ? '対象外' : heatScore === null ? '取得待ち' : h.hot_eligible !== true || heatN < 3 ? '参考値のみ' : concentrated ? '一部銘柄に集中' : hot ? '活発・急変に注意' : '過熱条件なし';
  const velocityLabel = observation ? '対象外' : insufficient || !velocityNames[v.state] ? '判定保留' : changing ? '切替を確認中' : velocityNames[v.state];
  let title, summary, tone = 'neutral', explore, holding;
  if (observation) {
    title = 'ニュースと個別銘柄を確認';
    summary = '観察用テーマです。値動きのスコアやテーマ間順位は付けていません。';
    explore = '関連銘柄の事業内容と公式発表を確認。';
    holding = 'テーマ名だけで判断せず、保有銘柄の投資根拠を確認。';
  } else if (insufficient) {
    title = 'データ不足のため判断を保留';
    summary = `計算に使える中核銘柄は${heatOnly ? heatN : strengthN}/${total}銘柄。テーマ全体の強さを判断できません。`;
    explore = '取得できている個別銘柄の価格と、不足している履歴を確認。';
    holding = 'このテーマの数値だけで保有方針を変えず、個別銘柄を確認。';
  } else if (concentrated) {
    title = '一部の銘柄に動きが集中'; tone = 'caution';
    summary = '短期の熱量は高めですが、広い銘柄への波及は確認できません。';
    explore = '動きを主導する銘柄と、ほかの構成銘柄の差を確認。';
    holding = '保有銘柄が動きの中心なのか、テーマ名に引っ張られていないか確認。';
  } else if (hot) {
    title = changing ? '短期は活発。勢いの切替待ち' : '短期の動きが活発'; tone = 'caution';
    summary = '短期上昇・上昇の広がり・売買代金を合わせた過熱条件に該当。天井や下落の予測ではありません。';
    explore = '直近の急騰幅・出来高と決算日を、個別銘柄で確認。';
    holding = '値動きが大きくなった場合の保有比率と、投資根拠の変化を確認。';
  } else if (changing) {
    title = '勢いの変化を確認中'; tone = 'watch';
    summary = `いまの候補は「${velocityNames[v.candidate] || velocityNames[v.raw_state] || '未取得'}」。まだ状態の切替は確定していません。`;
    explore = '次回以降も同じ方向が続き、複数銘柄に広がるか確認。';
    holding = '1回の変化だけで結論を出さず、構成銘柄の動きを確認。';
  } else if (v.state === 'Weakening' || v.state === 'Lagging') {
    title = v.state === 'Weakening' ? '相対的な勢いが鈍化' : '相対的に弱い動き'; tone = 'caution';
    summary = '比較指数に対する値動きに弱さがあります。割安・買い時という意味ではありません。';
    explore = '弱さが一時的か、業績や公式発表に変化があるか確認。';
    holding = '保有理由が続いているか、個別銘柄の下落条件とあわせて確認。';
  } else if (turning || v.state === 'Improving') {
    title = turning ? '反転の兆しを観察' : '相対的な動きが改善'; tone = 'watch';
    summary = turning ? '売られすぎと反転条件の両方に該当しています。上昇の継続はまだ分かりません。' : '相対的な位置は弱いものの、直近の勢いには改善が見られます。';
    explore = '改善が続くか、出来高と上昇銘柄の広がりを確認。';
    holding = '回復が保有銘柄にも及んでいるか、個別の値動きを確認。';
  } else if (v.state === 'Leading' && strengthScore >= 60 && !heatOnly) {
    title = '相対的な強さが継続'; tone = 'steady';
    summary = '中期の強さと相対的な勢いがそろっています。購入価格の割安さを示すものではありません。';
    explore = '構成銘柄の価格位置・業績・決算日を確認。';
    holding = '投資根拠と保有比率を確認し、強さが続いているか観察。';
  } else {
    title = heatOnly ? '短期の動きを観察' : '強弱が入り交じる状態';
    summary = heatOnly ? '短期の熱量を確認するテーマです。中期の強さランキングには含めません。' : '強さと勢いを合わせ、構成銘柄ごとの違いを確認する段階です。';
    explore = '一つの数値だけで判断せず、構成銘柄のリターンと業績を確認。';
    holding = 'テーマ全体と自分の保有銘柄の動きを見比べる。';
  }
  const snapshotTitle = title;
  if (unavailable && !observation) {
    title = '最新データを確認してから判断'; tone = 'neutral';
    summary = `${freshness.label}です。以下は${freshness.asOf || '基準日未確認'}時点の状態です。`;
    explore = '更新ボタンで基準日を確認。以前の日足を現在の状態と取り違えない。';
    holding = '最新の個別銘柄データを確認してから、投資根拠と照らし合わせる。';
  }
  const eligible = heatOnly ? h.eligible_members : t.strength?.eligible_members;
  const missing = Array.isArray(eligible) ? (t.core_members || []).filter(x => !eligible.includes(x)) : q.missing_core_data || [];
  return {title, snapshotTitle, summary, tone, explore, holding, total, strengthN, heatN, strengthScore, heatScore,
    strengthLabel, velocityLabel, heatLabel, insufficient, partial, observation, heatOnly, changing, hot, concentrated, turning, missing,
    attention:!observation && (insufficient || partial || unavailable || hot || concentrated || ['Weakening','Lagging'].includes(v.state)),
    coverageLabel:observation ? '観察用' : insufficient ? '計算データ不足' : partial ? '一部の銘柄で計算' : t.score_mode === 'thin' ? '少数銘柄の参考値' : '計算データあり'};
}

export function holdingLinks(t, state = {}) {
  const tickers = [...new Set((state.holdings || []).map(h => h.ticker))];
  return tickers.flatMap(ticker => (t.core_members || []).includes(ticker) ? [{ticker, role:'中核'}] : (t.related_members || []).includes(ticker) ? [{ticker, role:'関連'}] : (t.watch_members || []).includes(ticker) ? [{ticker, role:'観察'}] : []);
}

export function returnMetric(m) {
  if (!m || !['ok','partial'].includes(m.status) || !finite(m.value) || !Number.isInteger(m.eligible_n) || m.eligible_n < 1 || !Number.isInteger(m.total_n) || m.total_n < m.eligible_n) return null;
  return {value:m.value, eligible:m.eligible_n, total:m.total_n, partial:m.status === 'partial' || m.eligible_n < m.total_n, date:m.as_of};
}

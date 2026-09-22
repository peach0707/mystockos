import {esc,dateValid} from './ui.js';

export function expectedSession(calendar, now=Date.now()) {
  const day=new Date(now).toISOString().slice(0,10);
  if(!calendar || day<calendar.start || day>calendar.end || !Array.isArray(calendar.sessions))return null;
  return calendar.sessions.filter(s=>dateValid(s.date)&&Date.parse(s.close)+30*60*1000<=now).at(-1)?.date||null;
}
export function dateState(date,calendar,now=Date.now()) {
  const expected=expectedSession(calendar,now);
  if(!dateValid(date))return {state:'missing',label:'未取得',expected};
  if(date>new Date(now).toISOString().slice(0,10))return {state:'invalid',label:'日付を確認',expected};
  if(!expected)return {state:'unknown',label:'営業日を確認中',expected};
  // Do not accept an unclosed/future trading session as fresh.
  if(date>expected)return {state:'invalid',label:'確定日足を待つ',expected};
  return {state:date===expected?'current':'stale',label:date===expected?'更新済み':'更新待ち',expected};
}
export function timeLabel(stamp){if(!stamp||!Number.isFinite(Date.parse(stamp)))return '未確認';return new Date(stamp).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false});}
export function freshnessBar(data){
  const calendar=data.calendar?.value, date=data.stocks?.value?.stocks?.[0]?.date, state=dateState(date,calendar);
  const problems=Object.values(data).filter(x=>x?.error).length;
  return `<div class="freshness ${state.state==='current'&&!problems?'fresh':'pending'}"><span class="status-dot"></span><span>米国 ${esc(date||'—')} 終値 <b>${problems?'一部取得できません':esc(state.label)}</b></span><button type="button" data-refresh aria-label="データを更新">↻</button></div>`;
}
export function updateDetails(data){return `<details class="update-details"><summary>データの更新状況</summary><div class="update-grid">${[['stocks','株価',data.stocks?.value?.stocks?.[0]?.date],['setups','銘柄チェック',data.setups?.value?.as_of],['themes','テーマ',data.themes?.value?.as_of],['regime','市場',data.regime?.value?.as_of]].map(([key,name,date])=>`<div><span>${name}</span><b>${esc(date||'未取得')}</b><small>${data[key]?.error?'取得失敗・保存分':dateState(date,data.calendar?.value).label}</small></div>`).join('')}</div><p>日足で確認します。株価は約30分ごと、銘柄チェックは米国営業日の翌朝、ニュースは約3時間ごとに取得します。処理状況によって遅れる場合があります。</p><p>画面の確認：${esc(timeLabel(data.checkedAt))}（日本時間）</p></details>`;}

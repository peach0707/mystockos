export const ownTickers=s=>[...new Set([...s.holdings.map(h=>h.ticker),...s.watch])];
// Only explicit underlying exposure; unrelated stocks are never inferred.
const UNDERLYING={MUU:'MU',MULL:'MU',SNDU:'SNDK',NVDL:'NVDA',NVDU:'NVDA',TSLL:'TSLA',AMDL:'AMD',AVGX:'AVGO'};
export const exposure=t=>UNDERLYING[t]||t;
export const memoryRelevant=s=>ownTickers(s).some(t=>['MU','SKHY','SNDK','DRAM'].includes(exposure(t)));
export function relation(n,s){
 const own=ownTickers(s),direct=own.filter(t=>(n.direct_tickers||[]).includes(exposure(t))),indirect=own.filter(t=>!direct.includes(t)&&(n.related_tickers||[]).includes(exposure(t)));
 return {direct,indirect,label:direct.length?`発表元に関連：${direct.join('・')}`:indirect.length?`波及を確認：${indirect.join('・')}（未確定）`:''};
}
export function articleKey(n){try{const u=new URL(n.brief?.article_url||n.url);u.hash='';for(const k of [...u.searchParams.keys()])if(/^utm_|^(fbclid|gclid|ref)$/i.test(k))u.searchParams.delete(k);u.pathname=u.pathname.replace(/\/$/,'');return u.href;}catch{return n.id;}}
export const articleVersion=n=>n.title+'|'+(n.brief?.status==='ready'&&n.brief?.basis==='article_body'?n.brief.summary_ja||'':'');
export function dedupeNews(articles){
 const urls=new Set(),titles=new Set(),rows=[];
 for(const n of [...articles].sort((a,b)=>b.published_at.localeCompare(a.published_at))){
  const key=articleKey(n),title=(n.title||'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
  // Match exact headlines before checking the narrow editorial-prefix variant.
  const eventTitle=x=>(x.title||'').replace(/^(?:“[^”]{3,180}”|"[^"]{3,180}")\s*[—–:]\s*/u,'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
  // Some official feeds publish both a plain title and the same title preceded
  // by a quoted editorial lead. Merge only that exact suffix, publisher and day;
  // altered numbers and follow-up titles remain distinct.
  const sameAnnouncement=rows.some(r=>r.source_id&&r.source_id===n.source_id&&r.published_at.slice(0,10)===n.published_at.slice(0,10)&&eventTitle(n).length>=48&&eventTitle(n)===eventTitle(r)&&(n.title.match(/\d+(?:[.,]\d+)*/g)||[]).join('|')===(r.title.match(/\d+(?:[.,]\d+)*/g)||[]).join('|'));
  if(urls.has(key)||title&&titles.has(title)||sameAnnouncement)continue;
  urls.add(key);if(title)titles.add(title);rows.push(n);
 }return rows;
}
export function newsHealth(data,now=Date.now()){
 const p=data.news?.value;
 if(!p)return {ok:false,label:data.news?.error?'ニュースを取得できませんでした':'ニュースを確認しています'};
 if(data.news?.error||data.news?.cached||p.status==='failed')return {ok:false,label:'ニュース取得に失敗・保存済みの記事を表示'};
 if(p.status!=='ok'||p.sources?.some(s=>s.status!=='ok'))return {ok:false,label:'一部の配信元を取得できませんでした'};
 if(!p.checked_at||now-Date.parse(p.checked_at)>8*3600000||Date.parse(p.checked_at)>now)return {ok:false,label:'ニュースの更新確認が必要です'};
 return {ok:true,label:'配信元の取得を確認済み'};
}
export function briefState(n){
 const b=n.brief;
 if(b?.status==='ready'&&b.basis==='article_body')return {ready:true,label:'本文から日本語要約',text:b.summary_ja};
 if(b?.status==='pending'&&b.reason)return {ready:false,label:b.failure_stage==='model'?'本文取得済み・要約失敗':'本文・要約の取得失敗',text:b.failure_stage==='model'?'本文は取得しましたが、日本語要約に失敗しました。原文で確認してください。':'本文の日本語要約を取得できていません。見出しだけでは内容を判断しません。'};
 return {ready:false,label:'本文要約待ち',text:'本文の取得・日本語要約は未完了です。見出しだけでは内容を判断しません。'};
}

export const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const num = (v,d=1) => typeof v === 'number' && Number.isFinite(v) ? v.toLocaleString('ja-JP',{maximumFractionDigits:d}) : '—';
export const yen = v => typeof v === 'number' && Number.isFinite(v) ? `¥${num(v,0)}` : '未記録';
export const pct = v => typeof v === 'number' && Number.isFinite(v) ? `${v>0?'+':''}${num(v,2)}%` : '—';
export const tone = v => typeof v==='number' ? v>0?'positive':v<0?'negative':'' : '';
export const empty = text => `<div class="empty">${esc(text)}</div>`;
export const metric = (label,value,small='') => `<div class="metric"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(small)}</small></div>`;
export const tabs = (items,current,key) => `<div class="tabs" role="group" aria-label="表示切替">${items.map(([id,name])=>`<button data-tab="${key}" data-value="${id}" aria-pressed="${id===current}">${name}</button>`).join('')}</div>`;
export const field = (name,label,type='text',extra='') => `<label>${label}<input name="${name}" type="${type}" ${extra}></label>`;
export const today = () => new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Tokyo'});
export const dateValid = s => typeof s==='string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0,10)===s;
export const labels = {Bull:'強気',Bear:'弱気',Neutral:'中立',Stable:'安定',Medium:'中',High:'高',Low:'低',Leading:'先行',Improving:'改善',Weakening:'減速',Lagging:'出遅れ',ranked:'ランキング対象',thin:'少数構成',heat_only:'過熱度のみ',none:'観察のみ'};
export const label = s => labels[s] || s || '未判定';
export function safeURL(s){try{const u=new URL(s);return ['https:','http:'].includes(u.protocol)?u.href:'';}catch{return '';}}
export function notice(message){const el=document.querySelector('#notice');el.textContent=message;clearTimeout(notice.timer);notice.timer=setTimeout(()=>{el.textContent='';},7000);}
export function download(name,text,type='application/json'){const url=URL.createObjectURL(new Blob([text],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}

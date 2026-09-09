import {esc} from './ui.js';
export const DECISION_VERSION=1;
// Stable manual-decision vocabulary. Never reuse an existing enum for a new meaning.
export const DECISIONS=Object.freeze({
 held:Object.freeze({unset:['未選択','neutral'],hold:['保有継続','green'],add_review:['買い増し検討','blue'],wait_pullback:['押し目待ち','yellow'],reduce_review:['一部売却検討','orange'],exit_review:['売却検討','orange'],review:['判断を見直す','yellow']}),
 watch:Object.freeze({unset:['未選択','neutral'],watching:['監視中','blue'],wait_pullback:['押し目待ち','yellow'],wait_breakout:['上抜け待ち','yellow'],wait_results:['決算待ち','yellow'],entry_review:['購入検討','green'],avoid:['見送り','neutral']})
});
export const validDecision=(scope,value)=>typeof scope==='string'&&typeof value==='string'&&Object.hasOwn(DECISIONS,scope)&&Object.hasOwn(DECISIONS[scope],value);
export function decisionPill(value,scope='held'){
 const [label,tint]=validDecision(scope,value)?DECISIONS[scope][value]:DECISIONS.held.unset;
 return `<span class="decision-pill tint-${tint}">${esc(label)}</span>`;
}
export function decisionSelect(scope,value='unset'){
 return `<label>${scope==='held'?'保有判断':'監視判断'}（自分の判断）<select name="decision">${Object.entries(DECISIONS[scope]).map(([key,[label]])=>`<option value="${key}" ${key===value?'selected':''}>${label}</option>`).join('')}</select></label>`;
}
export function legacyDecision(scope,text){
 const exact=Object.entries(DECISIONS[scope]).find(([,v])=>v[0]===text);
 return exact?.[0]||'unset';
}
export function recordDecision(s,scope,ticker,value,recordedAt=new Date().toISOString(),id=crypto.randomUUID()){
 if(!validDecision(scope,value))throw Error('判断は選択肢から選んでください。');
 const h=s.holdings.find(h=>h.ticker===ticker);
 if(scope==='held'?!h:!s.watch.includes(ticker))throw Error('登録済みの銘柄を選んでください。');
 const old=scope==='held'?h.decision:s.watchDecisions[ticker]||'unset';
 if(scope==='held')h.decision=value;else s.watchDecisions[ticker]=value;
 if(old!==value)s.decisionHistory.push({id,recorded_at:recordedAt,ticker,scope,value,source:'manual',enum_version:DECISION_VERSION});
}

import {esc} from './ui.js';
// Presentation bands only: never change scores, eligibility or investment decisions.
export function scoreTint(kind,value,state){
 if(kind==='velocity')return ({Leading:'tint-green',Improving:'tint-yellow',Weakening:'tint-orange',Lagging:'tint-neutral'})[state]||'tint-neutral';
 if(!Number.isFinite(value))return 'tint-neutral';
 if(kind==='strength')return value>=80?'tint-green':value>=65?'tint-yellow':'tint-neutral';
 if(kind==='heat')return state===true||value>=70?'tint-orange':value>=50?'tint-yellow':'tint-green';
 return 'tint-neutral';
}
export function decisionPill(text){
 const tint=({'保有継続':'green','押し目待ち':'yellow','追加検討':'yellow','監視中':'blue','次の決算へ':'blue','売却検討':'orange','注意':'orange'})[text]||'neutral';
 return `<span class="decision-pill tint-${tint}">${esc(text)}</span>`;
}

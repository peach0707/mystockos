import {esc} from './ui.js';
// Presentation bands only: never change scores, eligibility or investment decisions.
export function scoreTint(kind,value,state){
 if(kind==='velocity')return ({Leading:'tint-green',Improving:'tint-yellow',Weakening:'tint-orange',Lagging:'tint-neutral'})[state]||'tint-neutral';
 if(!Number.isFinite(value))return 'tint-neutral';
 if(kind==='strength')return value>=80?'tint-green':value>=65?'tint-yellow':'tint-neutral';
 if(kind==='heat')return state===true||value>=70?'tint-orange':value>=50?'tint-yellow':'tint-green';
 return 'tint-neutral';
}
export {decisionPill} from './decisions.js';

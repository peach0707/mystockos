import {dateValid} from './ui.js';
import {timestampValid,snapshotRecord} from './ledger.js';
export const LEGACY_KEY='mystockos.private.v2';
export const KEY='mystockos.private.v3';
export const fresh = () => ({version:3,cashFlows:[],cashFlowQuality:{status:'complete',note:''},yearBaselines:{},holdings:[],watch:['MU','TSM','AVGO','COHR','LITE'],snapshots:[],dividends:[],news:[],watchNotes:{},policy:''});
let state=fresh();export let storageError='';
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const str=(s,n=3000)=>typeof s==='string'&&s.length<=n;
const ticker=s=>typeof s==='string'&&/^[A-Z0-9.^=-]{1,20}$/.test(s);
export function validate(s){
 if(!s||s.version!==3||!['holdings','watch','snapshots','cashFlows','dividends','news'].every(k=>Array.isArray(s[k])&&s[k].length<=10000)||!str(s.policy))throw Error('対応する形式は version: 3 のバックアップです。');
 if(!s.watchNotes||typeof s.watchNotes!=='object'||Array.isArray(s.watchNotes)||Object.entries(s.watchNotes).some(([k,v])=>!ticker(k)||!str(v)))throw Error('買い条件の形式が不正です。');
 if(s.watch.some(x=>!ticker(x))||new Set(s.watch).size!==s.watch.length)throw Error('監視銘柄が不正です。');
 if(s.holdings.some(h=>!ticker(h.ticker)||!finite(h.quantity)||h.quantity<=0||!finite(h.cost)||h.cost<0||!['USD','JPY'].includes(h.currency)||!['rationale','decision','buyCondition'].every(k=>str(h[k])) )||new Set(s.holdings.map(h=>h.ticker)).size!==s.holdings.length)throw Error('保有銘柄を確認してください。');
 if(!s.cashFlowQuality||!['complete','incomplete'].includes(s.cashFlowQuality.status)||!str(s.cashFlowQuality.note))throw Error('入出金履歴の完全性を確認してください。');
 if(!s.yearBaselines||typeof s.yearBaselines!=='object'||Array.isArray(s.yearBaselines))throw Error('年初基準が不正です。');
 for(const [year,date] of Object.entries(s.yearBaselines))if(!/^\d{4}$/.test(year)||!dateValid(date)||date<`${Number(year)-1}-12-01`||date>`${year}-01-01`||!s.snapshots.some(x=>x.date===date&&['recorded','closed'].includes(x.status)))throw Error('年初基準には前年12月〜元日の有効な評価を指定してください。');
 for(const f of s.cashFlows)if(!str(f.id,100)||!f.id||!dateValid(f.date)||!timestampValid(f.timestamp,f.date)||!finite(f.amount_jpy)||!['deposit','withdrawal'].includes(f.type)||(f.type==='deposit'?f.amount_jpy<=0:f.amount_jpy>=0)||!str(f.note))throw Error('入出金のID・日付・符号・種別を確認してください。');
 if(new Set(s.cashFlows.map(f=>f.id)).size!==s.cashFlows.length)throw Error('入出金IDが重複しています。');
 for(const x of s.snapshots){
  if(!dateValid(x.date)||!timestampValid(x.timestamp,x.date)||!finite(x.assets_jpy)||x.assets_jpy<0||!str(x.valuation_basis)||!x.valuation_basis.trim()||!['recorded','closed','invalid','pending'].includes(x.status)||!x.components||!['price','fx','realized','other'].every(k=>x.components[k]===null||finite(x.components[k]))||!['stockContributions','themeContributions','allocation'].every(k=>Array.isArray(x[k])))throw Error('日次評価の形式・日付・金額・評価基準を確認してください。');
  for(const k of ['stockContributions','themeContributions','allocation'])if(x[k].some(v=>!str(v.name,120)||!finite(v.value)||(k==='allocation'&&v.value<0)))throw Error('寄与・配分の明細を確認してください。');
  if(x.allocation.length&&Math.abs(x.allocation.reduce((a,b)=>a+b.value,0)-x.assets_jpy)>1)throw Error('配分の合計は総資産と一致させてください（現金を含む）。');
 }
 if(new Set(s.snapshots.map(x=>x.date)).size!==s.snapshots.length)throw Error('日次評価の日付が重複しています。');
 for(const d of s.dividends)if(!str(d.id,100)||!dateValid(d.payment_date)||!timestampValid(d.timestamp,d.payment_date)||!ticker(d.ticker)||!finite(d.net_amount)||d.net_amount<0||!finite(d.fx)||d.fx<=0||!['JPY','USD'].includes(d.currency)||(d.currency==='JPY'&&d.fx!==1)||!['paid','pending','cancelled'].includes(d.status)||!d.tax_information||!(d.tax_information.withheld===null||finite(d.tax_information.withheld)&&d.tax_information.withheld>=0)||!str(d.tax_information.note))throw Error('配当の入金日・税引後金額・換算レートを確認してください。');
 if(new Set(s.dividends.map(d=>d.id)).size!==s.dividends.length)throw Error('配当IDが重複しています。');
 for(const n of s.news)if(!str(n.id,100)||!str(n.title,300)||!dateValid(n.date)||!str(n.source,200)||!str(n.url,2000)||!str(n.why)||!Array.isArray(n.summary)||n.summary.length!==3||n.summary.some(x=>!str(x,1000))||!['high','normal','low'].includes(n.importance)||!['positive','negative','neutral'].includes(n.sentiment)||typeof n.verified!=='boolean'||!['themes','tickers'].every(k=>Array.isArray(n[k])&&n[k].every(v=>str(v,120))))throw Error('ニュースの形式を確認してください。');
 return s;
}
export function migrate(input) {
 if(input?.version===3)return validate(structuredClone(input));
 if(input?.version!==2)throw Error('対応する形式はversion 2 / 3です。');
 const next=structuredClone(input);
 next.version=3;next.cashFlows=[];next.yearBaselines={};
 next.cashFlowQuality={status:'incomplete',note:'旧版から移行しました。休日を含む入出金台帳を確認し、完全性を更新してください。'};
 if(!Array.isArray(input.snapshots)||!Array.isArray(input.dividends))throw Error('旧データの形式が不正です。');
 next.snapshots=input.snapshots.map(x=>{
   if(!finite(x.netFlow))throw Error('旧入出金が不正です。');
   if(x.netFlow!==0)next.cashFlows.push({id:`legacy-snapshot-${x.date}`,date:x.date,timestamp:null,amount_jpy:x.netFlow,type:x.netFlow>0?'deposit':'withdrawal',note:'旧スナップショットから移行'});
   return snapshotRecord({...x,assets_jpy:x.assets,valuation_basis:x.basis});
 });
 next.dividends=input.dividends.map(d=>({id:d.id,ticker:d.ticker,payment_date:d.date,timestamp:null,net_amount:d.net,currency:d.currency,fx:d.fx,status:d.status,tax_information:{withheld:null,note:'旧版では税額未記録。受取額は税引後。'}}));
 return validate(next);
}
export function read(){
 storageError='';
 try{
  const raw=localStorage.getItem(KEY);
  if(raw!==null)state=validate(JSON.parse(raw));
  else {
   const old=localStorage.getItem(LEGACY_KEY);
   const next=old===null?fresh():migrate(JSON.parse(old));
   // Keep the v2 key intact. Validate and persist v3 before activating it.
   if(old!==null)localStorage.setItem(KEY,JSON.stringify(next));
   state=next;
  }
 }catch{state=fresh();storageError='端末データを読めない、または移行を保存できませんでした。元データを保護して編集を停止しています。設定から書き出してください。';}
 return state;
}
export const get=()=>state;
export function commit(next){if(storageError)throw Error(storageError);validate(next);try{localStorage.setItem(KEY,JSON.stringify(next));}catch{throw Error('端末に保存できません。入力は保存されていません。');}state=next;return state;}
export function mutate(fn){const next=structuredClone(state);fn(next);return commit(next);}
export const rawBackup=()=>localStorage.getItem(KEY)||localStorage.getItem(LEGACY_KEY)||JSON.stringify(state,null,2);

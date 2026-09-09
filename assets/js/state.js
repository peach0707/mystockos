import {dateValid} from './ui.js';
export const KEY='mystockos.private.v2';
export const fresh = () => ({version:2,holdings:[],watch:['MU','TSM','AVGO','COHR','LITE'],snapshots:[],dividends:[],news:[],watchNotes:{},policy:''});
let state=fresh();export let storageError='';
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const str=(s,n=3000)=>typeof s==='string'&&s.length<=n;
const ticker=s=>typeof s==='string'&&/^[A-Z0-9.^=-]{1,20}$/.test(s);
export function validate(s){
 if(!s||s.version!==2||!['holdings','watch','snapshots','dividends','news'].every(k=>Array.isArray(s[k])&&s[k].length<=10000)||!str(s.policy))throw Error('対応する形式は version: 2 のバックアップです。');
 if(!s.watchNotes||typeof s.watchNotes!=='object'||Array.isArray(s.watchNotes)||Object.entries(s.watchNotes).some(([k,v])=>!ticker(k)||!str(v)))throw Error('買い条件の形式が不正です。');
 if(s.watch.some(x=>!ticker(x))||new Set(s.watch).size!==s.watch.length)throw Error('監視銘柄が不正です。');
 if(s.holdings.some(h=>!ticker(h.ticker)||!finite(h.quantity)||h.quantity<=0||!finite(h.cost)||h.cost<0||!['USD','JPY'].includes(h.currency)||!['rationale','decision','buyCondition'].every(k=>str(h[k])) )||new Set(s.holdings.map(h=>h.ticker)).size!==s.holdings.length)throw Error('保有銘柄を確認してください。');
 for(const x of s.snapshots){
  if(!dateValid(x.date)||!finite(x.assets)||x.assets<0||!finite(x.netFlow)||!str(x.basis)||!x.basis.trim()||!['recorded','closed'].includes(x.status)||!x.components||!['price','fx','realized','other'].every(k=>x.components[k]===null||finite(x.components[k]))||!['stockContributions','themeContributions','allocation'].every(k=>Array.isArray(x[k])))throw Error('日次評価の形式・日付・金額・評価基準を確認してください。');
  for(const k of ['stockContributions','themeContributions','allocation'])if(x[k].some(v=>!str(v.name,120)||!finite(v.value)||(k==='allocation'&&v.value<0)))throw Error('寄与・配分の明細を確認してください。');
  if(x.allocation.length&&Math.abs(x.allocation.reduce((a,b)=>a+b.value,0)-x.assets)>1)throw Error('配分の合計は総資産と一致させてください（現金を含む）。');
 }
 if(new Set(s.snapshots.map(x=>x.date)).size!==s.snapshots.length)throw Error('日次評価の日付が重複しています。');
 for(const d of s.dividends)if(!str(d.id,100)||!dateValid(d.date)||!ticker(d.ticker)||!finite(d.net)||d.net<0||!finite(d.fx)||d.fx<=0||!['JPY','USD'].includes(d.currency)||(d.currency==='JPY'&&d.fx!==1)||d.status!=='paid')throw Error('配当の入金日・税引後金額・換算レートを確認してください。');
 if(new Set(s.dividends.map(d=>d.id)).size!==s.dividends.length)throw Error('配当IDが重複しています。');
 for(const n of s.news)if(!str(n.id,100)||!str(n.title,300)||!dateValid(n.date)||!str(n.source,200)||!str(n.url,2000)||!str(n.why)||!Array.isArray(n.summary)||n.summary.length!==3||n.summary.some(x=>!str(x,1000))||!['high','normal','low'].includes(n.importance)||!['positive','negative','neutral'].includes(n.sentiment)||typeof n.verified!=='boolean'||!['themes','tickers'].every(k=>Array.isArray(n[k])&&n[k].every(v=>str(v,120))))throw Error('ニュースの形式を確認してください。');
 return s;
}
export function read(){try{const raw=localStorage.getItem(KEY);state=raw?validate(JSON.parse(raw)):fresh();}catch{storageError='端末保存を読めませんでした。保存済み内容を上書きしないよう編集を停止しています。設定から元データを書き出してください。';}return state;}
export const get=()=>state;
export function commit(next){if(storageError)throw Error(storageError);validate(next);try{localStorage.setItem(KEY,JSON.stringify(next));}catch{throw Error('端末に保存できません。容量・Safariの保存設定を確認してください。入力は保存されていません。');}state=next;return state;}
export function mutate(fn){const next=structuredClone(state);fn(next);return commit(next);}
export const rawBackup=()=>localStorage.getItem(KEY)||JSON.stringify(state,null,2);

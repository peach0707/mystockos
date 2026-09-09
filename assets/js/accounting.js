// Independent personal ledgers. Theme System v1.0 is never called or modified.
import {boundary,eventPosition,intervalFlows,snapshotRecord} from './ledger.js';
export const ordered=s=>s.snapshots.filter(x=>['recorded','closed'].includes(x.status)).map(x=>({...x,assets:x.assets_jpy,basis:x.valuation_basis})).sort((a,b)=>boundary(a)-boundary(b));
export const paidOn=(s,date)=>s.dividends.filter(d=>d.status==='paid'&&d.payment_date===date);
export function paidBetween(s,from,to){
 const a=typeof from==='string'?{date:from,timestamp:null}:from,b=typeof to==='string'?{date:to,timestamp:null}:to;
 let total=0;
 for(const d of s.dividends.filter(d=>d.status==='paid')){
  const position=eventPosition(d.payment_date,d.timestamp,a,b);
  if(position==='ambiguous')return null;
  if(position==='inside')total+=d.net_amount*d.fx;
 }
 return total;
}
export function dayResult(s,date){
 const rows=ordered(s),i=rows.findIndex(r=>r.date===date);
 if(i<0){const invalid=s.snapshots.find(x=>x.date===date);return invalid?{current:{...invalid,assets:invalid.assets_jpy,basis:invalid.valuation_basis},pnl:null,rate:null,reason:'データ不足：この評価は無効または確認待ちです'}:null;}
 const current=rows[i],previous=rows[i-1];
 if(!previous)return {current,previous,pnl:null,rate:null,reason:'データ不足：比較する有効な評価がありません'};
 const flows=intervalFlows(s,previous,current);
 if(flows.net===null)return {current,previous,pnl:null,rate:null,reason:flows.reason,netFlow:null};
 const pnl=current.assets-previous.assets-flows.net,dividend=paidBetween(s,previous,current);
 const c=current.components,known=Object.values(c).filter(Number.isFinite).reduce((a,b)=>a+b,0);
 return {current,previous,pnl,rate:flows.count===0&&previous.assets>0?pnl/previous.assets*100:null,netFlow:flows.net,flowCount:flows.count,dividend,
   residual:dividend===null?null:pnl-known-dividend,complete:Object.values(c).every(Number.isFinite)&&dividend!==null,
   reason:flows.count?'入出金がある期間の収益率は未算出（純額0も含む）':''};
}
export function yearResult(s,year){
 const rows=ordered(s),date=s.yearBaselines[String(year)]||`${year-1}-12-31`;
 const start=rows.find(x=>x.date===date),end=rows.filter(x=>x.date.startsWith(`${year}-`)).at(-1);
 if(!start||!end||boundary(end)<=boundary(start))return {start,end,assetChange:null,pnl:null,netFlow:null,complete:false,reason:'データ不足：年初基準評価・最新有効評価を確認してください'};
 const flows=intervalFlows(s,start,end);
 return {start,end,assetChange:end.assets-start.assets,netFlow:flows.net,pnl:flows.net===null?null:end.assets-start.assets-flows.net,complete:flows.net!==null,reason:flows.reason};
}
export function parseCSV(text){
 const rows=[];let row=[],field='',quoted=false;
 for(let i=0;i<text.length;i++){let c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){field+='"';i++;}else quoted=!quoted;}else if(c===','&&!quoted){row.push(field);field='';}else if(c==='\n'&&!quoted){row.push(field.replace(/\r$/,''));rows.push(row);row=[];field='';}else field+=c;}
 if(quoted)throw Error('CSVの引用符が閉じていません。');if(field||row.length){row.push(field.replace(/\r$/,''));rows.push(row);}return rows.filter(r=>r.some(x=>x.trim()));
}
export function snapshotsCSV(text){
 const [header,...rows]=parseCSV(text.replace(/^\uFEFF/,''));
 const expected=['date','timestamp','assets_jpy','valuation_basis','status'];
 if(!header||header.join(',')!==expected.join(','))throw Error('評価CSVはdate,timestamp,assets_jpy,valuation_basis,statusです。入出金は別のCSVで登録してください。');
 return rows.map(r=>{if(r.length!==5||!r[2].trim()||!Number.isFinite(Number(r[2])))throw Error('評価CSVの金額・列数が不正です。');return snapshotRecord({date:r[0],timestamp:r[1]||null,assets_jpy:Number(r[2]),valuation_basis:r[3],status:r[4]});});
}
export function cashFlowsCSV(text){
 const [header,...rows]=parseCSV(text.replace(/^\uFEFF/,''));
 if(!header||header.join(',')!=='id,date,timestamp,amount_jpy,type,note')throw Error('入出金CSVはid,date,timestamp,amount_jpy,type,noteです。');
 return rows.map(r=>{if(r.length!==6||!r[3].trim()||!Number.isFinite(Number(r[3])))throw Error('入出金CSVの金額・列数が不正です。');return {id:r[0],date:r[1],timestamp:r[2]||null,amount_jpy:Number(r[3]),type:r[4],note:r[5]};});
}

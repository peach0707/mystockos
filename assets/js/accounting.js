// Personal JPY valuations. No network, forecasting, or v1 scoring dependencies.
export const ordered=s=>[...s.snapshots].sort((a,b)=>a.date.localeCompare(b.date));
export const paidBetween=(s,from,to)=>s.dividends.filter(d=>d.status==='paid'&&d.date>from&&d.date<=to).reduce((n,d)=>n+d.net*d.fx,0);
const nextDate=date=>new Date(Date.parse(date)+86400000).toISOString().slice(0,10);
export function dayResult(s,date){
 const rows=ordered(s),i=rows.findIndex(r=>r.date===date);if(i<0)return null;
 const current=rows[i],previous=rows[i-1];
 // Without the previous calendar day's closing valuation, never imply daily P&L.
 if(!previous||nextDate(previous.date)!==date)return {current,previous,pnl:null,rate:null,reason:'前日評価が未記録のため、日次損益は未算出'};
 const pnl=current.assets-previous.assets-current.netFlow;
 const dividend=paidBetween(s,previous.date,date);
 const c=current.components,known=Object.values(c).filter(Number.isFinite).reduce((a,b)=>a+b,0)+dividend;
 return {current,previous,pnl,rate:current.netFlow===0&&previous.assets>0?pnl/previous.assets*100:null,dividend,residual:pnl-known,complete:Object.values(c).every(Number.isFinite),reason:current.netFlow!==0?'入出金時刻がないため日次収益率は未算出':''};
}
export function yearResult(s,year){
 const rows=ordered(s),start=rows.find(x=>x.date===`${year-1}-12-31`),end=rows.filter(x=>x.date.startsWith(`${year}-`)).at(-1);
 if(!start||!end)return {start,end,assetChange:null,pnl:null,netFlow:null,complete:false};
 const dates=new Set(rows.map(x=>x.date));let complete=true;
 for(let date=nextDate(start.date);date<=end.date;date=nextDate(date))if(!dates.has(date)){complete=false;break;}
 const netFlow=rows.filter(x=>x.date>start.date&&x.date<=end.date).reduce((a,x)=>a+x.netFlow,0);
 return {start,end,assetChange:end.assets-start.assets,netFlow:complete?netFlow:null,pnl:complete?end.assets-start.assets-netFlow:null,complete};
}
export function parseCSV(text){
 const rows=[];let row=[],field='',quoted=false;
 for(let i=0;i<text.length;i++){let c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){field+='"';i++;}else quoted=!quoted;}else if(c===','&&!quoted){row.push(field);field='';}else if(c==='\n'&&!quoted){row.push(field.replace(/\r$/,''));rows.push(row);row=[];field='';}else field+=c;}
 if(quoted)throw Error('CSVの引用符が閉じていません。');if(field||row.length){row.push(field.replace(/\r$/,''));rows.push(row);}return rows.filter(r=>r.some(x=>x.trim()));
}
export function snapshotsCSV(text){
 const [header,...rows]=parseCSV(text.replace(/^\uFEFF/,''));const expected=['date','assets_jpy','net_flow_jpy','basis','status'];
 if(!header||expected.some((x,i)=>header[i]!==x)||header.length!==expected.length)throw Error('CSVヘッダーは date,assets_jpy,net_flow_jpy,basis,status です。');
 return rows.map(r=>{if(r.length!==5||!r[1].trim()||!r[2].trim())throw Error('CSVの列数・金額が不正です。');return {date:r[0],assets:Number(r[1]),netFlow:Number(r[2]),basis:r[3],status:r[4],components:{price:null,fx:null,realized:null,other:null},stockContributions:[],themeContributions:[],allocation:[]};});
}

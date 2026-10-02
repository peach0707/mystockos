// Private position history stays on this device; only public closes are fetched.
import {dateValid} from './ui.js';

const finite=Number.isFinite;
const positive=n=>finite(n)&&n>0;
export const japanDate=(now=Date.now())=>new Date(now).toLocaleDateString('sv-SE',{timeZone:'Asia/Tokyo'});
export const shiftDate=(date,n)=>new Date(Date.parse(date+'T12:00:00Z')+n*86400000).toISOString().slice(0,10);
export const portfolioBasis=s=>JSON.stringify(s.holdings.map(h=>[h.ticker,h.quantity,h.cost,h.currency,s.securities?.[h.ticker]?.id||'']).sort((a,b)=>a[0].localeCompare(b[0])||JSON.stringify(a).localeCompare(JSON.stringify(b))));
export function parseBasis(basis){
 try{
  const rows=JSON.parse(basis);
  if(!Array.isArray(rows)||rows.length>10000||rows.some(r=>!Array.isArray(r)||r.length!==5||typeof r[0]!=='string'||!/^[A-Z0-9.^=-]{1,20}$/.test(r[0])||!positive(r[1])||!finite(r[2])||r[2]<0||!finite(r[1]*r[2])||!['USD','JPY'].includes(r[3])||typeof r[4]!=='string'||r[4].length>200))return null;
  return rows;
 }catch{return null;}
}

export function initializePeriods(s,now=Date.now()){
 if(s.holdingPeriods)return;
 const current=portfolioBasis(s),today=japanDate(now),periods=[];
 // Only known positions are carried forward. If two legacy observations have
 // different holdings, the intervening dates remain unknown, not guessed.
 for(const row of [...(s.holdingObservations||[])].sort((a,b)=>a.date.localeCompare(b.date))){
  if(row.date>today||!parseBasis(row.basis)?.length)continue;
  const last=periods.at(-1);
  if(last?.basis===row.basis)last.end=row.date;
  else periods.push({start:row.date,end:row.date,basis:row.basis,source:'legacy'});
 }
 if(periods.at(-1)?.basis===current)periods.at(-1).end=null;
 else if(s.holdings.length){
  if(periods.at(-1)?.end===today)periods.pop();
  periods.push({start:today,end:null,basis:current,source:'recorded'});
 }
 s.holdingPeriods=periods;
}

export function captureHoldingChange(before,next,now=Date.now()){
 if(portfolioBasis(before)===portfolioBasis(next))return;
 initializePeriods(next,now);
 // Initialization above must use the old positions if this is the first edit.
 if(!before.holdingPeriods){const old=structuredClone(before);initializePeriods(old,now);next.holdingPeriods=old.holdingPeriods;}
 const date=japanDate(now),basis=portfolioBasis(next);
 next.holdingPeriods=next.holdingPeriods.filter(p=>p.start<date).map(p=>({...p,end:p.end&&p.end<date?p.end:shiftDate(date,-1)}));
 // Empty portfolios are explicit boundaries, so a later re-entry cannot bridge
 // an interval during which the user held nothing.
 next.holdingPeriods.push({start:date,end:null,basis,source:'recorded'});
}

export function validArchive(a){
 if(!a||a.schema_version!==1||a.price_basis!=='as_reported_daily_close'||!dateValid(a.as_of)||!a.stocks||typeof a.stocks!=='object'||Array.isArray(a.stocks)||a.fx?.pair!=='USD/JPY'||a.fx?.basis!=='completed_UTC_daily_close')return false;
 const series=(rows,key)=>Array.isArray(rows)&&rows.length<=3660&&rows.every((r,i)=>r&&dateValid(r.date)&&positive(r[key])&&(!i||rows[i-1].date<r.date));
 return Object.entries(a.stocks).every(([ticker,s])=>/^[A-Z0-9.^=-]{1,20}$/.test(ticker)&&s&&['USD','JPY'].includes(s.currency)&&series(s.history,'close'))&&series(a.fx.history,'rate');
}

export function sessionDays(data,now=Date.now()){
 return (data.calendar?.value?.sessions||[]).filter(s=>dateValid(s.date)&&finite(Date.parse(s.close))).map(s=>({priceDate:s.date,date:japanDate(Date.parse(s.close)),closed:Date.parse(s.close)<=now}));
}

export function reconcileHistory(s,data,now=Date.now()){
 const before=JSON.stringify([s.holdingPeriods,s.holdingDailyHistory]);
 initializePeriods(s,now);
 if(!sessionDays(data,now).length)return before!==JSON.stringify([s.holdingPeriods,s.holdingDailyHistory]);
 const stocks={},fx=new Map(),archive=data.archive?.value;
 if(validArchive(archive)){
  for(const [ticker,q] of Object.entries(archive.stocks))stocks[ticker]={currency:q.currency,prices:new Map(q.history.map(r=>[r.date,r.close]))};
  for(const row of archive.fx.history)fx.set(row.date,row.rate);
 }
 // Today's successful public quote also works while the archive is being
 // published. Its adjusted historical array is intentionally never consumed.
 for(const [ticker,q] of Object.entries(data.setups?.value?.stocks||{})){
  if(q.quality!=='ok'||!positive(q.price)||!dateValid(q.as_of)||!['USD','JPY'].includes(q.currency))continue;
  if(stocks[ticker]&&stocks[ticker].currency!==q.currency)continue;
  stocks[ticker]??={currency:q.currency,prices:new Map()};stocks[ticker].prices.set(q.as_of,q.price);
 }
 const f=data.fx?.value;
 if(f?.quality==='ok'&&f.pair==='USD/JPY'&&f.basis==='completed_UTC_daily_close'&&dateValid(f.as_of)&&positive(f.rate))fx.set(f.as_of,f.rate);
 const days=sessionDays(data,now),covered=new Set(days.map(d=>d.date));
 const old=new Map((s.holdingDailyHistory||[]).map(r=>[r.date,r]));
 // Calendar files can roll forward or be temporarily shorter. A verified
 // older row must survive as long as its known ownership basis still matches.
 const rows=[...old.values()].filter(r=>!covered.has(r.date)&&s.holdingPeriods.some(p=>p.start<=r.date&&(!p.end||p.end>=r.date)&&p.basis===r.basis));
 for(const day of days.filter(d=>d.closed&&d.date<=japanDate(now))){
  const period=s.holdingPeriods.find(p=>p.start<=day.date&&(!p.end||p.end>=day.date));
  if(!period)continue;
  const positions=parseBasis(period.basis);if(!positions?.length)continue;
  const quantities=new Map();for(const [ticker,quantity] of positions)quantities.set(ticker,(quantities.get(ticker)||0)+quantity);
  const needsFx=[...quantities.keys()].some(t=>stocks[t]?.currency!=='JPY'),rate=needsFx?fx.get(day.priceDate):null;
  const parts=[...quantities].map(([ticker,quantity])=>{const quote=stocks[ticker],close=quote?.prices.get(day.priceDate),valueJpy=close*quantity*(quote?.currency==='JPY'?1:rate);return {ticker,quantity,close,valueJpy};});
  const previous=old.get(day.date);
  if((needsFx&&!positive(rate))||parts.some(p=>!positive(p.close)||!finite(p.valueJpy)||p.valueJpy<0)){
   // An offline retry or source outage never deletes a previously verified row.
   if(previous?.basis===period.basis)rows.push(previous);
   continue;
  }
  const assetsJpy=parts.reduce((sum,p)=>sum+p.valueJpy,0);if(!finite(assetsJpy))continue;
  const row={date:day.date,priceDate:day.priceDate,fxDate:needsFx?day.priceDate:null,fxRate:rate??null,assetsJpy,basis:period.basis,basisChanged:period.start===day.date,source:'daily_close',parts};
  rows.push({...row,computedAt:previous&&JSON.stringify({...previous,computedAt:undefined})===JSON.stringify(row)?previous.computedAt:new Date(now).toISOString()});
 }
 if(rows.length||s.holdingDailyHistory)s.holdingDailyHistory=rows.sort((a,b)=>a.date.localeCompare(b.date)).slice(-3660);
 return before!==JSON.stringify([s.holdingPeriods,s.holdingDailyHistory]);
}

export const historyRows=s=>s.holdingDailyHistory||[];
export function dailyResult(s,date,data={}){
 const rows=historyRows(s),current=rows.find(r=>r.date===date)||null;
 const days=sessionDays(data),index=current?days.findIndex(d=>d.priceDate===current.priceDate):-1;
 const expected=index>0?days[index-1].date:null;
 const previous=(expected?rows.find(r=>r.date===expected):null)||null;
 const same=!!current&&!!previous&&current.basis===previous.basis&&!current.basisChanged;
 const change=same?current.assetsJpy-previous.assetsJpy:null;
 return {current,previous,change,rate:change!==null&&previous.assetsJpy>0?change/previous.assetsJpy*100:null,
  reason:!current?'この日の確定価格・為替、または保有履歴が揃っていません。':!previous?'比較する前営業日の記録がないため、差額は表示しません。':!same?'保有内容が変わったため、この日は比較の基準日です。':'同じ保有内容を、直前の米国営業日の終値・為替と比較しています。'};
}

export function historyDayState(s,date,data={},now=Date.now()){
 const result=dailyResult(s,date,data),day=sessionDays(data,now).find(d=>d.date===date);
 if(result.current)return {...result,kind:result.change!==null?'priced':'baseline',label:result.change!==null?'評価差':'基準'};
 if(date>japanDate(now)||day&&!day.closed)return {...result,kind:'future',label:''};
 if(!s.holdingPeriods?.some(p=>p.start<=date&&(!p.end||p.end>=date)&&parseBasis(p.basis)?.length))return {...result,kind:'unregistered',label:'登録前・履歴なし'};
 const calendar=data.calendar?.value,priceDate=shiftDate(date,-1);
 if(!day&&(!calendar?.start||!calendar?.end||priceDate<calendar.start||priceDate>calendar.end))return {...result,kind:'missing',label:'取引日情報の取得待ち'};
 if(!day)return {...result,kind:'closed',label:'休場'};
 return {...result,kind:'missing',label:'取得待ち'};
}

export function validateHistory(s){
 if(s.holdingPeriods!==undefined){
  const periods=s.holdingPeriods;
  if(!Array.isArray(periods)||periods.length>10000||periods.some((p,i)=>!p||!dateValid(p.start)||!(p.end===null||dateValid(p.end)&&p.end>=p.start)||!['legacy','recorded'].includes(p.source)||typeof p.basis!=='string'||p.basis.length>1000000||!parseBasis(p.basis)||i>0&&(!periods[i-1].end||periods[i-1].end>=p.start)))throw Error('保有変更履歴の形式が不正です。元のデータは変更していません。');
 }
 if(s.holdingDailyHistory!==undefined){
  const rows=s.holdingDailyHistory;
  if(!Array.isArray(rows)||rows.length>3660||rows.some((r,i)=>!r||!dateValid(r.date)||!dateValid(r.priceDate)||r.priceDate>=r.date||!finite(r.assetsJpy)||r.assetsJpy<0||typeof r.basis!=='string'||!parseBasis(r.basis)||r.source!=='daily_close'||typeof r.basisChanged!=='boolean'||!finite(Date.parse(r.computedAt))||!(r.fxDate===null&&r.fxRate===null||r.fxDate===r.priceDate&&positive(r.fxRate))||!Array.isArray(r.parts)||r.parts.some(p=>typeof p.ticker!=='string'||!positive(p.quantity)||!positive(p.close)||!finite(p.valueJpy)||p.valueJpy<0)||Math.abs(r.parts.reduce((n,p)=>n+p.valueJpy,0)-r.assetsJpy)>.01||i>0&&rows[i-1].date>=r.date))throw Error('日別評価履歴の形式が不正です。元のデータは変更していません。');
 }
}

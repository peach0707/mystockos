// Current registered holdings, not a brokerage ledger or a return backtest.
import {quoteFor} from './setups.js';
import {dateState} from './freshness.js';
import {dateValid} from './ui.js';

const finite=x=>typeof x==='number'&&Number.isFinite(x);
const positive=x=>finite(x)&&x>0;
const japanDay=now=>new Date(now).toLocaleDateString('sv-SE',{timeZone:'Asia/Tokyo'});
export const holdingBasis=s=>JSON.stringify(s.holdings.map(h=>[h.ticker,h.quantity,h.cost,h.currency,s.securities?.[h.ticker]?.id||'']).sort((a,b)=>a[0].localeCompare(b[0])));

export function fxQuote(data,now=Date.now()){
 const f=data.fx?.value;
 if(f?.pair!=='USD/JPY'||!positive(f.rate)||!dateValid(f.as_of)||f.as_of>=new Date(now).toISOString().slice(0,10))return null;
 const age=(now-Date.parse(f.as_of+'T00:00:00Z'))/86400000;
 return {...f,stale:f.quality!=='ok'||!!data.fx?.cached||age>4};
}

export function valueHoldings(s,data,now=Date.now()){
 const fx=fxQuote(data,now);
 const rows=s.holdings.map(h=>{
  const q=quoteFor(data,h.ticker,now),security=s.securities?.[h.ticker];
  // A symbol's USD market quote is never multiplied by a JPY acquisition cost.
  // Existing records keep their cost currency; value and cost conversions differ.
  const quoteCurrency=q?.currency||security?.currency||'USD';
  const good=q?.closed&&positive(q.price)&&['USD','JPY'].includes(quoteCurrency);
  const price=good?q.price:null;
  const value=good?price*h.quantity:null;
  const rate=quoteCurrency==='JPY'?1:fx?.rate;
  const valueJpy=good&&positive(rate)?value*rate:null;
  const cost=h.quantity*h.cost, costRate=h.currency==='JPY'?1:fx?.rate;
  const costJpy=positive(costRate)?cost*costRate:null;
  const pnl=good&&h.currency===quoteCurrency?value-cost:null;
  const pnlJpy=valueJpy!==null&&costJpy!==null?valueJpy-costJpy:null;
  const stale=good&&(dateState(q.date,data.calendar?.value,now).state!=='current'||q.quality==='stale'||!!data.setups?.cached);
  const reason=!q||!positive(q.price)?'価格未取得':!q.closed?'確定した終値を確認中':!['USD','JPY'].includes(quoteCurrency)?'未対応の価格通貨':valueJpy===null?'為替を確認中':stale?'前回の終値で概算':'';
  return {...h,price,quoteCurrency,asOf:q?.date||null,value,valueJpy,costJpy,pnl,pnlJpy,
   pnlRate:pnl!==null&&cost>0?pnl/cost*100:null,stale,reason};
 });
 const priced=rows.filter(r=>r.value!==null),converted=rows.filter(r=>r.valueJpy!==null);
 const complete=converted.length===rows.length;
 const subtotalJpy=converted.reduce((a,r)=>a+r.valueJpy,0);
 const native=Object.fromEntries(['USD','JPY'].map(c=>[c,priced.filter(r=>r.quoteCurrency===c).reduce((a,r)=>a+r.value,0)]));
 const cash=s.cashBalance;
 const cashKnown=!!cash&&finite(cash.JPY)&&finite(cash.USD);
 const cashJpy=cashKnown&&(cash.USD===0||fx)?cash.JPY+cash.USD*(fx?.rate||0):null;
 const stockJpy=complete?subtotalJpy:null;
 const assetsJpy=stockJpy!==null&&cashJpy!==null?stockJpy+cashJpy:null;
 const pnlJpy=rows.length>0&&complete&&rows.every(r=>r.pnlJpy!==null)?rows.reduce((a,r)=>a+r.pnlJpy,0):null;
 const dates=[...new Set(priced.map(r=>r.asOf))].sort();
 const needsFx=rows.some(r=>r.quoteCurrency==='USD');
 const fresh=rows.length>0&&complete&&dates.length===1&&rows.every(r=>!r.stale)&&(!needsFx||fx&&!fx.stale);
 return {rows,fx,native,pricedCount:priced.length,convertedCount:converted.length,complete,subtotalJpy,stockJpy,
  cashKnown,cashJpy,assetsJpy,pnlJpy,dates,fresh,basis:holdingBasis(s),
  allocation:converted.map(r=>({name:r.ticker,value:r.valueJpy}))};
}

export function nextObservation(s,data,now=Date.now()){
 const v=valueHoldings(s,data,now);
 if(!v.fresh)return null;
 const history=s.holdingObservations||[],last=history.at(-1),date=japanDay(now);
 // No invented past holdings. Persist only a valuation actually seen by this device.
 const sourceKey=JSON.stringify([v.basis,v.rows.map(r=>[r.ticker,r.asOf,r.price]).sort(),v.fx?.as_of||null,v.fx?.rate||null]);
 if(last?.sourceKey===sourceKey||last?.date>date)return null;
 const changed=last?.date===date&&(last.basisChanged||last.basis!==v.basis);
 return {date,observedAt:new Date(now).toISOString(),priceDate:v.dates[0],
  fxDate:v.fx?.as_of||null,fxRate:v.fx?.rate||null,assetsJpy:v.stockJpy,
  basis:v.basis,basisChanged:!!changed,sourceKey};
}

export function saveObservation(s,row){
 s.holdingObservations=[...(s.holdingObservations||[]).filter(x=>x.date!==row.date),row].sort((a,b)=>a.date.localeCompare(b.date)).slice(-3660);
}

export function observationResult(s,date){
 const rows=(s.holdingObservations||[]).filter(r=>r.date<=date).sort((a,b)=>a.date.localeCompare(b.date));
 const current=rows.at(-1)?.date===date?rows.at(-1):null,previous=current?rows.at(-2):null;
 const comparable=!!current&&!!previous&&current.basis===previous.basis&&!current.basisChanged;
 return {current,previous,change:comparable?current.assetsJpy-previous.assetsJpy:null,
  rate:comparable&&previous.assetsJpy>0?(current.assetsJpy/previous.assetsJpy-1)*100:null,
  reason:!current?'この日は自動評価の記録がありません。':!previous?'この日から自動記録を開始しました。次の評価から変化を表示します。':!comparable?'保有内容を変更したため、差額を損益として表示しません。':'直前に記録した同じ保有内容の評価額と比較しています。'};
}

export function validateValuationState(s){
 const c=s.cashBalance;
 if(c!==undefined&&(!c||!finite(c.JPY)||c.JPY<0||!finite(c.USD)||c.USD<0||!dateValid(c.updatedAt)))throw Error('現金残高の形式が不正です。');
 if(s.holdingObservations!==undefined){
  const rows=s.holdingObservations;
  if(!Array.isArray(rows)||rows.length>3660||rows.some(r=>!r||!dateValid(r.date)||!dateValid(r.priceDate)||r.priceDate>r.date||!Number.isFinite(Date.parse(r.observedAt))||japanDay(Date.parse(r.observedAt))!==r.date||!finite(r.assetsJpy)||r.assetsJpy<0||typeof r.basis!=='string'||r.basis.length>1000000||typeof r.sourceKey!=='string'||r.sourceKey.length>1000000||typeof r.basisChanged!=='boolean'||!(r.fxDate===null&&r.fxRate===null||dateValid(r.fxDate)&&r.fxDate<=r.date&&positive(r.fxRate)))||new Set(rows.map(r=>r.date)).size!==rows.length)throw Error('保有評価の自動記録が不正です。');
 }
}

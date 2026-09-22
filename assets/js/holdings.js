// Individual registrations remain editable; totals are derived, never stored twice.
export const holdingKey=h=>h.id?`position:${h.id}`:`legacy:${h.ticker}`;
export function findHolding(s,key){
 const exact=s.holdings.find(h=>holdingKey(h)===key);
 if(exact)return exact;
 // Older edit callers passed a ticker; only resolve an unambiguous single row.
 const legacy=s.holdings.filter(h=>h.ticker===key);
 return legacy.length===1?legacy[0]:undefined;
}
export const holdingTickers=s=>[...new Set(s.holdings.map(h=>h.ticker))];
export const brokerName=h=>h.broker?.trim()||'証券会社未指定';

export function aggregateHoldings(holdings){
 const groups=new Map();
 for(const h of holdings){
  if(!groups.has(h.ticker))groups.set(h.ticker,[]);
  groups.get(h.ticker).push(h);
 }
 return [...groups].map(([ticker,positions])=>{
  const quantity=positions.reduce((sum,h)=>sum+h.quantity,0);
  const costBreakdown=[...new Set(positions.map(h=>h.currency))].map(currency=>{
   const rows=positions.filter(h=>h.currency===currency);
   const quantity=rows.reduce((sum,h)=>sum+h.quantity,0);
   const totalCost=rows.reduce((sum,h)=>sum+h.quantity*h.cost,0);
   return {currency,quantity,totalCost,averageCost:totalCost/quantity};
  });
  const single=costBreakdown.length===1?costBreakdown[0]:null;
  return {...positions[0],ticker,quantity,positions,costBreakdown,
   cost:single?.averageCost??null,currency:single?.currency??null};
 });
}

export function saveHolding(s,input,key='',createId=()=>crypto.randomUUID()){
 const previous=key?findHolding(s,key):null;
 if(key&&!previous)throw Error('編集する保有が見つかりません。保有一覧から開き直してください。');
 if(previous&&previous.ticker!==input.ticker)throw Error('編集では銘柄を変更できません。新しい保有として登録してください。');
 if(!Number.isFinite(input.quantity)||input.quantity<=0||!Number.isFinite(input.cost)||input.cost<0||!Number.isFinite(input.quantity*input.cost))throw Error('株数は0より大きく、取得単価は0以上の数値で入力してください。');
 if(!['USD','JPY'].includes(input.currency))throw Error('取得単価の通貨を選んでください。');
 const broker=String(input.broker||'').trim();
 if(broker.length>60)throw Error('証券会社名は60文字以内で入力してください。');
 const h={...previous,id:previous?.id||createId(),ticker:input.ticker,broker,
  quantity:input.quantity,cost:input.cost,currency:input.currency,
  decision:previous?.decision||s.holdings.find(r=>r.ticker===input.ticker)?.decision||'unset'};
 if(previous)s.holdings[s.holdings.indexOf(previous)]=h;else s.holdings.push(h);
 return h;
}

export function removeHolding(s,key){
 const h=findHolding(s,key);
 if(!h)throw Error('削除する保有が見つかりません。保有一覧から開き直してください。');
 s.holdings=s.holdings.filter(row=>row!==h);
}

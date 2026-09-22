import {dateState} from './freshness.js';

export function quoteFor(data,ticker,now=Date.now()){
  const basic=data.stocks?.value?.stocks?.find(x=>x.ticker===ticker), setup=data.setups?.value?.stocks?.[ticker];
  const basicState=dateState(basic?.date,data.calendar?.value,now),setupState=dateState(setup?.as_of,data.calendar?.value,now);
  const completed=state=>['current','stale'].includes(state.state);
  // The legacy quote job can include today's unfinished daily candle. Use the
  // last completed session for a closing-price check instead of calling it a close.
  if(setup&&Number.isFinite(setup.price)&&setup.price>0&&(!basic||setup.as_of>=basic.date||completed(setupState)&&!completed(basicState)))return {...setup,date:setup.as_of,closed:completed(setupState)};
  return basic?{...basic,closed:completed(basicState)}:null;
}
export function setupFor(data,ticker,now=Date.now()){
  const setup=data.setups?.value?.stocks?.[ticker];
  const quote=quoteFor(data,ticker,now);
  const fresh=dateState(setup?.as_of,data.calendar?.value,now);
  const valid=setup?.quality==='ok'&&['price','ma20','ma50','prior_high20','prior_low20','rsi14_simple','distance_ma20_pct'].every(k=>typeof setup[k]==='number'&&Number.isFinite(setup[k]));
  if(!valid||fresh.state!=='current'||data.setups?.cached||quote?.date!==setup.as_of){
    return {code:'waiting',label:'データ確認待ち',tint:'muted',ready:false,setup,quote,
      reason:!setup||setup.quality==='missing'?'この銘柄の分析用データは未取得です。':`分析基準日 ${setup.as_of||'不明'}。更新を確認するまで条件判定を保留します。`,
      buy:'最新の日足が揃ってから購入条件を確認。',sell:'最新の日足と投資根拠を確認してから判断。'};
  }
  const p=setup;
  const result={ready:true,setup:p,quote,code:'range',label:'方向を確認',tint:'muted',reason:'上昇・下落の条件が揃っていません。',buy:'高値更新か、押し目からの反発を確認。',sell:'20日平均と直近20日安値を下回らないか確認。'};
  if(p.breakdown||p.price<p.ma50&&p.ma20<p.ma50)return {...result,code:'weak',label:p.breakdown?'直近安値を下回る':'下落基調',tint:'risk',reason:p.breakdown?'直近20営業日の終値安値を下回っています。':'株価と20日平均が50日平均を下回っています。',buy:'反発だけで決めず、50日平均の回復と業績を確認。',sell:'撤退条件に触れていないか、投資根拠と保有量を見直す。'};
  if(p.overheated)return {...result,code:'hot',label:'短期過熱を確認',tint:'caution',reason:`20日平均との乖離 ${p.distance_ma20_pct.toFixed(1)}%、RSI ${p.rsi14_simple.toFixed(0)}。`,buy:'高値を追う前に、20日平均への接近と反発を確認。',sell:'含み益・保有比率・投資根拠から一部利確の条件を確認。過熱だけで全売却を決めない。'};
  if(p.breakout)return {...result,code:'breakout',label:'直近高値を上回る',tint:'blue',reason:`20営業日の終値高値を更新。出来高 ${Number.isFinite(p.rvol)?p.rvol.toFixed(1)+'倍':'未取得'}。`,buy:'上抜けの維持、出来高1.2倍以上、次の決算を確認。',sell:'上抜け水準を維持するか確認。失速時は投資根拠を再確認。'};
  if(p.trend_up&&Math.abs(p.distance_ma20_pct)<=3)return {...result,code:'pullback',label:'20日平均に接近',tint:'blue',reason:'上昇基調の中で20日平均から±3%以内です。',buy:'20日平均付近での下げ止まりと反発を確認。',sell:'20日平均を割れた後、50日平均まで崩れないか確認。'};
  if(p.trend_up)return {...result,code:'trend',label:'上昇基調',tint:'blue',reason:'株価と20日平均が50日平均を上回っています。',buy:'20日平均付近への押し目、または高値更新を待って確認。',sell:'トレンドの維持と業績・需給の変化を確認。'};
  return result;
}

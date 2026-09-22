import {reportText} from './news-ui.js';
import {captureUsage,usageBackup} from './usage.js';
import {loadPhaseA,bindPhaseSort} from './phase-a.js';
import {createPager,createNavigation,TAB_ROUTES,parseRoute} from './pager.js';
import {recordRationales,toggleRationale,MAX_RATIONALES} from './rationales.js';
import {recordDecision} from './decisions.js';
import {loadSymbols,bindSymbolPickers,fromForm,manyFromForm,remember,registerWatch,ensureUnique,verifyIncoming} from './symbols.js';
import {esc,notice,download,today} from './ui.js';
import {read,get,mutate,commit,validate,rawBackup,storageError,migrate} from './state.js';
import {loadPublic} from './data.js';
import {snapshotsCSV,cashFlowsCSV,parseCSV} from './accounting.js';
import {themesView} from './themes.js';
import {homeView,stocksView,newsView,settingsView} from './views.js';
import {portfolioView} from './portfolio.js';
let data={},themeTab='rank',stockTab='watch',month=today().slice(0,7),selected=today(),editTicker='',editFlow='',newsFilter='all';
read();bindSymbolPickers();
document.addEventListener('visibilitychange',()=>{if(!document.hidden){captureUsage(get(),data,notice);autoRefresh();}});
window.addEventListener('pageshow',event=>{if(event.persisted)autoRefresh();});
window.addEventListener('online',()=>autoRefresh());
bindPhaseSort(()=>data.phaseA?.themes?.[decodeURIComponent(parseRoute(location.hash).page||'')]);

function screenHTML(route,page=''){const s=get();const views={home:()=>homeView(data,s),themes:()=>themesView(data,themeTab,page),stocks:()=>stocksView(data,s,stockTab,page),news:()=>newsView(data,s,page,newsFilter),portfolio:()=>portfolioView(s,page,month,selected,editTicker,editFlow),settings:()=>settingsView(s,storageError,data)};return ''+(storageError?`<p class="warning">${esc(storageError)}</p>`:'')+(views[route]||views.home)();}
const main=document.querySelector('#main');
function syncTab(route){
 document.querySelectorAll('.bottom a').forEach(a=>{const active=a.hash===`#${route}`;a.classList.toggle('active',active);if(active)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});
 document.title=`株ゴリラ🦍 · ${{home:'ホーム',themes:'テーマ',stocks:'銘柄',news:'ニュース',portfolio:'保有',settings:'設定'}[route]||'ホーム'}`;
}
const pager=createPager(main,{html:screenHTML,onTab:route=>{navigation.sync(route);syncTab(route);}});
const navigation=createNavigation({onTop:route=>pager.select(route),onDetail:(route,page)=>{pager.showDetail(route,page);syncTab(TAB_ROUTES.includes(route)?route:history.state?.kabugorilla?.tab||'home');}});
const navigate=hash=>navigation.go(hash);
function render(){pager.refresh();const {route,page}=parseRoute(location.hash);if(page||!TAB_ROUTES.includes(route)){const top=pager.detail.scrollTop;pager.showDetail(route,page);pager.detail.scrollTop=top;}captureUsage(get(),data,notice);}
document.addEventListener('click',event=>{const a=event.target.closest('a[href^="#"]');if(!a||event.defaultPrevented||event.button||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
 event.preventDefault();if(a.hash==='#main'){main.focus();return;}if(a.hash==='#portfolio/edit')editTicker='',editFlow='';navigate(a.hash);
});
let refreshTask=null,lastRefresh=0,symbolsLoaded=false;
async function refresh({silent=false}={}){
 if(refreshTask)return refreshTask;
 lastRefresh=Date.now();
 if(!silent)notice('最新データを確認しています…');
 document.querySelectorAll('[data-refresh]').forEach(b=>{b.disabled=true;b.setAttribute('aria-busy','true');});
 refreshTask=(async()=>{
  const [publicData,phaseA,symbols]=await Promise.all([loadPublic(),loadPhaseA(),symbolsLoaded?Promise.resolve(null):loadSymbols()]);
  if(symbols?.length)symbolsLoaded=true;
  data={...publicData,checkedAt:new Date().toISOString()};
  if(phaseA)data.phaseA=phaseA;
  const editing=main.querySelector('.detail-page:not([hidden]) form')||document.activeElement?.matches('input,textarea,select')||main.querySelector('[data-stock-search]')?.value;
  if(!silent||!editing)render();
  if(!silent)notice(Object.values(data).some(x=>x?.error)?'一部取得できませんでした。更新状況をご確認ください。':'確認しました。データの基準日を表示しています。');
 })().finally(()=>{refreshTask=null;document.querySelectorAll('[data-refresh]').forEach(b=>{b.disabled=false;b.removeAttribute('aria-busy');});});
 return refreshTask;
}
function autoRefresh(){if(!document.hidden&&Date.now()-lastRefresh>60000)refresh({silent:true});}
setInterval(()=>{if(!document.hidden)refresh({silent:true});},5*60*1000);

const run=fn=>{try{fn();render();notice('端末に保存しました。');}catch(e){notice(e.message);}};
const number=(f,k)=>{const v=f.get(k);if(v===null||String(v).trim()==='')throw Error('金額・株数を入力してください。');const n=Number(v);if(!Number.isFinite(n))throw Error('数値が不正です。');return n;};
const optional=(f,k)=>String(f.get(k)||'').trim()===''?null:number(f,k);
const text=(f,k)=>String(f.get(k)||'').trim();
const ticker=(f,k='ticker')=>text(f,k).toUpperCase();
const split=v=>v.split(',').map(x=>x.trim()).filter(Boolean);
const rows=v=>parseCSV(v).map(r=>{if(r.length!==2||!r[1].trim()||!Number.isFinite(Number(r[1])))throw Error('明細は各行「名称,金額」で入力してください。');return {name:r[0].trim(),value:Number(r[1])};});
document.addEventListener('submit',event=>{event.preventDefault();const id=event.target.dataset.form||event.target.id,f=new FormData(event.target);run(()=>{
 if(id==='watch-form'){const r=fromForm(f);mutate(s=>registerWatch(s,r));}
 else if(id==='policy-form')mutate(s=>s.policy=text(f,'policy'));
 else if(id==='holding-form')mutate(s=>{const r=fromForm(f);if(editTicker&&r.symbol!==editTicker)throw Error('編集では銘柄を変更できません。新しい保有として登録してください。');if(!editTicker)ensureUnique(r.symbol,s.holdings.map(h=>h.ticker));remember(s,r);const previous=s.holdings.find(x=>x.ticker===r.symbol);const h={...previous,ticker:r.symbol,quantity:number(f,'quantity'),cost:number(f,'cost'),currency:text(f,'currency'),decision:previous?.decision||'unset'};s.holdings=s.holdings.filter(x=>x.ticker!==h.ticker);s.holdings.push(h);recordDecision(s,'held',h.ticker,text(f,'decision'));recordRationales(s,h.ticker,f.getAll('rationaleTags'));});
 else if(id==='watch-decision-form')mutate(s=>recordDecision(s,'watch',text(f,'ticker'),text(f,'decision')));
 else if(id==='snapshot-form')mutate(s=>{const x={date:text(f,'date'),timestamp:text(f,'timestamp')||null,assets_jpy:number(f,'assets'),valuation_basis:text(f,'basis'),status:text(f,'status'),components:Object.fromEntries(['price','fx','realized','other'].map(k=>[k,optional(f,k)])),...Object.fromEntries(['allocation','stockContributions','themeContributions'].map(k=>[k,rows(text(f,k))]))};s.snapshots=s.snapshots.filter(d=>d.date!==x.date);s.snapshots.push(x);selected=x.date;month=x.date.slice(0,7);});
 else if(id==='dividend-form')mutate(s=>{const r=fromForm(f);remember(s,r);s.dividends.push({id:crypto.randomUUID(),payment_date:text(f,'date'),timestamp:text(f,'timestamp')||null,ticker:r.symbol,net_amount:number(f,'net'),tax_information:{withheld:optional(f,'withheld'),note:text(f,'taxNote')},currency:text(f,'currency'),fx:number(f,'fx'),status:'paid'});});
 else if(id==='flow-form')mutate(s=>{const amount=number(f,'amount');if(amount<=0)throw Error('正の金額を入力してください。');const flow={id:text(f,'id')||crypto.randomUUID(),date:text(f,'date'),timestamp:text(f,'timestamp')||null,amount_jpy:text(f,'type')==='deposit'?amount:-amount,type:text(f,'type'),note:text(f,'note')};s.cashFlows=s.cashFlows.filter(x=>x.id!==flow.id);s.cashFlows.push(flow);editFlow='';});
 else if(id==='flow-quality-form')mutate(s=>s.cashFlowQuality={status:text(f,'status'),note:text(f,'note')});
 else if(id==='baseline-form')mutate(s=>s.yearBaselines[text(f,'year')]=text(f,'date'));
 else if(id==='news-form')mutate(s=>{const refs=manyFromForm(f);if(text(f,'tickers_query'))throw Error('関連銘柄は候補から選択してください。');refs.forEach(r=>remember(s,r));s.news.push({id:crypto.randomUUID(),title:text(f,'title'),date:text(f,'date'),source:text(f,'source'),url:text(f,'url'),importance:text(f,'importance'),sentiment:text(f,'sentiment'),tickers:refs.map(r=>r.symbol),themes:split(text(f,'themes')),summary:text(f,'summary').split('\n').map(x=>x.trim()).filter(Boolean),why:text(f,'why'),verified:f.get('verified')==='on'});});
 });});
document.addEventListener('click',event=>{const b=event.target.closest('button');if(!b)return;
 if(b.dataset.rationaleTag){run(()=>mutate(s=>toggleRationale(s,b.dataset.rationaleTicker,b.dataset.rationaleTag)));const next=[...document.querySelectorAll('[data-rationale-tag]')].find(x=>x.dataset.rationaleTag===b.dataset.rationaleTag);next?.focus({preventScroll:true});return;}
 if(b.dataset.tab){if(b.dataset.tab==='themeTab')themeTab=b.dataset.value;else stockTab=b.dataset.value;render();return;}
 if(b.dataset.month){const [y,m]=month.split('-').map(Number);month=new Date(Date.UTC(y,m-1+Number(b.dataset.month),1)).toISOString().slice(0,7);render();return;}
 if(b.dataset.date){selected=b.dataset.date;navigate('#portfolio/day');return;}
 if(b.dataset.entryDate){selected=b.dataset.entryDate;navigate('#portfolio/entry');return;}
 if(b.dataset.editFlow){editFlow=b.dataset.editFlow;render();return;}
 if(b.dataset.editHolding){editTicker=b.dataset.editHolding;navigate('#portfolio/edit');return;}
 if(b.id==='refresh-data'||b.hasAttribute('data-refresh')){refresh();return;}
 if(b.dataset.stockScope){stockTab=b.dataset.stockScope;render();navigate('#stocks');return;}
 if(b.dataset.newsFilter){newsFilter=b.dataset.newsFilter;render();return;}
 if(b.dataset.copyReport){const n=data.news?.value?.articles?.find(n=>n.id===b.dataset.copyReport);if(n)navigator.clipboard?.writeText(reportText(n)).then(()=>notice('レポートをコピーしました。')).catch(()=>notice('コピーできませんでした。元ソースを開いて確認してください。'));return;}
 if(b.id==='export-private'){try{download(`mystockos-private-${today()}.json`,rawBackup());}catch{notice('保存済みデータを書き出せませんでした。');}return;}
 if(b.id==='export-usage'){usageBackup().then(raw=>download(`mystockos-usage-${today()}.json`,raw)).catch(e=>notice(`利用履歴を書き出せませんでした：${e.message}`));return;}
 if(b.id==='csv-template'){download('mystockos-daily-template.csv','date,timestamp,assets_jpy,valuation_basis,status\n','text/csv');return;}
 if(b.id==='flow-csv-template'){download('mystockos-cashflows-template.csv','id,date,timestamp,amount_jpy,type,note\n','text/csv');return;}
 const remove=[['removeFlow','cashFlows','id'],['removeHolding','holdings','ticker'],['removeDividend','dividends','id'],['removeNews','news','id']].find(([key])=>b.dataset[key]);
 if(remove){const [key,collection,prop]=remove;if(confirm('この端末の記録を削除しますか？'))run(()=>mutate(s=>s[collection]=s[collection].filter(x=>x[prop]!==b.dataset[key])));return;}
 if(b.dataset.removeWatch)run(()=>mutate(s=>s.watch=s.watch.filter(x=>x!==b.dataset.removeWatch)));
 if(b.dataset.addWatch){const ticker=b.dataset.addWatch;navigate('#stocks/add');{const input=document.querySelector('#watch-form [data-symbol-query]');if(!input)return;input.value=ticker;input.dispatchEvent(new Event('input',{bubbles:true}));input.focus();notice('候補から銘柄と市場を選択して追加してください。');}}
});
document.addEventListener('click',event=>{if(event.target.closest('a[href="#portfolio/edit"]'))editTicker='',editFlow='';});
document.addEventListener('change',event=>{const input=event.target;if(input.name==='rationaleTags'&&input.checked&&input.form.querySelectorAll('[name="rationaleTags"]:checked').length>MAX_RATIONALES){input.checked=false;notice('投資根拠は最大3個まで選択できます。');}});
document.addEventListener('change',async event=>{const input=event.target;if(!['import-private','import-csv','import-flows-csv'].includes(input.id)||!input.files?.length)return;try{const file=input.files[0];if(file.size>5_000_000)throw Error('ファイルは5MB以内にしてください。');const raw=await file.text();let next;if(input.id==='import-private'){next=migrate(JSON.parse(raw));}else if(input.id==='import-flows-csv'){next=structuredClone(get());const entries=cashFlowsCSV(raw);if(new Set(entries.map(f=>f.id)).size!==entries.length)throw Error('CSV内の入出金IDが重複しています。');for(const x of entries){next.cashFlows=next.cashFlows.filter(y=>y.id!==x.id);next.cashFlows.push(x);}validate(next);}else{next=structuredClone(get());for(const x of snapshotsCSV(raw)){const old=next.snapshots.find(y=>y.date===x.date);next.snapshots=next.snapshots.filter(y=>y.date!==x.date);next.snapshots.push(old?{...old,...x,components:old.components,allocation:old.allocation,stockContributions:old.stockContributions,themeContributions:old.themeContributions}:x);}validate(next);}verifyIncoming(next,get());if(confirm(`内容を検証しました。保有 ${next.holdings.length}銘柄・評価 ${next.snapshots.length}件・入出金 ${next.cashFlows.length}件。端末の記録に反映しますか？`)){commit(next);render();notice('読み込みが完了しました。');}}catch(e){notice(`保存していません：${e.message}`);}finally{input.value='';}});
render();navigation.show();refresh();

document.addEventListener('input',event=>{if(!event.target.matches('[data-stock-search]'))return;const root=event.target.closest('.tab-page'),q=event.target.value.trim().toUpperCase();let shown=0;root.querySelectorAll('[data-stock-ticker]').forEach(row=>{const show=row.dataset.stockTicker.includes(q);row.hidden=!show;if(show)shown++;});root.querySelector('[data-no-stock-results]').hidden=shown!==0;});

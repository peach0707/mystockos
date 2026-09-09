import {bindPageSwipe} from './swipe.js';
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
let data={},themeTab='rank',stockTab='watch',month=today().slice(0,7),selected=today(),editTicker='',editFlow='';
read();bindSymbolPickers();
function render(focus=false){const [route='home',page='']=location.hash.slice(1).split('/'),s=get();const main=document.querySelector('#main');const views={home:()=>homeView(data,s),themes:()=>themesView(data,themeTab,page),stocks:()=>stocksView(data,s,stockTab,page),news:()=>newsView(s),portfolio:()=>portfolioView(s,page,month,selected,editTicker,editFlow),settings:()=>settingsView(s,storageError)};main.innerHTML=Object.entries(data).filter(([,d])=>d.error).map(([k,d])=>`<p class="warning">${esc({regime:'市場',themes:'テーマ',stocks:'株価'}[k])}：${d.cached?'前回の端末保存を表示中':'取得できません'}（${esc(d.error)}）</p>`).join('')+(storageError?`<p class="warning">${esc(storageError)}</p>`:'')+(views[route]||views.home)();document.querySelectorAll('.bottom a').forEach(a=>{a.classList.toggle('active',a.hash===`#${route}`);if(a.hash===`#${route}`)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});document.title=`株ゴリラ🦍 · ${{home:'ホーム',themes:'テーマ',stocks:'銘柄',news:'ニュース',portfolio:'保有',settings:'設定'}[route]||'ホーム'}`;if(focus){main.focus();window.scrollTo(0,0);}}
window.addEventListener('hashchange',()=>render(true));
bindPageSwipe(document.querySelector('#main'));
async function refresh(){notice('公開データを確認しています…');[data]=await Promise.all([loadPublic(),loadSymbols()]);render();notice(Object.values(data).some(x=>x.error)?'一部取得できませんでした。保存データと基準日を確認してください。':'公開データを読み込みました。');}
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
 if(b.dataset.date){selected=b.dataset.date;location.hash='#portfolio/day';render();return;}
 if(b.dataset.entryDate){selected=b.dataset.entryDate;location.hash='portfolio/entry';return;}
 if(b.dataset.editFlow){editFlow=b.dataset.editFlow;render();return;}
 if(b.dataset.editHolding){editTicker=b.dataset.editHolding;location.hash='portfolio/edit';return;}
 if(b.id==='refresh-data'){refresh();return;}
 if(b.id==='export-private'){try{download(`mystockos-private-${today()}.json`,rawBackup());}catch{notice('保存済みデータを書き出せませんでした。');}return;}
 if(b.id==='csv-template'){download('mystockos-daily-template.csv','date,timestamp,assets_jpy,valuation_basis,status\n','text/csv');return;}
 if(b.id==='flow-csv-template'){download('mystockos-cashflows-template.csv','id,date,timestamp,amount_jpy,type,note\n','text/csv');return;}
 const remove=[['removeFlow','cashFlows','id'],['removeHolding','holdings','ticker'],['removeDividend','dividends','id'],['removeNews','news','id']].find(([key])=>b.dataset[key]);
 if(remove){const [key,collection,prop]=remove;if(confirm('この端末の記録を削除しますか？'))run(()=>mutate(s=>s[collection]=s[collection].filter(x=>x[prop]!==b.dataset[key])));return;}
 if(b.dataset.removeWatch)run(()=>mutate(s=>s.watch=s.watch.filter(x=>x!==b.dataset.removeWatch)));
 if(b.dataset.addWatch){const ticker=b.dataset.addWatch;window.addEventListener('hashchange',()=>{const input=document.querySelector('#watch-form [data-symbol-query]');if(!input)return;input.value=ticker;input.dispatchEvent(new Event('input',{bubbles:true}));input.focus();notice('候補から銘柄と市場を選択して追加してください。');},{once:true});location.hash='#stocks/add';}
});
document.addEventListener('click',event=>{if(event.target.closest('a[href="#portfolio/edit"]'))editTicker='',editFlow='';});
document.addEventListener('change',event=>{const input=event.target;if(input.name==='rationaleTags'&&input.checked&&input.form.querySelectorAll('[name="rationaleTags"]:checked').length>MAX_RATIONALES){input.checked=false;notice('投資根拠は最大3個まで選択できます。');}});
document.addEventListener('change',async event=>{const input=event.target;if(!['import-private','import-csv','import-flows-csv'].includes(input.id)||!input.files?.length)return;try{const file=input.files[0];if(file.size>5_000_000)throw Error('ファイルは5MB以内にしてください。');const raw=await file.text();let next;if(input.id==='import-private'){next=migrate(JSON.parse(raw));}else if(input.id==='import-flows-csv'){next=structuredClone(get());const entries=cashFlowsCSV(raw);if(new Set(entries.map(f=>f.id)).size!==entries.length)throw Error('CSV内の入出金IDが重複しています。');for(const x of entries){next.cashFlows=next.cashFlows.filter(y=>y.id!==x.id);next.cashFlows.push(x);}validate(next);}else{next=structuredClone(get());for(const x of snapshotsCSV(raw)){const old=next.snapshots.find(y=>y.date===x.date);next.snapshots=next.snapshots.filter(y=>y.date!==x.date);next.snapshots.push(old?{...old,...x,components:old.components,allocation:old.allocation,stockContributions:old.stockContributions,themeContributions:old.themeContributions}:x);}validate(next);}verifyIncoming(next,get());if(confirm(`内容を検証しました。保有 ${next.holdings.length}銘柄・評価 ${next.snapshots.length}件・入出金 ${next.cashFlows.length}件。端末の記録に反映しますか？`)){commit(next);render();notice('読み込みが完了しました。');}}catch(e){notice(`保存していません：${e.message}`);}finally{input.value='';}});
render();refresh();

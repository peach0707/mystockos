import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fresh as freshEmpty} from '../assets/js/state.js';
import {themeNames,themeName} from '../assets/js/display-ja.js';
import {themesView,themeDetail} from '../assets/js/themes.js';
import {stocksView,homeView,settingsView} from '../assets/js/views.js';
import {portfolioView} from '../assets/js/portfolio.js';
const load=p=>JSON.parse(fs.readFileSync(new URL('../'+p,import.meta.url)));
const data={themes:{value:load('data/themes.json')},regime:{value:load('data/regime.json')},stocks:{value:load('data.json')}};
const text=h=>h.replace(/<[^>]*>/g,' ');
test('all frozen themes have Japanese display names; identifiers and input data remain intact',()=>{const before=JSON.stringify(data);assert.equal(Object.keys(themeNames).length,29);const h=themesView(data,'rank');for(const t of data.themes.value.themes){assert.ok(themeNames[t.theme_id]);assert.ok(h.includes(themeName(t)));assert.ok(!text(h).includes(t.name));}assert.equal(JSON.stringify(data),before);});
test('theme reading cards and details retain evidence, hide unverified forecasts and avoid legacy English labels',()=>{const s=fresh(),html=[themesView(data,'rank'),...data.themes.value.themes.map(themeDetail),themesView(data,'early'),themesView(data,'weak'),stocksView(data,s,'all'),homeView(data,s),settingsView(s,'')].join('');for(const word of ['Strength','Velocity','Heat','Turning','Weakening','Improving','Leading','Lagging','Hot','Core','Related','Watch','Overlay','Theme System','Strong','Weak','deep drawdown'])assert.ok(!new RegExp('\\b'+word+'\\b').test(text(html)),word);assert.match(html,/class="theme-reading-card"/);assert.match(html,/先行/);assert.doesNotMatch(html,/class="future">—/);assert.match(html,/予測精度は未検証/);assert.match(html,/参考情報（スコア対象外）/);});
test('home prioritizes personal decisions and news and stock decision controls stay on separate detail pages',()=>{const s=fresh(),h=homeView(data,s);let prev=-1;for(const title of ['前回からの重要な変化','自分に関係するニュース','自分の銘柄']){const i=h.indexOf('<h2>'+title);assert.ok(i>prev,title);prev=i;}assert.match(stocksView(data,s,'all'),/<a class="stock-row decision-card"/);assert.doesNotMatch(stocksView(data,s,'all'),/watch-decision-form/);assert.match(stocksView(data,s,'watch','MU'),/watch-decision-form/);});
test('calendar summary never fabricates missing monthly data and personal state is not changed by views',()=>{const s=fresh(),before=JSON.stringify(s);const h=portfolioView(s,'calendar','2026-09','2026-09-14','');assert.match(h,/今月損益/);assert.match(h,/今月損益率/);assert.match(h,/データ不足/);assert.equal(JSON.stringify(s),before);});

function fresh(){return {...freshEmpty(),watch:['MU','TSM','AVGO','COHR','LITE']};}

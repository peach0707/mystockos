import test from 'node:test';
import assert from 'node:assert/strict';
import {weeklyGroups,weeklyReportText,articlesFor,newsCard} from '../assets/js/news-ui.js';

test('memory includes Sandisk NAND and company filters only match direct coverage',()=>{
 const n={id:'a',title:'English headline',headline_ja:'発表を確認',topic:'storage',topic_label:'NAND',published_at:'2026-10-01T00:00:00Z',direct_tickers:['SNDK'],related_tickers:['MU'],source:'Sandisk',brief:{status:'ready',basis:'article_body',headline_ja:'新型SSDを発表',summary_ja:'本文に基づく日本語の要約です。'}};
 const data={news:{value:{articles:[n]}}},s={watch:[],holdings:[]};
 assert.equal(articlesFor(data,s,'memory').length,1);
 assert.equal(articlesFor(data,s,'SNDK').length,1);
 assert.equal(articlesFor(data,s,'MU').length,0);
 assert.ok(newsCard(n).includes(n.brief.summary_ja));
 assert.ok(!newsCard(n).includes(n.title));
 delete n.brief;assert.ok(newsCard(n).includes('要約待ち'));
});

test('weekly report excludes future and older items and joins only the users registered tickers',()=>{
 const now=Date.parse('2026-09-22T12:00:00Z');
 const row={topic:'optical',topic_label:'光通信',direct_tickers:['LITE'],related_tickers:['COHR','AAOI'],subjects:['レーザー'],published_at:'2026-09-21T12:00:00Z'};
 const s={watch:['COHR'],holdings:[{ticker:'LITE'}]};
 const items=[row,{...row,published_at:'2026-09-01T12:00:00Z'},{...row,published_at:'2026-09-23T12:00:00Z'}];
 const groups=weeklyGroups(items,s,now);
 assert.equal(groups.length,1);assert.equal(groups[0].articles.length,1);
 assert.deepEqual([...groups[0].tickers],['LITE','COHR']);
 assert.equal(s.holdings[0].ticker,'LITE');
});

test('a copied report retains original titles, publication dates, source links and conditional context',()=>{
 const now=new Date().toISOString();
 const row={id:'one',topic:'memory',topic_label:'メモリ',title:'Example title',headline_ja:'見出し',published_at:now,direct_tickers:['MU'],related_tickers:[],impact:'確定受注ではありません',follow_up:'量産時期を確認',url:'https://example.com/release'};
 const output=weeklyReportText({news:{value:{checked_at:now,articles:[row]}}},{watch:['MU'],holdings:[]});
 for(const expected of [row.title,row.published_at,row.url,row.impact,'MU'])assert.ok(output.includes(expected));
});

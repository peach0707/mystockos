import test from 'node:test';
import assert from 'node:assert/strict';
import {vixReading,memoryWatch} from '../assets/js/market-context.js';
const now=Date.parse('2026-10-02T12:00:00Z');
const calendar={start:'2026-09-01',end:'2026-10-31',sessions:[{date:'2026-10-01',close:'2026-10-01T20:00:00Z'}]};
test('VIX levels only interpret a current, successfully fetched close',()=>{
 const data={calendar:{value:calendar},vix:{value:{close:24,as_of:'2026-10-01',fetch_status:'ok'}}};
 assert.equal(vixReading(data,now).level,'大きな値動きに注意');
 data.vix.value.as_of='2026-09-29';assert.equal(vixReading(data,now).ready,false);
 data.vix.value.as_of='2026-10-01';data.vix.value.fetch_status='failed';assert.equal(vixReading(data,now).ready,false);
 data.vix.value.fetch_status='ok';data.vix.cached=true;assert.equal(vixReading(data,now).ready,false);
 data.vix.cached=false;data.vix.value.close=null;assert.equal(vixReading(data,now).ready,false);
});
test('memory desk includes NAND company without modifying watch or holdings',()=>{
 const html=memoryWatch({});
 for(const ticker of ['MU','SKHY','SNDK'])assert.ok(html.includes('#stocks/'+ticker));
 assert.ok(html.includes('NAND・SSD'));
});

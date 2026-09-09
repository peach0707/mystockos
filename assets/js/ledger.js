import {dateValid} from './ui.js';

// Date-only records use the portfolio's Japan accounting date, not device TZ.
export function timestampValid(value, date) {
  if (value === null) return true;
  if (typeof value !== 'string' || !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) return false;
  return new Date(value).toLocaleDateString('sv-SE', {timeZone:'Asia/Tokyo'}) === date;
}
export const boundary = x => x.timestamp ? Date.parse(x.timestamp) : Date.parse(`${x.date}T23:59:59.999+09:00`);
export function eventPosition(date, timestamp, from, to) {
  const lo = timestamp ? Date.parse(timestamp) : Date.parse(`${date}T00:00:00+09:00`);
  const hi = timestamp ? lo : Date.parse(`${date}T23:59:59.999+09:00`);
  const left = boundary(from), right = boundary(to);
  if (hi <= left || lo > right) return 'outside';
  return lo > left && hi <= right ? 'inside' : 'ambiguous';
}
export function intervalFlows(s, from, to) {
  if (s.cashFlowQuality?.status !== 'complete') return {net:null,count:0,reason:'データ不足：入出金履歴が不完全です'};
  let net=0,count=0;
  for(const f of s.cashFlows) {
    const where=eventPosition(f.date,f.timestamp,from,to);
    if(where==='ambiguous')return {net:null,count,reason:'データ不足：評価時刻と入出金時刻を確認してください'};
    if(where==='inside'){net+=f.amount_jpy;count++;}
  }
  return {net,count,reason:''};
}
export function snapshotRecord(x) {
  return {date:x.date,timestamp:x.timestamp??null,assets_jpy:x.assets_jpy,valuation_basis:x.valuation_basis,status:x.status,
    components:x.components||{price:null,fx:null,realized:null,other:null},
    stockContributions:x.stockContributions||[],themeContributions:x.themeContributions||[],allocation:x.allocation||[]};
}

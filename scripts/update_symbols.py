"""Independent public reference master; never touch theme/config/private data."""
import json, os, re, tempfile, time, urllib.request, urllib.error
from pathlib import Path
from datetime import datetime, timezone
DEST=Path('data/symbols.json')
def normalize(payload):
    if not isinstance(payload,dict) or payload.get('status')!='ok' or not isinstance(payload.get('data'),list):
        raise ValueError('Invalid reference response')
    out={}
    for r in payload['data']:
        symbol=str(r.get('symbol','')).strip().upper()
        name=str(r.get('name','')).strip();exchange=str(r.get('exchange','')).strip();mic=str(r.get('mic_code','')).strip()
        if not re.fullmatch(r'[A-Z0-9.^=-]{1,20}',symbol) or not name or not exchange:continue
        key='|'.join([symbol,mic or exchange,str(r.get('country',''))])
        out[key]={'id':key,'symbol':symbol,'name':name,'exchange':exchange,'mic_code':mic,'country':r.get('country',''),'currency':r.get('currency','')}
    if len(out)<1000 or not any(r['symbol']=='NVDA' and r['exchange']=='NASDAQ' for r in out.values()):raise ValueError('Incomplete reference response')
    return sorted(out.values(),key=lambda r:(r['symbol'],r['exchange'],r['id']))
def fetch():
    # /stocks reference list. Key, if required, stays in Actions only.
    headers={'Accept':'application/json'}
    if os.environ.get('TWELVE_DATA_API_KEY'):headers['Authorization']='apikey '+os.environ['TWELVE_DATA_API_KEY']
    for attempt in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request('https://api.twelvedata.com/stocks?country=United%20States',headers=headers),timeout=35) as r:return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code not in (429,500,502,503,504) or attempt==3:raise RuntimeError('Symbol reference HTTP failure; previous master retained') from None
        except (urllib.error.URLError,TimeoutError):
            if attempt==3:raise RuntimeError('Symbol reference timeout; previous master retained') from None
        time.sleep(min(10*2**attempt,40))
def save(rows,dest=DEST):
    if dest.exists():
        old=json.loads(dest.read_text()).get('symbols',[])
        if old and len(rows)<len(old)*0.85:raise ValueError('Unexpected reference shrink; previous master retained')
    result={'schema_version':1,'as_of':datetime.now(timezone.utc).date().isoformat(),'source':'Twelve Data /stocks','scope':'United States','symbols':rows}
    dest.parent.mkdir(parents=True,exist_ok=True)
    fd,tmp=tempfile.mkstemp(dir=dest.parent,suffix='.tmp')
    try:
        with os.fdopen(fd,'w') as f:json.dump(result,f,ensure_ascii=False,separators=(',',':'))
        os.replace(tmp,dest)
    finally:
        if os.path.exists(tmp):os.unlink(tmp)
if __name__=='__main__':
    rows=normalize(fetch());save(rows);print(f'Published {len(rows)} reference listings; no prices or keys included.')

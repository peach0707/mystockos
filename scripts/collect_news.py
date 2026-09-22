"""Official RSS/Atom -> Japanese event brief and explicitly conditional impact notes.

No paid API, article scraping or LLM. A publisher feed authenticates provenance,
not independent verification of a corporate claim. No headline-based price targets.
"""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone, timedelta
from email.utils import parsedate_to_datetime
from html import unescape
import hashlib
import json
from pathlib import Path
import re
import time
from urllib.parse import urlsplit, urlunsplit, parse_qsl, urlencode, urljoin
from urllib.request import Request, urlopen
from xml.etree import ElementTree as ET

from stock_setups import atomic_json

ROOT = Path(__file__).resolve().parents[1]
TOPICS = {
 'memory':('メモリ / HBM',['MU','SKHY'],'採用量・量産時期・販売価格を確認。供給拡大は出荷増と需給緩和の両面を持ちます。'),
 'storage':('NAND / ストレージ',['SNDK','WDC','STX','MU'],'出荷容量と単価、データセンター向け比率を確認。需要増が価格上昇につながるかが論点です。'),
 'optical':('光通信',['COHR','LITE','AAOI','CRDO','MRVL'],'通信速度・採用数・量産時期を確認。製品発表が実際の受注と売上に結びつくかを追います。'),
 'equipment':('半導体製造装置',['AMAT','LRCX','KLAC','ASML'],'設備投資額・発注時期・輸出規制を確認。投資計画から装置売上までには時間差があります。'),
 'foundry':('先端半導体',['TSM','ASML','AMAT'],'先端ノードとパッケージの稼働率・供給能力を確認。数量と利益率の両方を追います。'),
 'compute':('AI半導体 / インフラ',['NVDA','AMD','AVGO','TSM','MU','NBIS'],'導入規模・稼働時期・資金計画を確認。GPU、メモリ、通信部品への波及は採用構成次第です。')
}
KEYWORDS = re.compile(r'\b(hbm\w*|dram|nand|memory|semiconductor|chip\w*|ai|gpu\w*|ssd|photon\w*|optical|data.?cent\w*)\b', re.I)


def clean(text):
    return ' '.join(unescape(re.sub(r'<[^>]+>',' ',text or '')).split())


def canonical(url):
    p = urlsplit(url)
    if p.scheme != 'https' or not p.netloc or p.username or p.password:
        raise ValueError('invalid_link')
    query = [(k,v) for k,v in parse_qsl(p.query) if not k.lower().startswith('utm_') and k.lower() not in ('fbclid','gclid')]
    return urlunsplit((p.scheme,p.netloc.lower(),p.path.rstrip('/'),urlencode(query),''))


def date_of(value):
    try:
        dt = parsedate_to_datetime(value)
    except (ValueError, TypeError):
        dt = datetime.fromisoformat(value.replace('Z','+00:00'))
    if dt.tzinfo is None:
        raise ValueError('missing_timezone')
    return dt.astimezone(timezone.utc)


def classify(title, source):
    lower = title.lower()
    topic = source['topic']
    for regex, key in [(r'\b(hbm\w*|dram|lpddr\w*|memory)\b','memory'),(r'\b(nand|ssd|storage)\b','storage'),(r'\b(optical|photon\w*|transceiver\w*|cpo)\b','optical'),(r'\b(foundry|cowos|tsmc)\b','foundry')]:
        if re.search(regex,lower):
            topic = key
            break
    # Detect negation before classifying an apparently positive headline.
    if re.search(r'\b(not|no plans|denies|rumou?r|reportedly)\b',lower):
        event,label,impact = 'other','発表内容の確認が必要','見出しだけでは方向を判断できません。本文と会社の説明を確認します。'
    elif re.search(r'\b(to report|to announce|will report|will announce|schedule\w*|conference|participat\w*)\b',lower):
        event,label,impact = 'calendar','決算・説明会などの日程を案内','日程の案内です。業績の上振れ・下振れを示す発表ではありません。'
    elif re.search(r'\b(export|restrict\w*|sanction\w*|ban\w*|regulat\w*)\b',lower):
        event,label,impact = 'regulation','規制・取引条件に関する発表','対象地域・製品・発効日で影響が変わります。売上への制約と代替需要を確認します。'
    elif re.search(r'\b(results|earnings)\b',lower):
        event,label,impact = 'results','決算を発表','売上・粗利益率・次期見通しを前回予想と比較。決算発表という事実だけでは好悪を判定しません。'
    elif re.search(r'\b(expand\w*|invest\w*|manufacturing|fab|capacity)\b',lower):
        event,label,impact = 'capacity','投資・供給能力に関する発表','短期の投資負担と中期の供給増を分けて確認。稼働時期と顧客の需要が重要です。'
    elif re.search(r'\b(partner\w*|collaborat\w*|agreement|deploy\w*)\b',lower):
        event,label,impact = 'partnership','提携・導入に関する発表','契約の拘束力・数量・売上計上時期を確認。計画段階と確定受注を区別します。'
    elif re.search(r'\b(launch\w*|introduc\w*|unveil\w*|announc\w*|deliver\w*)\b',lower):
        event,label,impact = 'product','製品・技術などを発表','性能・顧客採用・量産開始を確認。技術発表から業績への寄与は未確定です。'
    else:
        event,label,impact = 'other','企業情報を公表','投資判断が変わる材料かを本文で確認します。株価への方向は未判定です。'
    name,related,follow = TOPICS[topic]
    return {'topic':topic,'topic_label':name,'event':event,'headline_ja':source['company']+'：'+label,
            'summary_ja':source['company']+'の公式発表。'+label+'。',
            'impact':impact,'follow_up':follow,'direct_tickers':source['tickers'],
            'related_tickers':[t for t in related if t not in source['tickers']],
            'direction':'要確認','horizon':'発表直後〜次回決算','importance':'high' if event in ('results','regulation','capacity','partnership') else 'normal'}


def parse_feed(raw, source, now):
    if len(raw)>2_000_000 or b'<!DOCTYPE' in raw.upper() or b'<!ENTITY' in raw.upper():
        raise ValueError('unsafe_or_oversized_feed')
    root = ET.fromstring(raw)
    if root.tag.split('}')[-1] not in ('rss','feed','RDF'):
        raise ValueError('not_a_feed')
    items = [e for e in root.iter() if e.tag.split('}')[-1] in ('item','entry')]
    if not items:
        raise ValueError('empty_feed')
    records = []
    for item in items[:100]:
        fields = {e.tag.split('}')[-1]:e for e in item}
        def text(key):
            return ''.join(fields[key].itertext()).strip() if key in fields else ''
        title = clean(text('title'))[:500]
        if not title or source.get('require_keywords') and not KEYWORDS.search(title):
            continue
        links = [e for e in item if e.tag.split('}')[-1]=='link']
        link = next((e.get('href') for e in links if e.get('rel','alternate')=='alternate' and e.get('href')),None) or text('link')
        try:
            base = source.get('urls',[''])[0]
            link = urljoin(base,unescape(link or ''))
            parts = urlsplit(link)
            if parts.scheme == 'http' and parts.netloc == urlsplit(base).netloc:
                link = urlunsplit(('https',parts.netloc,parts.path,parts.query,parts.fragment))
            url = canonical(link)
            published = date_of(text('pubDate') or text('published') or text('updated') or text('date'))
        except (ValueError, TypeError, AttributeError):
            continue
        if published > now+timedelta(minutes=5) or published < now-timedelta(days=90):
            continue
        fact = classify(title,source)
        records.append(dict(fact,id=hashlib.sha256(url.encode()).hexdigest()[:20],title=title,url=url,
                            published_at=published.isoformat(),source=source['name'],source_id=source['id'],
                            verification='official_feed',first_seen_at=now.isoformat(),
                            analysis_method='event_rules_v1',analysis_status='conditional_not_verified_impact'))
    return records


def fetch_source(source, now):
    failure = 'unavailable'
    for url in source['urls']:
        for attempt in range(2):
            try:
                req = Request(url,headers={'User-Agent':'Kabugorilla/1.0 (public investor RSS reader)','Accept':'application/rss+xml, application/atom+xml, application/xml, text/xml'})
                with urlopen(req,timeout=18) as response:
                    raw = response.read(2_000_001)
                records = parse_feed(raw,source,now)
                root = ET.fromstring(raw)
                first = next((e for e in root.iter() if e.tag.split('}')[-1] in ('item','entry')), None)
                latest = {e.tag.split('}')[-1]:clean(''.join(e.itertext()))[:180] for e in first} if first is not None else {}
                return records,{'id':source['id'],'name':source['name'],'status':'ok','checked_at':now.isoformat(),'count':len(records),'latest_title':latest.get('title'),'latest_date_raw':latest.get('pubDate') or latest.get('published') or latest.get('updated'),'latest_link':latest.get('link')}
            except Exception as error:
                failure = 'http_'+str(error.code) if hasattr(error,'code') else type(error).__name__
                if not attempt:
                    time.sleep(2)
    return [],{'id':source['id'],'name':source['name'],'status':'failed','checked_at':now.isoformat(),'count':0,'reason':failure}


def assemble(previous, results, now):
    existing = {n['id']:n for n in previous.get('articles',[])}
    articles = dict(existing)
    health = []
    for records,status in results:
        health.append(status)
        for row in records:
            row['first_seen_at'] = existing.get(row['id'],{}).get('first_seen_at',row['first_seen_at'])
            articles[row['id']] = row
    recent = [n for n in articles.values() if now-timedelta(days=90) <= date_of(n['published_at']) <= now+timedelta(minutes=5)]
    ordered = sorted(recent,key=lambda n:n['published_at'],reverse=True)
    seen = set()
    unique = []
    for n in ordered:
        key = (re.sub(r'\W+','',n['title'].lower()),n['published_at'][:10])
        if key not in seen:
            unique.append(n)
            seen.add(key)
    successful = sum(h['status']=='ok' for h in health)
    return {'schema_version':1,'checked_at':now.isoformat(),
            'last_success_at':now.isoformat() if successful else previous.get('last_success_at'),
            'status':'ok' if successful==len(health) else 'partial' if successful else 'failed',
            'sources':health,'articles':unique[:120],
            'method':'公式RSSの見出しを日本語で分類。影響は条件付きの確認ポイントで、本文全体のAI分析ではありません。'}


def main():
    now = datetime.now(timezone.utc)
    sources = json.loads((ROOT/'config/briefing.json').read_text())['sources']
    dest = ROOT/'data/news.json'
    previous = json.loads(dest.read_text()) if dest.exists() else {}
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(lambda s:fetch_source(s,now),sources))
    output = assemble(previous,results,now)
    atomic_json(dest,output)
    print(json.dumps({'status':output['status'],'articles':len(output['articles']),'sources':output['sources']}))


if __name__ == '__main__':
    main()

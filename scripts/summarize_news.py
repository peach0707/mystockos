"""Fetch official article bodies and produce cached, source-grounded Japanese briefs.

Translation runs locally on the update runner. No external inference API or private data.
Missing bodies/model failures remain explicitly pending, never headline summaries.
"""
import hashlib
import json
import re
from datetime import datetime, timezone, timedelta
from urllib.parse import urlsplit
from urllib.request import Request, urlopen, build_opener, HTTPRedirectHandler

from bs4 import BeautifulSoup
from stock_setups import atomic_json

MODEL = 'staka/fugumt-en-ja'
VERSION = 'article-extract-ja-v2'


def allowed(url, hosts):
    p = urlsplit(url)
    return p.scheme == 'https' and p.hostname in hosts and not p.username and not p.password and p.port in (None, 443)


def extract_body(html):
    soup = BeautifulSoup(html, 'html.parser')
    for e in soup(['script', 'style', 'nav', 'footer', 'header', 'aside', 'form']):
        e.decompose()
    article = soup.select_one('.field--name-body, .field-name-body, .entry-content, .article-body, .release-body, .news-release-body, .module-news-details .module_body, .module-news-details .module-body, .module-news-details, article, main')
    if article is None:
        raise ValueError('article_body_not_found')
    text = ' '.join(article.get_text(' ', strip=True).split())
    if len(text) < 450 or re.search(r'access denied|verify you are human|enable javascript and cookies', text, re.I):
        raise ValueError('article_body_unavailable')
    return text[:22000]


def fetch_body(url, hosts):
    class SafeRedirect(HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            if not allowed(newurl, hosts):
                raise ValueError('unexpected_redirect')
            return super().redirect_request(req, fp, code, msg, headers, newurl)
    if not allowed(url, hosts):
        raise ValueError('unexpected_article_host')
    req = Request(url, headers={'User-Agent': 'Mozilla/5.0 Kabugorilla public news reader'})
    with build_opener(SafeRedirect()).open(req, timeout=20) as response:
        raw = response.read(2_000_001)
        if len(raw) > 2_000_000:
            raise ValueError('article_too_large')
        return extract_body(raw.decode('utf-8', errors='replace'))


_translator = None
def important_sentences(body, title):
    import pysbd
    sentences = pysbd.Segmenter(language='en', clean=False).segment(body)
    candidates = []
    terms = set(re.findall(r'[a-z]{4,}', title.lower())) - {'announces', 'company', 'corporation'}
    for i, sentence in enumerate(sentences):
        sentence = ' '.join(sentence.split())
        words = sentence.split()
        if not 12 <= len(words) <= 90 or re.search(r'forward-looking|safe harbor|copyright|all rights reserved|cookie|privacy policy', sentence, re.I):
            continue
        score = sum(word in sentence.lower() for word in terms)
        score += 4 if re.search(r'revenue|earnings|gross margin|guidance|billion|million|HBM|DRAM|NAND|SSD|mass production', sentence, re.I) else 0
        score += max(0, 4-i/3)
        candidates.append((i, sentence, score))
    if not candidates:
        raise ValueError('no_article_sentences')
    selected = [candidates[0]]
    for candidate in sorted(candidates[1:], key=lambda x: -x[2]):
        if sum(len(x[1].split()) for x in selected) + len(candidate[1].split()) <= 170:
            selected.append(candidate)
        if len(selected) == 3:
            break
    return [s for _,s,_ in sorted(selected)]


def translate(texts):
    global _translator
    if _translator is None:
        import torch
        from transformers import MarianMTModel, MarianTokenizer
        torch.set_num_threads(2)
        tokenizer = MarianTokenizer.from_pretrained(MODEL)
        model = MarianMTModel.from_pretrained(MODEL)
        model.eval()
        _translator = (tokenizer, model)
    import torch
    tokenizer, model = _translator
    output = []
    for text in texts:
        inputs = tokenizer(text, return_tensors='pt', truncation=False)
        if inputs.input_ids.shape[1] > 480:
            raise ValueError('sentence_too_long')
        with torch.inference_mode():
            generated = model.generate(**inputs, max_new_tokens=400, num_beams=4)
        translated = tokenizer.decode(generated[0], skip_special_tokens=True).strip()
        if not re.search('[ぁ-んァ-ン一-龥]', translated):
            raise ValueError('translation_unavailable')
        output.append(translated)
    return output


def summarize(title, body, impact, follow_up):
    selected = important_sentences(body, title)
    translated = translate([title] + selected)
    return {'headline_ja': translated[0], 'summary_ja': ' '.join(translated[1:]),
            'impact_ja': impact, 'watch_ja': follow_up,
            'method': 'extractive_translation', 'sentence_count': len(selected)}


def enrich(output, sources, now, token=None, limit=12):
    hosts = {urlsplit(u).hostname for s in sources for u in s['urls']}
    hosts.update({'blogs.nvidia.com'})
    rows = sorted(output['articles'], key=lambda n: (n['source_id'] in ('micron', 'skhynix', 'sandisk', 'samsung'), n['published_at']), reverse=True)
    attempted = 0
    for n in rows:
        brief = n.get('brief', {})
        if brief.get('status') == 'ready' and brief.get('title') == n['title'] and brief.get('version') == VERSION:
            continue
        if datetime.fromisoformat(n['published_at'].replace('Z', '+00:00')) < now - timedelta(days=45):
            continue
        if attempted >= limit:
            break
        checked = brief.get('checked_at')
        if checked and brief.get('version') == VERSION and now - datetime.fromisoformat(checked) < timedelta(hours=6):
            continue
        attempted += 1
        stage = 'article'
        try:
            body = fetch_body(n['url'], hosts)
            stage = 'model'
            result = summarize(n['title'], body, n['impact'], n['follow_up'])
            n['brief'] = dict(result, status='ready', title=n['title'], version=VERSION, model=MODEL, checked_at=now.isoformat(), body_sha256=hashlib.sha256(body.encode()).hexdigest(), basis='article_body')
        except Exception as error:
            reason = 'http_' + str(error.code) if hasattr(error, 'code') else str(error) if isinstance(error, ValueError) else type(error).__name__
            n['brief'] = {'status': 'pending', 'version': VERSION, 'checked_at': now.isoformat(), 'reason': reason[:80]}
            print(json.dumps({'article': n['id'], 'summary': 'pending', 'reason': reason[:80]}))
            if stage == 'model' and reason in ('ImportError', 'ModuleNotFoundError', 'OSError'):
                break
    output['summary_coverage'] = {'ready': sum(n.get('brief', {}).get('status') == 'ready' for n in output['articles']), 'total': len(output['articles'])}
    return output

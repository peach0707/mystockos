"""Offline operational commands. Public-source capture costs zero market API calls."""
import argparse
import json
import sys
from uuid import uuid4
from pathlib import Path
from .store import Store, now, digest
from .engine import Engine
from .calendar import generate

PUBLIC_INPUTS=('data/regime.json','data/themes.json','data.json','config/themes.csv','config/entities.csv','config/memberships.csv','config/scoring_profiles.json')


def capture_repository(store, repo):
    # Explicit allowlist never walks local private portfolio storage or environment.
    captured=store.clock()
    sources={}
    for name in PUBLIC_INPUTS:
        body=(Path(repo)/name).read_bytes()
        as_of=captured[:10]
        if name.endswith('.json'):
            obj=json.loads(body)
            dates=[row['date'] for row in obj.get('stocks',[]) if isinstance(row,dict) and isinstance(row.get('date'),str)]
            as_of=obj.get('as_of') or (min(dates) if dates else as_of)
        sources[name]={'body':body,'source':'repository:'+name,'available_at':captured,'data_as_of':as_of,'revision':digest({'body_sha':__import__('hashlib').sha256(body).hexdigest()}),'license_class':'existing_public_repository_snapshot'}
    return store.capture(sources)


def ingest_bundle(store, filename):
    path=Path(filename).resolve();manifest=json.loads(path.read_text())
    sources={}
    for name,entry in manifest.items():
        sources[name]={**entry,'body':(path.parent/entry['file']).read_bytes()}
    return store.capture(sources)


def run_cycle(store, repo, prices=None, price_manifest=None):
    """Persist operational attempts without editing any prediction/outcome record."""
    run_id = str(uuid4())
    store.append('run_started', run_id, {'run_id':run_id, 'started_at':store.clock(), 'operation':'cycle'})
    result = {'run_id':run_id}
    try:
        try:
            result['observation_id'] = capture_repository(store, repo)
        except (OSError, ValueError, KeyError) as error:
            result['capture_error'] = str(error)
        if price_manifest:
            try:
                prices = ingest_bundle(store, price_manifest)
            except (OSError, ValueError, KeyError) as error:
                result['price_capture_error'] = str(error)
        result['scoring'] = Engine(store).score_due(prices)
        result['health'] = 'degraded' if ('capture_error' in result or 'price_capture_error' in result or result['scoring']['unresolved']) else 'ok'
    except Exception as error:
        store.append('run_finished', run_id, {**result, 'finished_at':store.clock(), 'health':'failed', 'error':str(error)})
        raise
    store.append('run_finished', run_id, {**result, 'finished_at':store.clock()})
    return result


def main(argv=None):
    parser=argparse.ArgumentParser(description='Forward Data / Shadow research storage; no trading signals')
    parser.add_argument('--db',required=True,help='Durable private SQLite path; never inside public web assets')
    parser.add_argument('--namespace',choices=['shadow','synthetic'],default='shadow')
    subs=parser.add_subparsers(dest='command',required=True)
    capture=subs.add_parser('capture');capture.add_argument('--repo',required=True)
    ingest=subs.add_parser('ingest');ingest.add_argument('--manifest',required=True,help='source descriptors with local raw file paths')
    reg=subs.add_parser('register');reg.add_argument('kind',choices=['model','factor']);reg.add_argument('version');reg.add_argument('--spec',required=True)
    issue=subs.add_parser('issue');issue.add_argument('--request',required=True)
    score=subs.add_parser('score');score.add_argument('--prices');score.add_argument('--correction-reason')
    cycle=subs.add_parser('cycle');cycle.add_argument('--repo',required=True);cycle.add_argument('--prices');cycle.add_argument('--price-manifest',help='Capture a provider-normalized local input bundle before automatic scoring')
    subs.add_parser('report');subs.add_parser('audit')
    backup=subs.add_parser('backup');backup.add_argument('--output',required=True)
    calendar=subs.add_parser('calendar');calendar.add_argument('--start',required=True);calendar.add_argument('--end',required=True);calendar.add_argument('--output',required=True)
    args=parser.parse_args(argv)
    # Avoid accidental GitHub Pages exposure. CLI expects caller-owned private disk.
    db=Path(args.db).resolve()
    if any(p in ('data','dist','public','assets','config') for p in db.parts):
        parser.error('DB must be outside public asset/data directories')
    store=Store(db,namespace=args.namespace);engine=Engine(store)
    try:
        if args.command=='capture': result={'observation_id':capture_repository(store,args.repo)}
        elif args.command=='ingest':
            result={'observation_id':ingest_bundle(store,args.manifest)}
        elif args.command=='register':result={'version':engine.register(args.kind,args.version,json.loads(Path(args.spec).read_text()))}
        elif args.command=='issue':result={'prediction_id':engine.issue(**json.loads(Path(args.request).read_text()))}
        elif args.command=='score':result=engine.score_due(args.prices,correction_reason=args.correction_reason)
        elif args.command=='cycle':
            result=run_cycle(store,args.repo,args.prices,args.price_manifest)
        elif args.command=='report':result=engine.report()
        elif args.command=='audit':result=store.audit()
        elif args.command=='backup':store.backup(args.output);result={'backup':args.output}
        else:
            output=Path(args.output)
            if output.exists():raise ValueError('calendar destination already exists; save a new revision')
            output.write_text(json.dumps(generate(args.start,args.end),ensure_ascii=False,indent=2))
            result={'calendar':str(output)}
        print(json.dumps(result,ensure_ascii=False,indent=2))
        return 2 if result.get('health')=='degraded' else 0
    except (ValueError,KeyError,OSError) as error:
        print(json.dumps({'error':str(error),'previous_records_preserved':True},ensure_ascii=False),file=sys.stderr)
        return 1
    finally:store.close()

if __name__=='__main__':
    raise SystemExit(main())

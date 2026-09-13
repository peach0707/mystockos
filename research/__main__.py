"""Explicit offline training and runtime issuance; no scheduled fitting."""
import argparse
import json
from pathlib import Path
from shadow.store import Store, now
from .archive import dataset
from .forecast import fit, issue, register_model, decision, score


def read(path):
    return json.loads(Path(path).read_text())


def main():
    p = argparse.ArgumentParser()
    commands = p.add_subparsers(dest='command', required=True)
    for name in ('audit-archive', 'train'):
        c = commands.add_parser(name)
        c.add_argument('--archive', required=True)
        c.add_argument('--calendar', required=True)
        if name == 'train':
            c.add_argument('--horizon', required=True, type=int, choices=(5,20,60))
            c.add_argument('--output', required=True)
    c = commands.add_parser('issue')
    for name in ('db','model','snapshot','calendar','request-id'):
        c.add_argument('--'+name, required=True)
    c.add_argument('--cost', type=float)
    c = commands.add_parser('score')
    for name in ('db','request-id','prices'):
        c.add_argument('--'+name, required=True)
    args = p.parse_args()
    if args.command in ('audit-archive','train'):
        data = dataset(Path(args.archive), read(args.calendar))
        if args.command == 'train':
            result = fit(data['samples'], args.horizon, now())
            # Exclusive creation prevents replacing a previously reviewed model.
            with Path(args.output).open('x') as target:
                json.dump(result,target,ensure_ascii=False,allow_nan=False)
            print(json.dumps({k:result.get(k) for k in ('record_hash','status','reason','train_sessions','oos_sessions')}))
        else:
            print(json.dumps(dict(data, samples=len(data['samples'])),ensure_ascii=False))
    else:
        store = Store(args.db)
        try:
            if args.command == 'issue':
                model = read(args.model)
                register_model(store,model)
                result = issue(store,args.request_id,model['record_hash'],read(args.snapshot),read(args.calendar))
                print(json.dumps(dict(result=result, decisions=[decision(result,holding=h,round_trip_cost=args.cost)
                                 for h in (True,False)]),ensure_ascii=False,allow_nan=False))
            else:
                print(json.dumps(score(store,args.request_id,read(args.prices)),ensure_ascii=False,allow_nan=False))
        finally:
            store.close()


if __name__ == '__main__':
    main()

"""Reproducible synthetic smoke run. Never writes to a shadow namespace."""
import argparse
import json
from pathlib import Path
from .store import Store, encoded
from .engine import Engine, TARGET


def run(directory):
    directory=Path(directory);directory.mkdir(parents=True,exist_ok=True)
    db=directory/'synthetic.sqlite3'
    if db.exists():raise ValueError('use a new empty demo directory')
    time=['2026-09-04T21:00:00Z']
    store=Store(db,namespace='synthetic',clock=lambda:time[0]);engine=Engine(store)
    def capture(values):
        return store.capture({name:{'body':encoded(value),'source':'synthetic-demo','available_at':time[0],'data_as_of':time[0][:10],'revision':'demo-v1','license_class':'synthetic'} for name,value in values.items()})
    calendar=json.loads((Path(__file__).resolve().parents[1]/'tests/fixtures/shadow_calendar_2026.json').read_text())
    definition={'namespace':'synthetic','theme_id':'demo','definition_version':'demo-v1','known_at':time[0],'valid_from':'2026-09-01','valid_to':None,'core':[{'entity_id':'demo_stock','ticker':'DEMO','exchange':'XNYS','currency':'USD'}],'benchmark':{'entity_id':'demo_bench','ticker':'BENCH','exchange':'ARCX','currency':'USD'}}
    engine.register('factor','demo-f1',{'stage':'experimental','namespace':'synthetic','code_hash':'synthetic-demo','description':'test only','required_inputs':['features']})
    engine.register('model','demo-m1',{'stage':'experimental','namespace':'synthetic','code_hash':'synthetic-demo','description':'test only','target':TARGET,'factor_version':'demo-f1'})
    manifest=capture({'calendar':calendar,'definition':definition,'features':{'synthetic':True}})
    ids={h:engine.issue(request_id=f'demo-{h}',theme_id='demo',horizon=h,model_version='demo-m1',factor_version='demo-f1',input_manifest=manifest,prediction={'expected_excess_return':0.01},confidence={'kind':'unvalidated','value':None,'evidence':'synthetic demonstration only'},reasons=['not a real forecast'],cost_model={'version':'demo-cost-v1','theme_roundtrip_rate':0.002,'benchmark_roundtrip_rate':0.001,'assumption':'synthetic roundtrip cost'},code_commit='synthetic-demo') for h in (5,20,60)}
    checkpoints=[engine.report()['counts']]
    for horizon,pid in ids.items():
        p=store.get('prediction',pid);time[0]=p['sessions'][-1]['close']
        # First maturity demonstrates a recoverable missing input, not a zero return.
        if horizon==5:
            engine.score_due();checkpoints.append(engine.report()['counts'])
        series=[]
        for instrument in [definition['core'][0],definition['benchmark']]:
            slope=0.002 if instrument['entity_id']=='demo_stock' else 0.001
            series.append({**instrument,'quality':'verified','adjustment_version':'demo-total-return-v1','bars':[{'session':s['date'],'open':100,'close':100*(1+slope*(i+1)),'available_at':s['close'],'quality':'verified','tradable_open':True} for i,s in enumerate(p['sessions'])]})
        evidence=capture({'prices':{'namespace':'synthetic','basis':'total_return','corporate_actions_complete':True,'adjustment_version':'demo-total-return-v1','source':'synthetic-demo','series':series}})
        engine.score_due(evidence);checkpoints.append(engine.report()['counts'])
    report={**engine.report(),'checkpoints':checkpoints,'notice':'Synthetic operational test; not performance evidence','outcomes':store.records('outcome')}
    (directory/'report.json').write_text(json.dumps(report,indent=2,ensure_ascii=False))
    store.backup(directory/'backup.sqlite3');store.close()
    print(json.dumps({'namespace':'synthetic','counts':report['counts'],'checkpoints':checkpoints,'report':str(directory/'report.json')},indent=2))
    return report

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--directory',required=True);args=parser.parse_args();run(args.directory)

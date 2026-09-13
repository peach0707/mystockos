import copy
import hashlib
import json
from datetime import timedelta
from pathlib import Path
import tempfile
import unittest

from research.forecast import (BASIS, FACTOR, TARGET, fit, prepare, walk_forward, predict,
    issue, score, decision, register_model, sealed)
from research.archive import dataset
from shadow.store import Store, digest, utc
from shadow.calendar import window

CALENDAR = json.loads((Path(__file__).parent/'fixtures/shadow_calendar_2026.json').read_text())
DAYS = CALENDAR['sessions']


def snapshot(i=40):
    return dict(namespace='synthetic', factor_version=FACTOR, theme_id='test_theme',
        benchmark='SPY', members=['AAA','BBB'], input_manifest='test-input-'+str(i), membership_hash='core-v1',
        source_hash='test-source-'+str(i), known_at=DAYS[i]['close'], issued_at=DAYS[i]['close'],
        data_as_of=DAYS[i]['date'], coverage=1, status='ok', feature_5d_return=.01,
        data_source='synthetic_fixture', adjustment_type='fixture_split', split_adjusted=True,
        dividend_adjusted=False, price_basis='price_return')


def sample(i, horizon=5):
    row = snapshot(i)
    sessions = window(CALENDAR,row['issued_at'],horizon)
    row.update(horizon=horizon, entry_at=sessions[0]['open'], entry_session=sessions[0]['date'],
        exit_at=sessions[-1]['close'], outcome_known_at=(utc(sessions[-1]['close'])+timedelta(minutes=1)).isoformat(),
        label_target=TARGET,label_membership_hash=row['membership_hash'],label_benchmark='SPY',
        label_basis={k:row[k] for k in BASIS},outcome_reference='test-outcome-'+str(i),
        feature_5d_return=(i%5)*.01,excess_return=(i%5)*.02+.03,calendar_snapshot=CALENDAR)
    return row


def model(horizon=5):
    return fit([sample(i,horizon) for i in range(25)],horizon,DAYS[50]['close'],namespace='synthetic',
               min_train_sessions=2,min_oos_sessions=2)


class ForecastResearchTests(unittest.TestCase):
    def archive_fixture(self, root, *, late=False, changed=False):
        def put(category,payload):
            directory=root/category;directory.mkdir(exist_ok=True)
            name=digest(payload)+'.jsonl'
            (directory/name).write_text(json.dumps(dict(payload=payload,record_id=digest(payload))))
            return category+'/'+name
        s=snapshot(5);sessions=window(CALENDAR,s['issued_at'],5)
        captured=(utc(s['issued_at'])+timedelta(minutes=10)).isoformat()
        known=(utc(sessions[0]['open'])+timedelta(minutes=1)).isoformat() if late else captured
        membership=[dict(theme_id=s['theme_id'],ticker=t,role='core') for t in s['members']]
        membership_hash=hashlib.sha256(json.dumps(membership,sort_keys=True,separators=(',',':')).encode()).hexdigest()
        metrics=dict(known_at=known,as_of=s['data_as_of'],membership_snapshot=membership,membership_hash=membership_hash,
            themes={s['theme_id']:dict(return_5d=dict(value=.02,as_of=s['data_as_of'],status='ok',coverage=1,
                                                    **{k:s[k] for k in BASIS}))})
        raw=json.dumps(metrics)
        put('display_observations',dict(kind='phase_a_observation',data_as_of=s['data_as_of'],known_at=known,
            raw_utf8=raw,source_hash=hashlib.sha256(raw.encode()).hexdigest(),metrics=metrics))
        ref=put('manifests',dict(captured_at=s['issued_at'],session=s['data_as_of']))
        put('evaluations',dict(evaluation_id='eval',observation_manifest=ref,anchor_at=s['issued_at'],
            horizon=5,theme_id=s['theme_id'],members=['XXX'] if changed else s['members'],benchmark='SPY',sessions=sessions))
        put('outcomes',dict(kind='observation_outcome',evaluation_id='eval',outcome_version=1,
            scored_at=(utc(sessions[-1]['close'])+timedelta(minutes=1)).isoformat(),excess_return=.02,
            **{k:s[k] for k in BASIS}))
        return captured

    def test_archive_adapter_anchors_at_actual_sidecar_availability(self):
        with tempfile.TemporaryDirectory() as d:
            captured=self.archive_fixture(Path(d))
            data=dataset(Path(d),CALENDAR)
            self.assertEqual(data['unresolved'],[])
            self.assertEqual(len(data['samples']),1)
            self.assertEqual(data['samples'][0]['issued_at'],captured)
            self.assertEqual(data['predictions_created'],0)

    def test_archive_late_features_or_changed_core_never_backfilled(self):
        for kwargs in (dict(late=True),dict(changed=True)):
            with tempfile.TemporaryDirectory() as d:
                self.archive_fixture(Path(d),**kwargs)
                data=dataset(Path(d),CALENDAR)
                self.assertEqual(len(data['samples']),0)
                self.assertEqual(len(data['unresolved']),1)

    def test_actual_empty_history_abstains_all_horizons(self):
        for horizon in (5,20,60):
            m=fit([],horizon,DAYS[2]['close'])
            self.assertEqual(m['status'],'insufficient')
            s=snapshot(3);s['namespace']='shadow'
            p=predict(m,s,CALENDAR)
            self.assertIsNone(p['prediction'])
            self.assertEqual(decision(p,holding=True)['code'],'insufficient')
            self.assertFalse(m['production_signals'])

    def test_walk_forward_excludes_future_labels_all_themes(self):
        rows=[sample(i) for i in range(25)]
        original=walk_forward(rows,min_train_sessions=2)
        cutoff=original[0]['issued_at']
        changed=copy.deepcopy(rows)
        for row in changed:
            if utc(row['outcome_known_at'])>=utc(cutoff):row['excess_return']=999
        again=walk_forward(changed,min_train_sessions=2)
        self.assertEqual(original[0]['prediction'],again[0]['prediction'])
        self.assertEqual(original[0]['train_hash'],again[0]['train_hash'])
        self.assertNotEqual(original[-1]['prediction'],again[-1]['prediction'])

    def test_training_session_floor_counts_dates_not_themes(self):
        rows=[]
        for n in range(100):
            row=sample(0);row['theme_id']=str(n);rows.append(row)
        m=fit(rows,5,DAYS[40]['close'],namespace='synthetic',min_train_sessions=2,min_oos_sessions=2)
        self.assertEqual(m['train_sessions'],1)
        self.assertEqual(m['status'],'insufficient')

    def test_shadow_cannot_lower_floors(self):
        with self.assertRaisesRegex(ValueError,'shadow_history_floor'):
            fit([],5,DAYS[40]['close'],min_train_sessions=2,min_oos_sessions=2)

    def test_contract_rejects_missing_future_mixed_and_changed_members(self):
        for key,value in [('coverage',.9),('feature_5d_return',None),('label_membership_hash','changed'),
                          ('label_benchmark','QQQ'),('known_at',DAYS[90]['close']),
                          ('entry_at',DAYS[2]['open'])]:
            row=sample(0);row[key]=value
            with self.subTest(key=key),self.assertRaises(ValueError):prepare([row],5,'synthetic')
        with self.assertRaisesRegex(ValueError,'duplicate_sample'):prepare([sample(0),sample(0)],5,'synthetic')
        row=sample(1);row['data_source']='different';row['label_basis']['data_source']='different'
        with self.assertRaisesRegex(ValueError,'mixed_price_basis'):prepare([sample(0),row],5,'synthetic')

    def test_training_ignores_not_yet_available_outcome(self):
        rows=[sample(i) for i in range(25)]
        rows[-1]['outcome_known_at']=DAYS[90]['close']
        m=fit(rows,5,DAYS[40]['close'],namespace='synthetic',min_train_sessions=2,min_oos_sessions=2)
        self.assertEqual(len(m['sample_hashes']),24)

    def test_ols_and_oos_baseline_are_separate_from_probability(self):
        m=model()
        self.assertEqual(m['status'],'research_ready')
        self.assertAlmostEqual(m['coefficients']['slope'],2)
        self.assertTrue(m['metrics']['improves_mean_baseline'])
        p=predict(m,snapshot(51),CALENDAR)
        self.assertAlmostEqual(p['prediction']['expected_excess_return'],.05)
        self.assertIsNone(p['confidence']['probability'])
        self.assertIsNone(p['forward_score'])
        self.assertIsNone(p['stall_risk'])

    def test_input_and_model_quality_abstention(self):
        m=model();s=snapshot(51);s['feature_5d_return']=100
        self.assertEqual(predict(m,s,CALENDAR)['status'],'unresolved')
        s=snapshot(51);s['data_source']='new_provider'
        self.assertEqual(predict(m,s,CALENDAR)['reasons'],['price_basis_changed'])
        s=snapshot(51);s['data_as_of']=DAYS[50]['date']
        with self.assertRaisesRegex(ValueError,'stale_input'):predict(m,s,CALENDAR)
        m['coefficients']['slope']=999
        with self.assertRaisesRegex(ValueError,'record_hash_mismatch'):predict(m,snapshot(51),CALENDAR)

    def test_paper_decisions_distinguish_holder_and_nonholder(self):
        p=predict(model(),snapshot(51),CALENDAR)
        self.assertEqual(decision(p,holding=True,round_trip_cost=.001)['code'],'hold_candidate')
        self.assertEqual(decision(p,holding=False,round_trip_cost=.001)['code'],'buy_candidate')
        self.assertEqual(decision(p,holding=False)['code'],'insufficient')
        altered={k:v for k,v in p.items() if k!='record_hash'}
        altered['prediction']=dict(lower=-.1,upper=-.05)
        negative=sealed(altered)
        self.assertEqual(decision(negative,holding=True,round_trip_cost=.001)['code'],'reduce_candidate')
        self.assertEqual(decision(negative,holding=False,round_trip_cost=.001)['code'],'avoid_candidate')
        self.assertFalse(decision(p,holding=True,round_trip_cost=.001)['order_execution'])

    def test_runtime_clock_idempotence_and_append_only(self):
        with tempfile.TemporaryDirectory() as d:
            store=Store(Path(d)/'test.db',namespace='synthetic',clock=lambda:DAYS[51]['close'])
            m=model();register_model(store,m)
            s=snapshot(51);s['issued_at']=DAYS[0]['close']
            p=issue(store,'r1',m['record_hash'],s,CALENDAR)
            self.assertEqual(p['issued_at'],DAYS[51]['close'])
            self.assertEqual(issue(store,'r1',m['record_hash'],s,CALENDAR),p)
            s['feature_5d_return']=.02
            with self.assertRaisesRegex(ValueError,'request_conflict'):issue(store,'r1',m['record_hash'],s,CALENDAR)
            self.assertEqual(len(store.records('research_prediction')),1)
            self.assertEqual(len(store.records('prediction')),0)
            store.audit();store.close()

    def test_score_missing_then_resolve_without_overwriting_prediction(self):
        with tempfile.TemporaryDirectory() as d:
            store=Store(Path(d)/'test.db',namespace='synthetic',clock=lambda:DAYS[51]['close'])
            m=model();register_model(store,m)
            p=issue(store,'r1',m['record_hash'],snapshot(51),CALENDAR)
            self.assertEqual(score(store,'r1',{})['status'],'pending')
            store.clock=lambda:DAYS[58]['close']
            self.assertEqual(score(store,'r1',{})['status'],'unresolved')
            prices={t:dict(**{k:p[k] for k in BASIS},currency='USD',retrieved_at=DAYS[58]['close'],source_hash=t,
                bars=[dict(session=s['date'],open=100,close=100 if t=='SPY' else 101) for s in p['sessions']])
                for t in ('AAA','BBB','SPY')}
            result=score(store,'r1',prices)
            self.assertEqual(result['status'],'scored')
            self.assertAlmostEqual(result['excess_return'],.01)
            self.assertFalse(result['dividend_adjusted'])
            self.assertEqual(score(store,'r1',{}),result)
            self.assertEqual(store.get('research_prediction','r1'),p)
            self.assertEqual([r['status'] for r in store.records('research_status')],['pending','unresolved','scored'])
            store.audit();store.close()

    def test_archive_empty_and_bad_hash(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d)
            self.assertEqual(dataset(root,CALENDAR)['status'],'insufficient_matured_history')
            (root/'outcomes').mkdir()
            (root/'outcomes'/'bad.jsonl').write_text(json.dumps(dict(payload={},record_id='bad')))
            with self.assertRaisesRegex(ValueError,'archive_hash_mismatch'):dataset(root,CALENDAR)


if __name__=='__main__':unittest.main()

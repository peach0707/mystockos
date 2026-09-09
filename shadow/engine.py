"""Prediction / outcome contracts and offline batch scoring. No training or promotion."""
import math
from .store import Store, digest, require, utc
from .calendar import window

HORIZONS = (5, 20, 60)
TARGET = 'total_return_excess_v1'
MARKETS = {'XNYS', 'XNAS', 'ARCX', 'XASE', 'BATS'}


def number(value):
    return type(value) in (int, float) and math.isfinite(value)


def text(value):
    return isinstance(value, str) and bool(value.strip())


class Engine:
    def __init__(self, store: Store):
        self.store = store

    def register(self, kind, version, specification):
        require(kind in ('model', 'factor'), 'only model / factor registries allowed')
        require(text(version), 'empty version')
        require(specification.get('stage') == 'experimental', 'Champion registration/promotion forbidden')
        require(specification.get('namespace') == self.store.namespace, 'registry namespace mismatch')
        require(text(specification.get('code_hash')) and text(specification.get('description')), 'registry provenance required')
        if kind == 'factor':
            require(isinstance(specification.get('required_inputs'),list) and specification['required_inputs'] and all(text(x) for x in specification['required_inputs']), 'factor input contract required')
        if kind == 'model':
            require(specification.get('target') == TARGET, 'target mismatch')
            self.store.get('factor',specification.get('factor_version'))
        with self.store.transaction():
            prior = [r for r in self.store.records(kind) if r['version'] == version]
            if prior:
                require(prior[0]['specification'] == specification, 'version is immutable')
                return version
            self.store.append(kind, version, {'version':version, 'registered_at':self.store.clock(), 'specification':specification})
        return version

    def issue(self, *, request_id, theme_id, horizon, model_version, factor_version,
              input_manifest, prediction, confidence, reasons, cost_model,
              code_commit, definition_name='definition', calendar_name='calendar'):
        """Admit an actual experimental estimate supplied by a model producer.

        There is intentionally no default estimate or Forward Score. issued_at is
        receipt time; importing an old estimate today cannot backdate its entry.
        A request ID retries exactly the same immutable submission.
        """
        require(text(request_id) and text(theme_id) and text(code_commit), 'identity/provenance required')
        require(type(horizon) is int and horizon in HORIZONS, 'unsupported horizon')
        require(isinstance(prediction, dict) and set(prediction) == {'expected_excess_return'} and number(prediction['expected_excess_return']), 'finite expected excess return required; no fabricated score')
        require(isinstance(confidence, dict) and set(confidence) == {'kind','value','evidence'} and confidence['kind'] in ('unvalidated','validated') and text(confidence['evidence']), 'confidence must be separate evidence')
        require(confidence['kind'] == 'unvalidated' and confidence['value'] is None, 'validated confidence is not supported before research review')
        require(isinstance(reasons,list) and reasons and all(text(x) for x in reasons), 'reasons required')
        require(set(cost_model) == {'version','theme_roundtrip_rate','benchmark_roundtrip_rate','assumption'}, 'cost model contract required')
        require(text(cost_model['version']) and text(cost_model['assumption']), 'cost provenance required')
        for k in ('theme_roundtrip_rate','benchmark_roundtrip_rate'):
            require(number(cost_model[k]) and 0 <= cost_model[k] < 1, 'invalid cost rate')
        submission = dict(theme_id=theme_id,horizon=horizon,model_version=model_version,factor_version=factor_version,input_manifest=input_manifest,prediction=prediction,confidence=confidence,reasons=reasons,cost_model=cost_model,code_commit=code_commit,definition_name=definition_name,calendar_name=calendar_name)
        identifier = digest({'namespace':self.store.namespace,'request_id':request_id})
        with self.store.transaction():
            previous = [p for p in self.store.records('prediction') if p['prediction_id']==identifier]
            if previous:
                require(previous[0]['submission'] == submission, 'prediction request ID conflict')
                return identifier
            issued_at = self.store.clock()
            for kind,version in (('model',model_version),('factor',factor_version)):
                record = self.store.get(kind,version)
                require(utc(record['registered_at']) <= utc(issued_at), 'future registered version')
            require(self.store.get('model',model_version)['specification']['factor_version']==factor_version, 'model/factor version mismatch')
            for name in self.store.get('factor',factor_version)['specification']['required_inputs']:
                self.store.input(input_manifest,name,cutoff=issued_at)
            definition = self.store.input(input_manifest,definition_name,cutoff=issued_at)
            require(definition['theme_id']==theme_id and text(definition['definition_version']), 'definition identity mismatch')
            require(utc(definition['known_at']) <= utc(issued_at), 'future definition knowledge')
            require(definition['valid_from'] <= issued_at[:10] and (not definition.get('valid_to') or issued_at[:10] < definition['valid_to']), 'definition not effective at issuance')
            require(definition.get('namespace')==self.store.namespace, 'definition namespace mismatch')
            members=definition['core']
            require(isinstance(members,list) and members, 'Core missing; no silent empty basket')
            for member in members + [definition['benchmark']]:
                require(all(text(member.get(k)) for k in ('entity_id','ticker','exchange','currency')), 'unresolved security identity')
                require(member['exchange'] in MARKETS and member['currency']=='USD', 'unsupported market/currency: requires separate calendar/FX contract')
            require(len({x['entity_id'] for x in members})==len(members), 'duplicate Core')
            calendar = self.store.input(input_manifest,calendar_name,cutoff=issued_at)
            sessions = window(calendar,issued_at,horizon)
            payload = dict(prediction_id=identifier,request_id=request_id,namespace=self.store.namespace,issued_at=issued_at,submission=submission,theme_id=theme_id,horizon=horizon,model_version=model_version,factor_version=factor_version,input_manifest=input_manifest,input_manifest_hash=digest(self.store.get('observation',input_manifest)),definition=definition,calendar_version=calendar['version'],sessions=sessions,entry_rule='first_session_open_strictly_after_issue',target_definition=TARGET,weights={m['entity_id']:1/len(members) for m in members},prediction=prediction,confidence=confidence,reasons=reasons,cost_model=cost_model,code_commit=code_commit)
            self.store.append('prediction',identifier,payload)
            event={'prediction_id':identifier,'status':'pending','at':issued_at,'reason':'awaiting_maturity','outcome_id':None}
            self.store.append('status',digest(event),event)
        return identifier

    def status(self, identifier):
        self.store.get('prediction',identifier)
        events=[e for e in self.store.records('status') if e['prediction_id']==identifier]
        require(bool(events),'prediction has no committed status')
        return events[-1]['status']

    def score_due(self, price_manifest=None, *, correction_reason=None):
        """Every mature pending/unresolved record is revisited; failures stay explicit.

        Default runs never revise scored records. A correction requires a reason
        and a new evidence manifest, and appends a new outcome version.
        """
        report={'pending':0,'scored':0,'unresolved':0,'unchanged':0}
        scored_at=self.store.clock()
        for prediction in self.store.records('prediction'):
            if utc(prediction['sessions'][-1]['close']) > utc(scored_at):
                report['pending']+=1
                continue
            with self.store.transaction():
                identifier=prediction['prediction_id']
                state=self.status(identifier)
                if state=='scored' and not correction_reason:
                    report['unchanged']+=1
                    continue
                prior=[o for o in self.store.records('outcome') if o['prediction_id']==identifier]
                # Same evidence is idempotent; corrected prices must be a new captured revision.
                if any(o['outcome_input_manifest']==price_manifest for o in prior):
                    report['unchanged']+=1
                    continue
                try:
                    require(digest(self.store.get('observation',prediction['input_manifest']))==prediction['input_manifest_hash'],'input manifest checksum mismatch')
                    require(price_manifest is not None,'missing_price_manifest')
                    prices=self.store.input(price_manifest,'prices',cutoff=scored_at)
                    metrics=self._returns(prediction,prices,scored_at)
                except (KeyError,ValueError,TypeError,IndexError) as error:
                    event={'prediction_id':identifier,'status':'unresolved','at':scored_at,'reason':str(error),'outcome_id':None,'evidence':price_manifest}
                    # Failed corrections do not discard a previously valid score.
                    if state=='scored':
                        self.store.append('scoring_error',digest(event),event)
                    else:
                        failures=[e for e in self.store.records('status') if e['prediction_id']==identifier]
                        last=failures[-1]
                        if last.get('evidence')!=price_manifest or last['reason']!=str(error):
                            event['attempt']=1+sum(e['status']=='unresolved' for e in failures)
                            self.store.append('status',digest(event),event)
                    report['unresolved']+=1
                    continue
                version=len(prior)+1
                outcome={'prediction_id':identifier,'horizon':prediction['horizon'],'outcome_version':version,'scored_at':scored_at,'outcome_input_manifest':price_manifest,'entry_session':prediction['sessions'][0],'exit_session':prediction['sessions'][-1],'calendar_version':prediction['calendar_version'],'target_definition':TARGET,'correction_reason':correction_reason if prior else None,'result_quality':'verified_total_return_contract','namespace':self.store.namespace,**metrics}
                outcome_id=digest(outcome)
                self.store.append('outcome',outcome_id,outcome)
                event={'prediction_id':identifier,'status':'scored','at':scored_at,'reason':'outcome_committed','outcome_id':outcome_id,'outcome_version':version}
                self.store.append('status',digest(event),event)
                report['scored']+=1
        return report

    def _returns(self,prediction,prices,scored_at):
        require(prices['namespace']==self.store.namespace,'price namespace mismatch')
        require(prices['basis']=='total_return' and prices['corporate_actions_complete'] is True,'total-return adjustment evidence missing')
        require(text(prices['adjustment_version']) and text(prices['source']),'price provenance missing')
        series=prices['series']
        require(isinstance(series,list),'price series required')
        identities=[(x['entity_id'],x['exchange'],x['currency']) for x in series]
        require(len(identities)==len(set(identities)),'duplicate price identity')
        sessions=prediction['sessions']
        paths={}
        members=prediction['definition']['core']
        benchmark=prediction['definition']['benchmark']
        for instrument in members + [benchmark]:
            key=(instrument['entity_id'],instrument['exchange'],instrument['currency'])
            matching=[s for s in series if (s['entity_id'],s['exchange'],s['currency'])==key]
            require(len(matching)==1,f'missing security: {instrument["entity_id"]}')
            s=matching[0]
            require(s['ticker']==instrument['ticker'] and s['adjustment_version']==prices['adjustment_version'],'price identity/adjustment mismatch')
            require(s['quality']=='verified','unverified corporate action or delisting settlement')
            bars=s['bars']
            require(len({b['session'] for b in bars})==len(bars),'duplicate price session')
            by_date={b['session']:b for b in bars}
            selected=[]
            for session in sessions:
                require(session['date'] in by_date,f'missing session: {instrument["entity_id"]} {session["date"]}')
                bar=by_date[session['date']]
                require(utc(session['close'])<=utc(bar['available_at'])<=utc(scored_at),'outcome availability outside valid interval')
                require(number(bar['close']) and bar['close']>=0,'invalid adjusted close')
                require(bar['quality']=='verified','unresolved bar or corporate action')
                selected.append(bar)
            entry=selected[0]
            require(entry['tradable_open'] is True and number(entry['open']) and entry['open']>0,'entry not executable')
            paths[key]=[b['close']/entry['open']-1 for b in selected]
        theme=[sum(paths[(m['entity_id'],m['exchange'],m['currency'])][i]*prediction['weights'][m['entity_id']] for m in members) for i in range(len(sessions))]
        bench=paths[(benchmark['entity_id'],benchmark['exchange'],benchmark['currency'])]
        require(all(number(x) for x in theme+bench),'non-finite return')
        excess=theme[-1]-bench[-1]
        costs=prediction['cost_model']
        return {'theme_return':theme[-1],'benchmark_return':bench[-1],'excess_return':excess,'cost_adjusted_return':theme[-1]-costs['theme_roundtrip_rate'],'cost_adjusted_excess_return':excess-costs['theme_roundtrip_rate']+costs['benchmark_roundtrip_rate'],'max_favorable_movement':max([0]+theme),'max_adverse_movement':min([0]+theme),'movement_basis':'session_close_from_entry_open','direction_correct':None if prediction['prediction']['expected_excess_return']==0 else (prediction['prediction']['expected_excess_return']>0)==(excess>0),'cost_model':costs}

    def report(self):
        self.store.audit()
        for p in self.store.records('prediction'):
            require(digest(self.store.get('observation',p['input_manifest']))==p['input_manifest_hash'],'prediction input reference mismatch')
            self.store.get('model',p['model_version']);self.store.get('factor',p['factor_version'])
        for outcome in self.store.records('outcome'):
            self.store.get('prediction',outcome['prediction_id']);self.store.get('observation',outcome['outcome_input_manifest'])
        for status in self.store.records('status'):
            self.store.get('prediction',status['prediction_id'])
            if status['outcome_id']:self.store.get('outcome',status['outcome_id'])
        rows=[{'prediction_id':p['prediction_id'],'theme_id':p['theme_id'],'horizon':p['horizon'],'model_version':p['model_version'],'factor_version':p['factor_version'],'status':self.status(p['prediction_id']),'due':p['sessions'][-1]['close']} for p in self.store.records('prediction')]
        starts=self.store.records('run_started')
        finishes=self.store.records('run_finished')
        finished_ids={r['run_id'] for r in finishes}
        operations={'completed':len(finishes),'unfinished_run_ids':[r['run_id'] for r in starts if r['run_id'] not in finished_ids],'last_result':finishes[-1] if finishes else None}
        return {'namespace':self.store.namespace,'observations':len(self.store.records('observation')),'predictions':rows,'counts':{k:sum(r['status']==k for r in rows) for k in ('pending','scored','unresolved')},'operations':operations,'champion':None,'production_signals':False}

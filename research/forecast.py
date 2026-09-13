"""Auditable price-excess-return baseline and paper decisions, standard library only.

Training is an explicit offline operation. No live model mutation, promotion,
orders, probability claims, or updates to the existing Shadow ledger schema.
Returns are decimals; one candidate explanatory variable is the observed 5d
theme price return. It is NOT registered as an official Forward factor.
"""
from datetime import date
import math
from statistics import mean, linear_regression
from shadow.calendar import window
from shadow.store import digest, require, utc

TARGET = 'theme_price_excess_next_open_v1'
FACTOR = 'research_theme_return_5d_v1'
HORIZONS = (5, 20, 60)
BASIS = ('data_source', 'adjustment_type', 'split_adjusted',
         'dividend_adjusted', 'price_basis')
LABELS = {'insufficient': '判定保留', 'buy_candidate': '新規買い候補（検証用）',
          'hold_candidate': '保有継続候補（検証用）', 'reduce_candidate': '縮小候補（検証用）',
          'avoid_candidate': '見送り候補（検証用）', 'wait': '判断待ち（検証用）'}


def finite(x):
    return type(x) in (int, float) and math.isfinite(x)


def sealed(value):
    return dict(value, record_hash=digest(value))


def verify(value):
    require(value.get('record_hash') == digest({k:v for k,v in value.items() if k != 'record_hash'}),
            'record_hash_mismatch')


def validate_input(row):
    require(row.get('namespace') in ('shadow', 'synthetic'), 'namespace_required')
    require(row.get('factor_version') == FACTOR, 'factor_version_mismatch')
    for name in ('input_manifest', 'membership_hash', 'source_hash', 'theme_id', 'benchmark'):
        require(isinstance(row.get(name), str) and row[name], 'missing_' + name)
    require(utc(row['known_at']) <= utc(row['issued_at']), 'future_input')
    require(date.fromisoformat(row['data_as_of']) <= utc(row['known_at']).date(), 'future_as_of')
    require(row.get('coverage') == 1 and row.get('status') == 'ok', 'incomplete_input')
    require(finite(row.get('feature_5d_return')), 'missing_feature')
    require(isinstance(row.get('members'), list) and bool(row['members'])
            and all(isinstance(t, str) and t for t in row['members'])
            and len(set(row['members'])) == len(row['members']), 'invalid_core_members')
    require(row.get('price_basis') == 'price_return', 'price_basis_mismatch')
    for name in ('data_source', 'adjustment_type'):
        require(isinstance(row.get(name), str) and row[name], 'missing_' + name)
    require(type(row.get('split_adjusted')) is bool and type(row.get('dividend_adjusted')) is bool,
            'adjustment_flags_required')


def validate_sample(row):
    validate_input(row)
    require(type(row.get('horizon')) is int and row['horizon'] in HORIZONS, 'invalid_horizon')
    require(utc(row['issued_at']) < utc(row['entry_at']) < utc(row['exit_at']) <= utc(row['outcome_known_at']),
            'invalid_label_time')
    require(row.get('label_target') == TARGET, 'target_mismatch')
    require(row.get('label_membership_hash') == row['membership_hash'], 'membership_changed')
    require(row.get('label_benchmark') == row['benchmark'], 'benchmark_changed')
    require(row.get('label_basis') == {k:row[k] for k in BASIS}, 'label_basis_mismatch')
    require(row.get('outcome_reference') and finite(row.get('excess_return')), 'missing_outcome')
    require(row.get('entry_session') == row['entry_at'][:10], 'entry_session_mismatch')
    sessions = window(row['calendar_snapshot'], row['issued_at'], row['horizon'])
    require(row['entry_at'] == sessions[0]['open'] and row['exit_at'] == sessions[-1]['close'],
            'label_session_window_mismatch')


def prepare(rows, horizon, namespace):
    result = []
    identities = set()
    basis = None
    for row in rows:
        validate_sample(row)
        require(row['namespace'] == namespace, 'namespace_mismatch')
        if row['horizon'] != horizon:
            continue
        identity = (row['theme_id'], row['input_manifest'], horizon)
        require(identity not in identities, 'duplicate_sample')
        identities.add(identity)
        current = tuple(row[k] for k in BASIS)
        require(basis is None or basis == current, 'mixed_price_basis')
        basis = current
        result.append(row)
    return sorted(result, key=lambda r:(utc(r['issued_at']), r['theme_id'], r['input_manifest']))


def fit_coefficients(rows):
    x = [r['feature_5d_return'] for r in rows]
    y = [r['excess_return'] for r in rows]
    # Constant inputs fall back to the training-only mean baseline.
    slope, intercept = linear_regression(x, y) if len(set(x)) > 1 else (0., mean(y))
    require(finite(slope) and finite(intercept), 'unstable_fit')
    return dict(slope=slope, intercept=intercept, baseline=mean(y))


def estimate(coefficients, row):
    value = coefficients['intercept'] + coefficients['slope'] * row['feature_5d_return']
    require(finite(value), 'nonfinite_prediction')
    return value


def walk_forward(rows, *, min_train_sessions=120):
    """Prequential OOS, with all themes at one issue time withheld together.

    Label exit AND availability must precede issuance; overlapping future labels
    are purged. We never split rows randomly or tune on the resulting OOS set.
    Distinct entry sessions, rather than correlated theme rows, count as history.
    """
    require(type(min_train_sessions) is int and min_train_sessions >= 2, 'invalid_training_floor')
    predictions = []
    for issued_at in sorted({r['issued_at'] for r in rows}, key=utc):
        train = [r for r in rows if utc(r['exit_at']) < utc(issued_at)
                 and utc(r['outcome_known_at']) < utc(issued_at)]
        if len({r['entry_session'] for r in train}) < min_train_sessions:
            continue
        coefficients = fit_coefficients(train)
        for row in (r for r in rows if r['issued_at'] == issued_at):
            prediction = estimate(coefficients, row)
            predictions.append(dict(sample_hash=digest(row), issued_at=issued_at,
                entry_session=row['entry_session'], theme_id=row['theme_id'],
                actual=row['excess_return'], prediction=prediction, baseline=coefficients['baseline'],
                residual=row['excess_return']-prediction, train_hash=digest(train)))
    return predictions


def fit(rows, horizon, trained_at, *, namespace='shadow', min_train_sessions=120, min_oos_sessions=60):
    require(type(horizon) is int and horizon in HORIZONS, 'invalid_horizon')
    require(type(min_oos_sessions) is int and min_oos_sessions >= 2, 'invalid_oos_floor')
    # Production research floors cannot be lowered by callers. Synthetic tests may use small fixtures.
    require(namespace == 'synthetic' or (min_train_sessions >= 120 and min_oos_sessions >= 60),
            'shadow_history_floor')
    prepared = prepare(rows, horizon, namespace)
    train = [r for r in prepared if utc(r['outcome_known_at']) < utc(trained_at)]
    sessions = len({r['entry_session'] for r in train})
    base = dict(schema_version=1, namespace=namespace, target=TARGET, factor_version=FACTOR,
        algorithm='ols_single_momentum_baseline_v1', horizon=horizon, trained_at=trained_at,
        training_hash=digest(train), sample_hashes=[digest(r) for r in train],
        train_sessions=sessions, min_train_sessions=min_train_sessions, min_oos_sessions=min_oos_sessions,
        stage='research', champion=False, production_signals=False, forward_score=None, stall_risk=None)
    if sessions < min_train_sessions:
        return sealed(dict(base, status='insufficient', reason='insufficient_matured_history', oos=[]))
    oos = walk_forward(train, min_train_sessions=min_train_sessions)
    n = len({r['entry_session'] for r in oos})
    mae = mean(abs(r['residual']) for r in oos) if oos else None
    baseline_mae = mean(abs(r['actual']-r['baseline']) for r in oos) if oos else None
    status = 'research_ready' if n >= min_oos_sessions else 'insufficient'
    return sealed(dict(base, status=status, reason='human_review_required' if status == 'research_ready'
        else 'insufficient_oos_history', coefficients=fit_coefficients(train),
        feature_range=[min(r['feature_5d_return'] for r in train), max(r['feature_5d_return'] for r in train)],
        basis={k:train[0][k] for k in BASIS}, oos=oos, oos_sessions=n,
        metrics=dict(mae=mae, baseline_mae=baseline_mae,
                     improves_mean_baseline=mae is not None and mae < baseline_mae)))


def predict(model, snapshot, calendar):
    """A real, timestamped research prediction or an explicit abstention.

    Residual quantiles are empirical OOS error bands, NOT calibrated probability
    intervals. They do not imply a win rate or production readiness.
    """
    verify(model)
    validate_input(snapshot)
    require(snapshot['namespace'] == model['namespace'], 'namespace_mismatch')
    require(utc(model['trained_at']) <= utc(snapshot['issued_at']), 'future_model')
    sessions = window(calendar, snapshot['issued_at'], model['horizon'])
    past = [s for s in calendar['sessions'] if utc(s['close']) <= utc(snapshot['issued_at'])]
    require(past and snapshot['data_as_of'] == past[-1]['date'], 'stale_input')
    base = dict(schema_version=1, namespace=model['namespace'], model_version=model['record_hash'],
        factor_version=FACTOR, target=TARGET, horizon=model['horizon'],
        issued_at=snapshot['issued_at'], theme_id=snapshot['theme_id'],
        input_manifest=snapshot['input_manifest'], input_snapshot=snapshot,
        input_hash=digest(snapshot), membership_hash=snapshot['membership_hash'],
        benchmark=snapshot['benchmark'], entry_at=sessions[0]['open'], exit_at=sessions[-1]['close'],
        calendar_hash=digest(calendar), sessions=sessions, forward_score=None, stall_risk=None,
        confidence=dict(kind='unvalidated', probability=None), production_signals=False,
        **{k:snapshot[k] for k in BASIS})
    reason = None
    if model['status'] != 'research_ready': reason = model['reason']
    elif model['basis'] != {k:snapshot[k] for k in BASIS}: reason = 'price_basis_changed'
    elif not model['feature_range'][0] <= snapshot['feature_5d_return'] <= model['feature_range'][1]:
        reason = 'outside_training_range'
    if reason:
        return sealed(dict(base, kind='forecast_abstention', status='unresolved', prediction=None, reasons=[reason]))
    value = estimate(model['coefficients'], snapshot)
    errors = sorted(r['residual'] for r in model['oos'])
    lower, upper = errors[int((len(errors)-1)*.1)], errors[int((len(errors)-1)*.9)]
    return sealed(dict(base, kind='research_prediction', status='pending',
        prediction=dict(expected_excess_return=value, lower=value+lower, upper=value+upper,
                        band_kind='empirical_oos_residual_10_90_not_calibrated'),
        reasons=['research_momentum_baseline', 'not_a_calibrated_probability']))


def decision(prediction, *, holding, round_trip_cost=None):
    """Paper decision kept separate from the user's manual enum and portfolio.

    Cost is an explicit incremental theme-minus-benchmark assumption in decimal.
    No subjective price/volume score weights or unverified win-rate thresholds.
    """
    verify(prediction)
    require(type(holding) is bool, 'holding_context_required')
    code, reason = 'insufficient', 'forecast_unavailable'
    if prediction['kind'] == 'research_prediction':
        if not finite(round_trip_cost) or round_trip_cost < 0:
            reason = 'cost_assumption_required'
        else:
            p = prediction['prediction']
            if p['lower'] > round_trip_cost:
                code = 'hold_candidate' if holding else 'buy_candidate'
            elif p['upper'] < -round_trip_cost:
                code = 'reduce_candidate' if holding else 'avoid_candidate'
            else:
                code = 'wait'
            reason = 'experimental_oos_band_relative_to_cost_not_production_policy'
    return sealed(dict(kind='research_decision', policy_version='paper_cost_band_v1',
        prediction_hash=prediction['record_hash'], holding=holding, code=code, label=LABELS[code],
        round_trip_cost=round_trip_cost, reason=reason, production_signals=False,
        confidence='未検証', order_execution=False))


def register_model(store, model):
    """Explicit registration, no current-model pointer or automatic promotion."""
    verify(model)
    require(model['namespace'] == store.namespace, 'namespace_mismatch')
    require(utc(model['trained_at']) <= utc(store.clock()), 'future_model')
    store.append('research_model', model['record_hash'], model)


def issue(store, request_id, model_hash, snapshot, calendar):
    """Runtime issuance owns the timestamp. A caller cannot backdate a forecast."""
    submitted = {k:v for k,v in snapshot.items() if k != 'issued_at'}
    fingerprint = digest(dict(model=model_hash, snapshot=submitted, calendar=calendar))
    previous = [r for r in store.records('research_request') if r['request_id'] == request_id]
    if previous:
        require(previous[0]['fingerprint'] == fingerprint, 'request_conflict')
        return store.get(previous[0]['kind'], request_id)
    model = store.get('research_model', model_hash)
    result = predict(model, dict(submitted, issued_at=store.clock()), calendar)
    with store.transaction():
        store.append(result['kind'], request_id, result)
        store.append('research_request', request_id, dict(request_id=request_id, fingerprint=fingerprint,
                                                        kind=result['kind']))
        if result['kind'] == 'research_prediction':
            store.append('research_status', digest([request_id, 'pending']),
                         dict(request_id=request_id, status='pending', recorded_at=result['issued_at']))
    return result


def score(store, request_id, prices):
    """Price-return outcome using the pinned Core set and next-session entry.

    Input: ticker -> provider metadata, retrieved_at, source_hash, USD bars.
    Full horizon coverage is mandatory; no zero fill or missing-member reweight.
    Corrections require a new explicit outcome version (not implemented here).
    """
    existing = [r for r in store.records('research_outcome') if r['request_id'] == request_id]
    if existing:
        return existing[0]
    prediction = store.get('research_prediction', request_id)
    verify(prediction)
    scored_at = store.clock()
    if utc(scored_at) < utc(prediction['exit_at']):
        return dict(status='pending', request_id=request_id)
    try:
        sessions = prediction['sessions']
        members = prediction['input_snapshot']['members']
        benchmark = prediction['benchmark']
        wanted = set(members) | {benchmark}
        require(wanted <= set(prices), 'missing_instrument')
        paths, references = {}, {}
        for ticker in sorted(wanted):
            price = prices[ticker]
            require(all(price.get(k) == prediction[k] for k in BASIS), 'price_basis_changed')
            require(price.get('currency') == 'USD', 'currency_mismatch')
            require(utc(prediction['exit_at']) <= utc(price['retrieved_at']) <= utc(scored_at), 'price_vintage_unavailable')
            require(price.get('source_hash'), 'missing_price_source_hash')
            bars = price['bars']
            by_day = {b['session']:b for b in bars}
            require(len(by_day) == len(bars), 'duplicate_price_bar')
            require(all(s['date'] in by_day for s in sessions), 'missing_session')
            entry = by_day[sessions[0]['date']]['open']
            require(finite(entry) and entry > 0, 'invalid_entry')
            closes = [by_day[s['date']]['close'] for s in sessions]
            require(all(finite(c) and c >= 0 for c in closes), 'invalid_close')
            paths[ticker] = [c/entry-1 for c in closes]
            references[ticker] = dict(source_hash=price['source_hash'], retrieved_at=price['retrieved_at'],
                                      normalized_hash=digest(price))
        path = [mean(paths[t][i] for t in members) for i in range(len(sessions))]
        excess = path[-1]-paths[benchmark][-1]
        outcome = sealed(dict(kind='research_outcome', request_id=request_id, outcome_version=1,
            prediction_hash=prediction['record_hash'], model_version=prediction['model_version'],
            factor_version=FACTOR, namespace=store.namespace, target=TARGET, horizon=prediction['horizon'],
            scored_at=scored_at, status='scored', theme_return=path[-1], benchmark_return=paths[benchmark][-1],
            excess_return=excess, cost_adjusted_return=None, cost_status='not_estimated',
            max_favorable_movement=max([0.]+path), max_adverse_movement=min([0.]+path),
            movement_basis='session_close_relative_to_entry_open',
            prediction_error=excess-prediction['prediction']['expected_excess_return'],
            direction_correct=None if prediction['prediction']['expected_excess_return']==0
                else excess*prediction['prediction']['expected_excess_return']>0,
            direction_target=TARGET,
            price_references=references, result_quality='provider_basis_not_independently_reconciled',
            **{k:prediction[k] for k in BASIS}))
        with store.transaction():
            store.append('research_outcome', request_id, outcome)
            state = dict(request_id=request_id, status='scored', recorded_at=scored_at,
                         outcome_hash=outcome['record_hash'])
            store.append('research_status', digest(state), state)
        return outcome
    except (ValueError, KeyError, TypeError) as error:
        state = dict(request_id=request_id, status='unresolved', recorded_at=scored_at,
                     reason=type(error).__name__+': '+str(error))
        store.append('research_status', digest(state), state)
        return state

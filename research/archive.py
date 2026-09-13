"""Read-only adapter for the private append-only observation archive.

No retroactive current-membership rebuilds. An outcome is a training label,
not evidence that a forecast was actually issued in the past.
"""
import hashlib
import json
from pathlib import Path
from shadow.calendar import window
from shadow.store import digest, require, utc
from .forecast import BASIS, FACTOR, TARGET, validate_sample


def records(root, category):
    result = []
    for path in sorted((Path(root)/category).rglob('*.jsonl')):
        for line in path.read_text().splitlines():
            record = json.loads(line)
            payload = record['payload']
            require(record['record_id'] == digest(payload), 'archive_hash_mismatch')
            result.append((str(path.relative_to(root)), payload))
    return result


def dataset(root, calendar):
    observations = records(root, 'display_observations')
    evaluations = {r['evaluation_id']: r for _,r in records(root, 'evaluations')}
    manifests = dict(records(root, 'manifests'))
    samples, unresolved = [], []
    seen = set()
    for ref, outcome in records(root, 'outcomes'):
        if outcome.get('kind') != 'observation_outcome':
            continue
        try:
            require(outcome.get('outcome_version') == 1, 'explicit_correction_selection_required')
            evaluation = evaluations[outcome['evaluation_id']]
            require(outcome['evaluation_id'] not in seen, 'duplicate_outcome')
            seen.add(outcome['evaluation_id'])
            manifest = manifests[evaluation['observation_manifest']]
            require(manifest['captured_at'] == evaluation['anchor_at'], 'anchor_mismatch')
            original_window = window(calendar, evaluation['anchor_at'], evaluation['horizon'])
            choices = [(path,r) for path,r in observations if r['data_as_of'] == manifest['session']
                       and utc(r['known_at']) < utc(original_window[0]['open'])]
            require(bool(choices), 'no_point_in_time_features')
            path, observed = max(choices, key=lambda pair:utc(pair[1]['known_at']))
            require(hashlib.sha256(observed['raw_utf8'].encode()).hexdigest() == observed['source_hash'],
                    'source_hash_mismatch')
            metrics = json.loads(observed['raw_utf8'])
            require(metrics == observed['metrics'], 'source_content_mismatch')
            require(utc(metrics['known_at']) <= utc(observed['known_at']), 'future_metric_source')
            membership = metrics['membership_snapshot']
            # Phase A hashes use the original ASCII-escaped JSON convention.
            membership_hash = hashlib.sha256(json.dumps(membership,sort_keys=True,separators=(',', ':')).encode()).hexdigest()
            require(membership_hash == metrics['membership_hash'], 'membership_hash_mismatch')
            core = sorted({m['ticker'] for m in membership if m['role']=='core' and m['theme_id']==evaluation['theme_id']})
            require(core == sorted(evaluation['members']), 'core_changed')
            metric = metrics['themes'][evaluation['theme_id']]['return_5d']
            require(metric['as_of'] == manifest['session'], 'as_of_mismatch')
            # The sidecar can arrive after the main observation but before the
            # same next open. Anchor training at actual combined availability,
            # never at the earlier time when these features were still unknown.
            known_at = max((evaluation['anchor_at'],observed['known_at']), key=utc)
            sessions = window(calendar, known_at, evaluation['horizon'])
            require([s['date'] for s in sessions] == [s['date'] for s in evaluation['sessions']], 'calendar_mismatch')
            row = dict(namespace='shadow', theme_id=evaluation['theme_id'], horizon=evaluation['horizon'],
                issued_at=known_at, known_at=known_at,
                data_as_of=manifest['session'], input_manifest=path, source_hash=observed['source_hash'],
                membership_hash=membership_hash, members=core, benchmark=evaluation['benchmark'],
                factor_version=FACTOR, feature_5d_return=metric['value'], coverage=metric['coverage'], status=metric['status'],
                entry_at=sessions[0]['open'], entry_session=sessions[0]['date'], exit_at=sessions[-1]['close'],
                calendar_snapshot=calendar, label_target=TARGET, label_membership_hash=membership_hash,
                label_benchmark=evaluation['benchmark'], label_basis={k:outcome.get(k) for k in BASIS},
                outcome_known_at=outcome['scored_at'], outcome_reference=ref, excess_return=outcome['excess_return'],
                **{k:metric.get(k) for k in BASIS})
            validate_sample(row)
            samples.append(row)
        except (ValueError, KeyError, TypeError) as error:
            unresolved.append(dict(reference=ref, reason=str(error)))
    return dict(samples=samples, unresolved=unresolved, observation_count=len(observations),
                evaluation_count=len(evaluations), predictions_created=0,
                status='ready_for_offline_training' if samples else 'insufficient_matured_history')

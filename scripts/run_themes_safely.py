"""Run frozen Theme System v1.0 in isolation; publish only non-degraded output.

No score calculation or imputation occurs here. A rejected candidate leaves both
tracked output files byte-for-byte unchanged. Git publishes the pair in one commit.
"""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
from datetime import date

ROOT = Path(__file__).resolve().parents[1]
OUTPUTS = ('themes.json', 'theme_history.jsonl')


def validate_candidate(before, after, history_before, history_after):
    if after.get('schema_version') != '1.0' or not after.get('themes'):
        raise ValueError('Invalid theme schema or empty candidate')
    date.fromisoformat(after['as_of'])
    old = {t['theme_id']: t for t in before['themes']}
    new = {t['theme_id']: t for t in after['themes']}
    if set(old) != set(new) or len(new) != len(after['themes']):
        raise ValueError('Theme membership changed; frozen configuration requires review')
    if after['as_of'] < before['as_of']:
        raise ValueError('Candidate as_of regressed')
    if after.get('profile_version') != before.get('profile_version'):
        raise ValueError('Profile version changed')
    for tid, current in new.items():
        prior = old[tid]
        for key in ('score_mode', 'definition_version', 'core_members', 'related_members', 'watch_members', 'benchmark'):
            if current.get(key) != prior.get(key):
                raise ValueError(f'{tid}: frozen definition changed: {key}')
        a, b = prior['data_quality'], current['data_quality']
        if set(b['missing_core_data']) - set(a['missing_core_data']):
            raise ValueError(f'{tid}: new Core data failure')
        if a['status'] != 'insufficient' and b['status'] == 'insufficient':
            raise ValueError(f'{tid}: newly insufficient')
        for key in ('strength_eligible_n', 'heat_eligible_n'):
            if b.get(key, 0) < a.get(key, 0):
                raise ValueError(f'{tid}: fewer eligible members ({key})')
        for key in ('strength', 'heat'):
            score = (current[key] or {}).get('score')
            if (prior[key] or {}).get('score') is not None and score is None:
                raise ValueError(f'{tid}: lost {key} score')
            if score is not None and (isinstance(score, bool) or not isinstance(score, (int, float)) or not 0 <= score <= 100):
                raise ValueError(f'{tid}: invalid {key} score')
    if not history_after.startswith(history_before):
        raise ValueError('History must remain append-only')
    appended = [json.loads(line) for line in history_after[len(history_before):].splitlines() if line.strip()]
    if after['as_of'] == before['as_of']:
        if appended:
            raise ValueError('Same-day retry must not append history')
    elif len(appended) != 1 or appended[0]['as_of'] != after['as_of'] or appended[0]['themes'] != after['themes']:
        raise ValueError('Candidate history does not match new snapshot')


def run(root=ROOT):
    before_bytes = {name: (root/'data'/name).read_bytes() for name in OUTPUTS}
    before = json.loads(before_bytes['themes.json'])
    with tempfile.TemporaryDirectory(prefix='mystockos-themes-') as tmp:
        staging = Path(tmp)
        shutil.copytree(root/'config', staging/'config')
        shutil.copytree(root/'data', staging/'data')
        (staging/'scripts').mkdir()
        shutil.copy2(root/'scripts/update_themes.py', staging/'scripts/update_themes.py')
        result = subprocess.run([sys.executable, str(staging/'scripts/update_themes.py')], cwd=staging)
        if result.returncode:
            print('[SAFE] Engine failed; previous official data retained.', flush=True)
            return result.returncode
        if os.environ.get('THEME_DRY_RUN', '0').strip().lower() in {'1', 'true', 'yes', 'on'}:
            print('[SAFE] Dry run; official files unchanged.', flush=True)
            return 0
        candidate = {name: (staging/'data'/name).read_bytes() for name in OUTPUTS}
        try:
            validate_candidate(before, json.loads(candidate['themes.json']), before_bytes['theme_history.jsonl'], candidate['theme_history.jsonl'])
        except (ValueError, KeyError, TypeError) as exc:
            print(f'[SAFE] Candidate rejected: {exc}. Previous official data retained.', flush=True)
            return 1
        # No writes before validation. An interrupted runner cannot reach the Git commit step.
        # Recover the pair if a filesystem write fails before the Git transaction.
        try:
            for name in OUTPUTS:
                target = root/'data'/name
                temp = target.with_suffix(target.suffix+'.safe-tmp')
                temp.write_bytes(candidate[name])
                os.replace(temp, target)
        except OSError:
            for name in OUTPUTS:
                (root/'data'/name).write_bytes(before_bytes[name])
            raise
    print('[SAFE] Candidate accepted; v1.0 scores unchanged.', flush=True)
    return 0


if __name__ == '__main__':
    sys.exit(run())

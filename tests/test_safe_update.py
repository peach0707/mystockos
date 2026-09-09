import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('safe', ROOT/'scripts/run_themes_safely.py')
safe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(safe)
BASE = json.loads((ROOT/'data/themes.json').read_text())


class SafetyTest(unittest.TestCase):
    def test_same_day_and_known_missing_accepted(self):
        safe.validate_candidate(BASE, copy.deepcopy(BASE), b'old\n', b'old\n')

    def test_new_missing_or_eligibility_loss_rejected(self):
        for change in ('missing', 'count', 'status', 'score'):
            candidate = copy.deepcopy(BASE)
            t = candidate['themes'][0]
            if change == 'missing': t['data_quality']['missing_core_data'] = ['ANET']
            if change == 'count': t['data_quality']['heat_eligible_n'] -= 1
            if change == 'status': t['data_quality']['status'] = 'insufficient'
            if change == 'score': t['strength']['score'] = None
            with self.assertRaises(ValueError):
                safe.validate_candidate(BASE, candidate, b'old\n', b'old\n')

    def test_history_append_only_and_matches(self):
        c = copy.deepcopy(BASE); c['as_of'] = '2026-09-09'
        hist = b'old\n' + (json.dumps({'as_of':c['as_of'], 'themes':c['themes']})+'\n').encode()
        safe.validate_candidate(BASE, c, b'old\n', hist)
        for bad in (b'changed\n', b'old\n', hist+hist):
            with self.assertRaises(ValueError): safe.validate_candidate(BASE,c,b'old\n',bad)

    def test_regressing_date_rejected(self):
        c=copy.deepcopy(BASE);c['as_of']='2026-09-01'
        with self.assertRaises(ValueError):safe.validate_candidate(BASE,c,b'',b'')

    def test_real_runner_failure_and_degradation_never_write_original(self):
        for code in ["from pathlib import Path; Path('data/themes.json').write_text('broken'); raise SystemExit(1)",
                     "import json; from pathlib import Path; p=Path('data/themes.json'); d=json.loads(p.read_text()); d['themes'][0]['data_quality']['missing_core_data']=['ANET']; p.write_text(json.dumps(d))"]:
            with tempfile.TemporaryDirectory() as tmp:
                root=Path(tmp)
                for name in ['scripts','data','config']:(root/name).mkdir()
                (root/'scripts/update_themes.py').write_text(code)
                (root/'data/themes.json').write_text(json.dumps(BASE))
                (root/'data/theme_history.jsonl').write_bytes(b'old\n')
                old={n:(root/'data'/n).read_bytes() for n in safe.OUTPUTS}
                with patch.dict('os.environ', {'THEME_DRY_RUN':'0'}):self.assertNotEqual(safe.run(root),0)
                self.assertEqual(old,{n:(root/'data'/n).read_bytes() for n in safe.OUTPUTS})

    def test_dry_run_ignores_candidate(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            for name in ['scripts','data','config']:(root/name).mkdir()
            (root/'scripts/update_themes.py').write_text("from pathlib import Path; Path('data/themes.json').write_text('broken')")
            (root/'data/themes.json').write_text(json.dumps(BASE))
            (root/'data/theme_history.jsonl').write_bytes(b'old\n')
            old=(root/'data/themes.json').read_bytes()
            with patch.dict('os.environ', {'THEME_DRY_RUN':'1'}):self.assertEqual(safe.run(root),0)
            self.assertEqual(old,(root/'data/themes.json').read_bytes())


if __name__=='__main__':unittest.main()

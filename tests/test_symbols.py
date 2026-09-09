import importlib.util,json,tempfile,unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('symbols',Path(__file__).parents[1]/'scripts/update_symbols.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class SymbolsTest(unittest.TestCase):
 def test_bad_response_rejected(self):
  for response in [{'status':'error','code':429},{'status':'ok','data':[]}]:
   with self.assertRaises(ValueError):m.normalize(response)
 def test_shrink_does_not_destroy_previous_master(self):
  with tempfile.TemporaryDirectory() as d:
   p=Path(d)/'symbols.json';p.write_text(json.dumps({'symbols':[{}]*100}));before=p.read_bytes()
   with self.assertRaises(ValueError):m.save([{}],p)
   self.assertEqual(p.read_bytes(),before)
 def test_retry_and_timeout_do_not_write_previous(self):
  from unittest.mock import patch
  with patch.object(m.urllib.request,'urlopen',side_effect=TimeoutError),patch.object(m.time,'sleep'):
   with self.assertRaises(RuntimeError):m.fetch()

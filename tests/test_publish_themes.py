import importlib.util
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('publisher',Path(__file__).resolve().parents[1]/'scripts/publish_themes.py')
publisher=importlib.util.module_from_spec(spec);spec.loader.exec_module(publisher)


class PublishTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name);self.remote=self.root/'remote.git'
        subprocess.run(['git','init','--bare',str(self.remote)],check=True,capture_output=True)
        self.a=self.root/'a';self.b=self.root/'b'
        subprocess.run(['git','clone',str(self.remote),str(self.a)],check=True,capture_output=True)
        self.configure(self.a);self.g(self.a,'checkout','-b','main')
        self.write(self.a,'data/themes.json','old');self.write(self.a,'data/theme_history.jsonl','old\n')
        self.g(self.a,'add','.');self.g(self.a,'commit','-m','base');self.g(self.a,'push','origin','main')
        subprocess.run(['git','clone','-b','main',str(self.remote),str(self.b)],check=True,capture_output=True)
        self.configure(self.b)

    def g(self,root,*args):return publisher.git(root,*args).stdout.strip()
    def configure(self,root):
        self.g(root,'config','user.name','test');self.g(root,'config','user.email','test@example.invalid')
    def write(self,root,path,value):
        p=root/path;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(value)
    def concurrent(self,path,value):
        self.write(self.b,path,value);self.g(self.b,'add','.');self.g(self.b,'commit','-m','concurrent');self.g(self.b,'push','origin','main')
    def candidate(self):
        self.write(self.a,'data/themes.json','new');self.write(self.a,'data/theme_history.jsonl','old\nnew\n')

    def test_concurrent_stock_update_preserved_and_theme_pair_published(self):
        self.candidate();self.concurrent('data.json','stock')
        self.assertEqual(publisher.publish(self.a),'published')
        self.assertEqual(self.g(self.a,'show','origin/main:data.json'),'stock')
        self.assertEqual(self.g(self.a,'show','origin/main:data/theme_history.jsonl'),'old\nnew')
        self.assertEqual(publisher.publish(self.a),'unchanged')

    def test_concurrent_theme_history_rejected(self):
        self.candidate();self.concurrent('data/theme_history.jsonl','old\nother\n')
        with self.assertRaisesRegex(ValueError,'concurrent_theme'):publisher.publish(self.a)
        self.assertEqual(self.g(self.b,'show','origin/main:data/theme_history.jsonl'),'old\nother')

    def test_changed_scoring_input_rejected(self):
        self.candidate();self.concurrent('config/scoring_profiles.json','changed')
        with self.assertRaisesRegex(ValueError,'concurrent_theme'):publisher.publish(self.a)

    def test_unexpected_local_change_rejected(self):
        self.concurrent('data.json','stock');self.g(self.a,'pull','--ff-only','origin','main')
        self.candidate();self.write(self.a,'data.json','unexpected')
        with self.assertRaisesRegex(ValueError,'unexpected_worktree'):publisher.publish(self.a)

    def test_race_after_fetch_retries_without_api_or_lost_changes(self):
        self.candidate();original=publisher.git;once=[]
        def racing(root,*args,**kwargs):
            if root==self.a and args[:1]==('push',) and not once:
                once.append(True);self.concurrent('data.json','race')
            return original(root,*args,**kwargs)
        with patch.object(publisher,'git',side_effect=racing):
            self.assertEqual(publisher.publish(self.a),'published')
        self.assertEqual(self.g(self.a,'show','origin/main:data.json'),'race')

    def test_permission_failure_does_not_retry(self):
        self.candidate();original=publisher.git;pushes=[]
        def denied(root,*args,**kwargs):
            if args[:1]==('push',):
                pushes.append(True);return subprocess.CompletedProcess(args,1,'','permission denied')
            return original(root,*args,**kwargs)
        with patch.object(publisher,'git',side_effect=denied):
            with self.assertRaisesRegex(ValueError,'not_a_concurrent'):publisher.publish(self.a)
        self.assertEqual(len(pushes),1)

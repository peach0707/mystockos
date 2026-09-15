import hashlib
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'scripts'))
import publish_display_metrics as publisher


class DisplayPublishTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.remote = self.root/'remote.git'
        subprocess.run(['git', 'init', '--bare', str(self.remote)], check=True, capture_output=True)
        self.a, self.b = self.root/'a', self.root/'b'
        subprocess.run(['git', 'clone', str(self.remote), str(self.a)], check=True, capture_output=True)
        self.configure(self.a)
        self.g(self.a, 'checkout', '-b', 'main')
        self.old = self.archive(self.a, 'old\n')
        self.write(self.a, publisher.LATEST, 'old\n')
        self.write(self.a, 'data.json', 'old stock')
        self.g(self.a, 'add', '.')
        self.g(self.a, 'commit', '-m', 'base')
        self.g(self.a, 'push', 'origin', 'main')
        subprocess.run(['git', 'clone', '-b', 'main', str(self.remote), str(self.b)], check=True, capture_output=True)
        self.configure(self.b)

    def g(self, root, *args):
        return publisher.git(root, *args).stdout.strip()

    def configure(self, root):
        self.g(root, 'config', 'user.name', 'test')
        self.g(root, 'config', 'user.email', 'test@example.invalid')

    def write(self, root, path, value):
        p = root/path
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(value)

    def archive(self, root, value):
        path = publisher.ARCHIVES+'2026-09/'+hashlib.sha256(value.encode()).hexdigest()+'.json'
        self.write(root, path, value)
        return path

    def candidate(self):
        self.new = self.archive(self.a, 'new\n')
        self.write(self.a, publisher.LATEST, 'new\n')

    def concurrent(self, path, value):
        self.write(self.b, path, value)
        self.g(self.b, 'add', '.')
        self.g(self.b, 'commit', '-m', 'concurrent')
        self.g(self.b, 'push', 'origin', 'main')

    def test_unrelated_update_preserves_exact_artifacts_and_history(self):
        self.candidate()
        self.concurrent('data.json', 'stock')
        self.assertEqual(publisher.publish(self.a), 'published')
        self.assertEqual(self.g(self.a, 'show', 'origin/main:data.json'), 'stock')
        self.assertEqual(self.g(self.a, 'show', 'origin/main:'+self.old), 'old')
        self.assertEqual(self.g(self.a, 'show', 'origin/main:'+self.new), 'new')
        self.assertEqual(self.g(self.a, 'show', 'origin/main:'+publisher.LATEST), 'new')
        self.assertEqual(publisher.publish(self.a), 'unchanged')

    def test_race_after_fetch_retries_without_recollection(self):
        self.candidate()
        original = publisher.git
        pushes = []
        def racing(root, *args, **kwargs):
            if root == self.a and args[0] == 'push':
                if not pushes:
                    self.concurrent('data.json', 'race')
                pushes.append(args)
            return original(root, *args, **kwargs)
        with patch.object(publisher, 'git', side_effect=racing):
            self.assertEqual(publisher.publish(self.a), 'published')
        self.assertEqual(len(pushes), 2)
        self.assertEqual(self.g(self.a, 'show', 'origin/main:data.json'), 'race')
        self.assertEqual(self.g(self.a, 'show', 'origin/main:'+self.new), 'new')

    def test_changed_theme_inputs_rejected(self):
        self.candidate()
        self.concurrent('data/themes.json', 'new input')
        with self.assertRaisesRegex(ValueError, 'concurrent_display'):
            publisher.publish(self.a)

    def test_changed_config_rejected(self):
        self.candidate()
        self.concurrent('config/memberships.csv', 'changed')
        with self.assertRaisesRegex(ValueError, 'concurrent_display'):
            publisher.publish(self.a)

    def test_concurrent_latest_rejected(self):
        self.candidate()
        self.concurrent(publisher.LATEST, 'other display')
        with self.assertRaisesRegex(ValueError, 'concurrent_display'):
            publisher.publish(self.a)

    def test_existing_archive_cannot_be_overwritten(self):
        self.candidate()
        self.write(self.a, self.old, 'replacement')
        with self.assertRaisesRegex(ValueError, 'immutable_archive'):
            publisher.publish(self.a)

    def test_existing_archive_cannot_be_deleted(self):
        self.candidate()
        (self.a/self.old).unlink()
        with self.assertRaisesRegex(ValueError, 'immutable_archive'):
            publisher.publish(self.a)

    def test_new_archive_hash_verified(self):
        self.candidate()
        self.write(self.a, self.new, 'corruption')
        with self.assertRaisesRegex(ValueError, 'archive_hash'):
            publisher.publish(self.a)

    def test_unrelated_local_file_not_committed(self):
        self.candidate()
        self.write(self.a, 'unexpected.txt', 'unrelated')
        with self.assertRaisesRegex(ValueError, 'unexpected_worktree'):
            publisher.publish(self.a)

    def test_permission_denial_is_not_retried(self):
        self.candidate()
        original = publisher.git
        pushes = []
        def denied(root, *args, **kwargs):
            if args[0] == 'push':
                pushes.append(args)
                return subprocess.CompletedProcess(args, 1, '', 'permission denied')
            return original(root, *args, **kwargs)
        with patch.object(publisher, 'git', side_effect=denied):
            with self.assertRaisesRegex(ValueError, 'not_a_concurrent'):
                publisher.publish(self.a)
        self.assertEqual(len(pushes), 1)

    def test_retry_limit_and_never_force_push(self):
        self.candidate()
        original = publisher.git
        pushes = []
        def rejected(root, *args, **kwargs):
            if args[0] == 'push':
                pushes.append(args)
                return subprocess.CompletedProcess(args, 1, '', 'fetch first')
            return original(root, *args, **kwargs)
        with patch.object(publisher, 'git', side_effect=rejected):
            with self.assertRaisesRegex(ValueError, 'retry_exhausted'):
                publisher.publish(self.a)
        self.assertEqual(pushes, [('push', 'origin', 'HEAD:main')]*3)

    def test_workflow_keeps_collection_main_only_and_uses_publisher(self):
        workflow = (Path(__file__).resolve().parents[1]/'.github/workflows/phase-a.yml').read_text()
        self.assertIn("github.event_name != 'pull_request' && github.ref == 'refs/heads/main'", workflow)
        self.assertIn('python scripts/publish_display_metrics.py', workflow)
        self.assertEqual(workflow.count('python scripts/collect_display_metrics.py'), 1)

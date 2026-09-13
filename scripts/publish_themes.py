"""Publish calculated themes without overwriting concurrent inputs or history."""
import subprocess
from pathlib import Path

OUTPUTS = ('data/themes.json', 'data/theme_history.jsonl')


def git(root, *args, check=True):
    return subprocess.run(['git', *args], cwd=root, check=check,
                          text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)


def protected(path):
    return path in OUTPUTS or path.startswith(('config/', 'scripts/')) or path == '.github/workflows/themes.yml'


def publish(root, attempts=3):
    root = Path(root)
    changed = git(root, 'status', '--porcelain', '--untracked-files=no').stdout.splitlines()
    if any(line[3:] not in OUTPUTS for line in changed):
        raise ValueError('unexpected_worktree_changes')
    if not changed:
        return 'unchanged'
    baseline = git(root, 'rev-parse', 'HEAD').stdout.strip()
    git(root, 'add', '--', *OUTPUTS)
    git(root, 'commit', '-m', 'Update theme data')
    for _ in range(attempts):
        git(root, 'fetch', 'origin', 'main')
        remote = git(root, 'rev-parse', 'FETCH_HEAD').stdout.strip()
        if git(root, 'merge-base', '--is-ancestor', baseline, remote, check=False).returncode:
            raise ValueError('remote_history_changed')
        paths = git(root, 'diff', '--name-only', baseline, remote).stdout.splitlines()
        if any(protected(path) for path in paths):
            raise ValueError('concurrent_theme_inputs_or_outputs_changed')
        result = git(root, 'rebase', remote, check=False)
        if result.returncode:
            git(root, 'rebase', '--abort', check=False)
            raise ValueError('rebase_conflict_no_publish')
        pushed = git(root, 'push', 'origin', 'HEAD:main', check=False)
        if not pushed.returncode:
            return 'published'
        if not any(reason in pushed.stderr for reason in ('fetch first', 'non-fast-forward')):
            raise ValueError('push_failed_not_a_concurrent_update')
    raise ValueError('publish_retry_exhausted_no_force_push')


if __name__ == '__main__':
    print(publish(Path(__file__).resolve().parents[1]))

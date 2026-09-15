"""Publish existing Phase A artifacts; retry unrelated main races without refetching prices."""
import hashlib
import re
from pathlib import Path

from publish_themes import git

LATEST = 'data/phase_a.json'
ARCHIVES = 'data/phase-a-observations/'


def protected(path):
    return (path == LATEST or path.startswith((ARCHIVES, 'config/', 'scripts/'))
            or path in ('data/themes.json', 'data/theme_history.jsonl',
                        '.github/workflows/phase-a.yml'))


def publish(root, attempts=3):
    root = Path(root)
    if not 1 <= attempts <= 3:
        raise ValueError('invalid_retry_limit')
    baseline = git(root, 'rev-parse', 'HEAD').stdout.strip()
    changed = git(root, 'status', '--porcelain', '--untracked-files=all').stdout.splitlines()
    if not changed:
        return 'unchanged'
    paths = []
    for line in changed:
        status, path = line[:2], line[3:]
        if path == LATEST:
            if status not in (' M', 'M ', 'A ', '??') or not (root/path).is_file() or (root/path).is_symlink():
                raise ValueError('invalid_latest_change')
        elif re.fullmatch(r'data/phase-a-observations/\d{4}-\d{2}/[0-9a-f]{64}\.json', path):
            if (status not in ('A ', '??') or (root/path).is_symlink()
                    or git(root, 'cat-file', '-e', baseline+':'+path, check=False).returncode == 0):
                raise ValueError('immutable_archive_change')
            if hashlib.sha256((root/path).read_bytes()).hexdigest() != Path(path).stem:
                raise ValueError('archive_hash_mismatch')
        else:
            raise ValueError('unexpected_worktree_changes')
        paths.append(path)
    git(root, 'add', '--', *paths)
    git(root, 'commit', '-m', 'Append Phase A observation and update display metrics')
    for _ in range(attempts):
        git(root, 'fetch', 'origin', 'main')
        remote = git(root, 'rev-parse', 'FETCH_HEAD').stdout.strip()
        if git(root, 'merge-base', '--is-ancestor', baseline, remote, check=False).returncode:
            raise ValueError('remote_history_changed')
        upstream = git(root, 'diff', '--name-only', baseline, remote).stdout.splitlines()
        if any(protected(path) for path in upstream):
            raise ValueError('concurrent_display_inputs_or_outputs_changed')
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

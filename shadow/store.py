"""Transactional, append-only local research store. No network or UI integration."""
from __future__ import annotations
import hashlib
import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone, date
from pathlib import Path


def utc(value):
    if not isinstance(value, str):
        raise ValueError('UTC timestamp required')
    parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if parsed.tzinfo is None or parsed.utcoffset().total_seconds() != 0:
        raise ValueError('UTC timestamp required')
    return parsed


def now():
    return datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')


def encoded(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False, allow_nan=False).encode()


def digest(value):
    return hashlib.sha256(encoded(value)).hexdigest()


def require(condition, message):
    if not condition:
        raise ValueError(message)


class Store:
    def __init__(self, path, *, namespace='shadow', clock=now):
        require(namespace in ('shadow', 'synthetic'), 'unknown namespace')
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.clock = clock
        self.db = sqlite3.connect(self.path, timeout=30, isolation_level=None)
        self.db.execute('PRAGMA journal_mode=WAL')
        self.db.execute('PRAGMA synchronous=FULL')
        self.db.executescript('''
        CREATE TABLE IF NOT EXISTS records(kind TEXT NOT NULL,id TEXT NOT NULL,body BLOB NOT NULL,hash TEXT NOT NULL,PRIMARY KEY(kind,id));
        CREATE TABLE IF NOT EXISTS objects(hash TEXT PRIMARY KEY,body BLOB NOT NULL);
        CREATE TRIGGER IF NOT EXISTS records_no_update BEFORE UPDATE ON records BEGIN SELECT RAISE(ABORT,'append-only'); END;
        CREATE TRIGGER IF NOT EXISTS records_no_delete BEFORE DELETE ON records BEGIN SELECT RAISE(ABORT,'append-only'); END;
        CREATE TRIGGER IF NOT EXISTS objects_no_update BEFORE UPDATE ON objects BEGIN SELECT RAISE(ABORT,'append-only'); END;
        CREATE TRIGGER IF NOT EXISTS objects_no_delete BEFORE DELETE ON objects BEGIN SELECT RAISE(ABORT,'append-only'); END;
        ''')
        self.namespace = namespace
        try:
            self.append('meta', 'namespace', {'namespace': namespace, 'schema_version': 1})
        except BaseException:
            self.db.close()
            raise

    def close(self):
        self.db.close()

    @contextmanager
    def transaction(self):
        self.db.execute('BEGIN IMMEDIATE')
        try:
            yield
            self.db.execute('COMMIT')
        except BaseException:
            self.db.execute('ROLLBACK')
            raise

    def append(self, kind, identifier, value):
        require(isinstance(identifier, str) and bool(identifier), 'empty record ID')
        body = encoded(value)
        sha = hashlib.sha256(body).hexdigest()
        row = self.db.execute('SELECT body,hash FROM records WHERE kind=? AND id=?', (kind, identifier)).fetchone()
        if row:
            require(row == (body, sha), 'immutable record ID conflict')
            return identifier
        self.db.execute('INSERT INTO records VALUES(?,?,?,?)', (kind, identifier, body, sha))
        return identifier

    def get(self, kind, identifier):
        row = self.db.execute('SELECT body,hash FROM records WHERE kind=? AND id=?', (kind, identifier)).fetchone()
        require(row is not None, f'missing {kind}: {identifier}')
        require(hashlib.sha256(row[0]).hexdigest() == row[1], 'record checksum mismatch')
        return json.loads(row[0])

    def records(self, kind):
        ids = [r[0] for r in self.db.execute('SELECT id FROM records WHERE kind=? ORDER BY rowid', (kind,))]
        return [self.get(kind, identifier) for identifier in ids]

    def object(self, sha):
        row = self.db.execute('SELECT body FROM objects WHERE hash=?', (sha,)).fetchone()
        require(row is not None and hashlib.sha256(row[0]).hexdigest() == sha, 'object checksum mismatch')
        return bytes(row[0])

    def capture(self, sources):
        """sources: name -> {body: bytes, source, available_at, data_as_of, revision, license_class}.

        retrieved_at is this process's clock, never the source's historical date.
        All objects + observation manifest commit together. Failures leave old data intact.
        """
        captured_at = self.clock()
        utc(captured_at)
        require(isinstance(sources, dict) and bool(sources), 'empty capture')
        entries = {}
        with self.transaction():
            for name, source in sorted(sources.items()):
                require(isinstance(name, str) and name, 'invalid input name')
                body = source['body']
                require(isinstance(body, bytes), 'raw bytes required')
                require(utc(source['available_at']) <= utc(captured_at), 'future source availability')
                for key in ('source', 'data_as_of', 'revision', 'license_class'):
                    require(isinstance(source[key], str) and source[key], f'missing source {key}')
                require(date.fromisoformat(source['data_as_of']) <= date.fromisoformat(captured_at[:10]), 'future observation date')
                sha = hashlib.sha256(body).hexdigest()
                prior = self.db.execute('SELECT body FROM objects WHERE hash=?', (sha,)).fetchone()
                if prior:
                    require(prior[0] == body, 'object hash collision')
                else:
                    self.db.execute('INSERT INTO objects VALUES(?,?)', (sha, body))
                entries[name] = {k: source[k] for k in ('source', 'available_at', 'data_as_of', 'revision', 'license_class')}
                entries[name].update(content_hash=sha, retrieved_at=captured_at)
            manifest = {'schema_version': 1, 'namespace': self.namespace, 'captured_at': captured_at, 'inputs': entries}
            identifier = digest(manifest)
            self.append('observation', identifier, manifest)
        return identifier

    def input(self, manifest_id, name, *, cutoff=None):
        manifest = self.get('observation', manifest_id)
        require(manifest['namespace'] == self.namespace, 'namespace mismatch')
        source = manifest['inputs'][name]
        if cutoff:
            for time in (manifest['captured_at'], source['available_at'], source['retrieved_at']):
                require(utc(time) <= utc(cutoff), 'point-in-time violation')
        return json.loads(self.object(source['content_hash']))

    def audit(self):
        count = 0
        for kind, identifier in self.db.execute('SELECT kind,id FROM records').fetchall():
            value = self.get(kind, identifier)
            if kind == 'observation':
                for entry in value['inputs'].values():
                    self.object(entry['content_hash'])
            count += 1
        return {'namespace': self.namespace, 'records': count, 'objects': self.db.execute('SELECT COUNT(*) FROM objects').fetchone()[0]}

    def backup(self, path):
        """SQLite backup API includes committed WAL contents; not an unsafe file copy."""
        destination = Path(path)
        require(not destination.exists(), 'backup destination already exists')
        with sqlite3.connect(destination) as target:
            self.db.backup(target)

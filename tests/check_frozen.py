"""No API calls: guard frozen scoring, configuration, and existing updaters."""
import hashlib
import json
from pathlib import Path
root=Path(__file__).resolve().parents[1]
baseline=json.loads((root/'tests/frozen-baseline.json').read_text())
for name,expected in baseline['blobs'].items():
    data=(root/name).read_bytes()
    actual=hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest()
    if actual!=expected:raise SystemExit(f'Frozen file changed: {name}')
print(f"Frozen regression passed: {len(baseline['blobs'])} exact Git blobs at {baseline['commit']}")

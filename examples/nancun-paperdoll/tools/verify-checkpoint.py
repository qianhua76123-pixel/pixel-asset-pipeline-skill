"""Verify copied artifacts and local HTML dependencies; not a new visual acceptance test."""
from pathlib import Path
from html.parser import HTMLParser
from urllib.parse import unquote, urlsplit
import hashlib
import json

root = Path(__file__).resolve().parents[1]
record = json.loads((root / 'docs/artifact-manifest.json').read_text())
for rel, digest in record['files'].items():
    path = root / rel
    assert path.is_file(), f'Missing: {rel}'
    assert hashlib.sha256(path.read_bytes()).hexdigest() == digest, f'Changed: {rel}'

class Links(HTMLParser):
    def __init__(self):
        super().__init__()
        self.refs = []
    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag in ('script', 'img') and 'src' in attrs:
            self.refs.append(attrs['src'])
        elif tag in ('link', 'a') and 'href' in attrs:
            self.refs.append(attrs['href'])

web = root / 'experiments/modular-v82/runtime'
checked = 0
for html in web.rglob('*.html'):
    parser = Links()
    parser.feed(html.read_text())
    for value in parser.refs:
        ref = urlsplit(value)
        if ref.scheme or ref.netloc or not ref.path:
            continue
        target = (web / unquote(ref.path).lstrip('/')) if ref.path.startswith('/') else (html.parent / unquote(ref.path))
        assert target.exists(), f'Broken HTML reference: {html.relative_to(root)} -> {value}'
        checked += 1
print(json.dumps({'artifactFilesExact': len(record['files']), 'htmlLocalReferences': checked, 'status': 'passed', 'scope': 'archival integrity and local entry closure'}, ensure_ascii=False))

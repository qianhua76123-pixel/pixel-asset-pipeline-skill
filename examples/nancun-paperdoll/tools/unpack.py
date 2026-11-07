from pathlib import Path, PurePosixPath
import hashlib, json, zipfile
root=Path(__file__).resolve().parents[1]
for item in json.loads((root/'docs/source-archives.json').read_text()):
    archive=root/'archives'/item['sourceArchive']
    assert hashlib.sha256(archive.read_bytes()).hexdigest()==item['sha256'], archive.name
    with zipfile.ZipFile(archive) as z:
        assert z.testzip() is None
        for info in z.infolist():
            if info.is_dir():continue
            rel=PurePosixPath(info.filename)
            assert not rel.is_absolute() and '..' not in rel.parts
            parts=rel.parts[1:] if item.get('stripFirstComponent', True) else rel.parts
            if any(p in ('.git','.godot','node_modules','.DS_Store') for p in parts):continue
            target=root/item['destination']/Path(*parts)
            target.parent.mkdir(parents=True,exist_ok=True)
            target.write_bytes(z.read(info))
            if target.suffix=='.command':target.chmod(0o755)
    print('Restored',item['sourceArchive'])
print('Complete source and PNG assets restored. Run: python3 tools/verify-checkpoint.py')

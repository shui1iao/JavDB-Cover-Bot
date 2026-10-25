#!/usr/bin/env python3
"""Refresh public build fingerprints and build the bundled MIT wheel.
Run with Python 3.14 and setuptools 82.0.1 installed:
  SOURCE_DATE_EPOCH=0 python tools/build-core.py
"""
import hashlib,json,os,pathlib,subprocess,sys
root=pathlib.Path(__file__).resolve().parents[1]
source=root/'core/src'; package=source/'se_catalog'
files=sorted(p for p in package.rglob('*') if p.is_file() and p.name!='build.json' and '__pycache__' not in p.parts and p.suffix in ('.py','.json'))
fingerprint=hashlib.sha256()
for p in files:
 fingerprint.update(p.relative_to(source).as_posix().encode()+b'\0'+p.read_bytes()+b'\0')
info={'name_data_sha256':hashlib.sha256((package/'data/actor-names.json').read_bytes()).hexdigest(),'source_sha256':fingerprint.hexdigest(),'version':'2026.10.25.1'}
(package/'data/build.json').write_text(json.dumps(info,sort_keys=True)+'\n')
os.environ.setdefault('SOURCE_DATE_EPOCH','0')
subprocess.run([sys.executable,'-m','pip','wheel','--no-deps','--no-build-isolation',str(root/'core'),'-w',str(root/'vendor')],check=True)
print(json.dumps(info,sort_keys=True))

"""The website serves a copy of the Python model; it must not drift.

    python tests/code_sync_check.py
"""
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]

for name in ("engine.py", "scenarios.py", "stats.py"):
    src = (ROOT / "taxi_sim" / name).read_bytes()
    web = (ROOT / "web" / "py" / name).read_bytes()
    if src != web:
        print(f"FAIL  web/py/{name} differs from taxi_sim/{name}")
        print("      run: python tools/sync_py.py")
        sys.exit(1)
    print(f"PASS  {name} is in step")

print("CODE SYNC OK")

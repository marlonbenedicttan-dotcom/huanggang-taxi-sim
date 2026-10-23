"""Copy the Python research model into the website so it can be read/downloaded.

    python tools/sync_py.py

tests/code_sync_check.py fails if the copies drift from taxi_sim/.
"""
import shutil
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
DEST = ROOT / "web" / "py"
DEST.mkdir(exist_ok=True)

for name in ("engine.py", "scenarios.py", "stats.py"):
    shutil.copyfile(ROOT / "taxi_sim" / name, DEST / name)
    print("copied", name)

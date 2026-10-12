"""Repository-local contract gates used by CI and release checks."""

from pathlib import Path
import json
import os
import shutil
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "contracts" / "soul_stamp.py"
configured_linter = os.environ.get("GENVM_LINT_BIN")
python_linter = Path(sys.executable).parent / "Scripts" / ("genvm-lint.exe" if os.name == "nt" else "genvm-lint")
LINTER = Path(configured_linter) if configured_linter else (
    python_linter if python_linter.exists() else Path(shutil.which("genvm-lint") or "genvm-lint")
)


def main() -> int:
    env = os.environ.copy()
    env.setdefault("GENVM_VERSION", "v0.2.16")
    command = [str(LINTER), "check", str(CONTRACT), "--json"]
    completed = subprocess.run(command, cwd=ROOT, env=env, text=True, capture_output=True)
    output = completed.stdout.strip() or completed.stderr.strip()
    print(output)
    if completed.returncode != 0:
        return completed.returncode
    try:
        result = json.loads(output)
    except json.JSONDecodeError:
        print("contract gate did not return JSON", file=sys.stderr)
        return 2
    if not result.get("ok") or not result.get("lint", {}).get("ok") or not result.get("validate", {}).get("ok"):
        print("contract lint/semantic validation failed", file=sys.stderr)
        return 3
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

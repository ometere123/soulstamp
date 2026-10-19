"""Repository-local contract gates used by CI and release checks."""

from pathlib import Path
import json
import os
import shutil
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[1]
CONTRACTS = [
    ROOT / "contracts" / "soul_stamp.py",
    ROOT / "contracts" / "soulstamp_trustpass.py",
]
configured_linter = os.environ.get("GENVM_LINT_BIN")
python_linter = Path(sys.executable).parent / "Scripts" / ("genvm-lint.exe" if os.name == "nt" else "genvm-lint")
if configured_linter:
    LINTER = [configured_linter]
elif python_linter.exists():
    LINTER = [str(python_linter)]
elif shutil.which("genvm-lint"):
    LINTER = [str(shutil.which("genvm-lint"))]
else:
    LINTER = [sys.executable, "-m", "genvm_linter.cli"]


def main() -> int:
    env = os.environ.copy()
    env.setdefault("GENVM_VERSION", "v0.2.16")
    for contract in CONTRACTS:
        command = [*LINTER, "check", str(contract), "--json"]
        completed = subprocess.run(command, cwd=ROOT, env=env, text=True, capture_output=True)
        output = completed.stdout.strip() or completed.stderr.strip()
        print(json.dumps({"contract": str(contract.relative_to(ROOT)), "output": output}))
        if completed.returncode != 0:
            return completed.returncode
        try:
            result = json.loads(output)
        except json.JSONDecodeError:
            print(f"contract gate did not return JSON for {contract}", file=sys.stderr)
            return 2
        if not result.get("ok") or not result.get("lint", {}).get("ok") or not result.get("validate", {}).get("ok"):
            print(f"contract lint/semantic validation failed for {contract}", file=sys.stderr)
            return 3
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

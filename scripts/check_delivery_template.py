"""Lint a generated bootstrap against synthetic metadata; no AWS session needed."""
import json
from pathlib import Path
import subprocess
import tempfile

from scripts.bootstrap_delivery import generate
from tests.delivery_fixtures import fixture


def main():
    template = generate(*fixture())
    with tempfile.TemporaryDirectory(prefix="karaoke-delivery-lint-") as directory:
        path = Path(directory) / "delivery.json"
        path.write_text(json.dumps(template))
        subprocess.run(["sam", "validate", "--lint", "--template-file", str(path), "--region", "us-east-2"], check=True)


if __name__ == "__main__":
    main()

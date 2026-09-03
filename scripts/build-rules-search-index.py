"""Compatibility entry point for the OCR-capable Node indexer."""

import subprocess
import shutil
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
NODE = shutil.which("node")
if not NODE:
    raise SystemExit("Node.js es obligatorio para ejecutar Tesseract.js.")
subprocess.run([NODE, str(ROOT / "scripts" / "build-rules-search-index.mjs")], cwd=ROOT, check=True)

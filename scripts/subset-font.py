"""Fetch APL387 and subset it to the glyphs APL Beats actually renders.

APL387 is Dyalog's redrawn successor to Adrian Smith's APL385 Unicode, released
into the public domain under The Unlicence: https://github.com/Dyalog/APL387

The repository does not commit a built TTF — it is produced by their CI and
published to their Pages site, which is where this script fetches it from. The
resulting WOFF2 is committed to src/assets/fonts/, so contributors never need
to run this. Re-run it only to pick up an upstream font revision:

    pip install "fonttools[woff]" brotli
    python scripts/subset-font.py
"""

from __future__ import annotations

import subprocess
import sys
import urllib.request
from pathlib import Path

SOURCE_URL = "https://dyalog.github.io/APL387/APL387.ttf"

REPO_ROOT = Path(__file__).resolve().parent.parent
OUTPUT_DIR = REPO_ROOT / "src" / "assets" / "fonts"
OUTPUT_FILE = OUTPUT_DIR / "APL387-subset.woff2"

# Basic Latin and Latin-1 (the overbar U+00AF, times U+00D7 and divide U+00F7
# all live here), general punctuation, arrows, mathematical operators, the
# Miscellaneous Technical block that carries most APL glyphs, plus the
# geometric shapes used by circle functions.
UNICODE_RANGES = ",".join(
    [
        "U+0020-007E",
        "U+00A0-00FF",
        "U+2010-205E",
        "U+2190-21FF",
        "U+2200-22FF",
        "U+2300-23FF",
        "U+25A0-25FF",
        "U+2A00-2AFF",
    ]
)


def main() -> int:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    source = OUTPUT_DIR / "APL387.ttf"

    print(f"Downloading {SOURCE_URL}")
    with urllib.request.urlopen(SOURCE_URL, timeout=60) as response:
        source.write_bytes(response.read())
    print(f"  {source.stat().st_size:,} bytes")

    print("Subsetting to WOFF2")
    subprocess.run(
        [
            sys.executable,
            "-m",
            "fontTools.subset",
            str(source),
            f"--unicodes={UNICODE_RANGES}",
            "--layout-features=*",
            "--flavor=woff2",
            f"--output-file={OUTPUT_FILE}",
        ],
        check=True,
    )

    source.unlink()
    print(f"Wrote {OUTPUT_FILE.relative_to(REPO_ROOT)} ({OUTPUT_FILE.stat().st_size:,} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

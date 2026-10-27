#!/usr/bin/env python3
"""Build a Postman runner CSV for the Media-Image-Flow collection from an image folder.

Usage: python3 build_runner_csv.py <image_dir> [uploadId] [out_csv]
"""

import csv
import sys
from pathlib import Path

FORMATS = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
           ".gif": "image/gif", ".bmp": "image/bmp", ".webp": "image/webp",
           ".tiff": "image/tiff", ".ico": "image/x-icon"}


def main():
    if len(sys.argv) < 2:
        sys.exit("Usage: python3 build_runner_csv.py <image_dir> [uploadId] [out_csv]")
    img_dir = Path(sys.argv[1])
    upload_id = sys.argv[2] if len(sys.argv) > 2 else "019dd44d-67d5-7c1d-b2d4-117f6b3e98c1"
    out_csv = Path(sys.argv[3]) if len(sys.argv) > 3 else img_dir / "runner_data.csv"

    try:
        from PIL import Image
    except ImportError:
        sys.exit("Pillow required: pip3 install pillow")

    rows = []
    for i, p in enumerate(sorted(img_dir.iterdir()), start=1):
        mime = FORMATS.get(p.suffix.lower())
        if not mime:
            continue
        with Image.open(p) as img:
            w, h = img.size
        rows.append({
            "uploadId": upload_id,
            "fileName": p.name,
            "mimeType": mime,
            "fileSize": p.stat().st_size,
            "width": w,
            "height": h,
            "order": i,
            "isCompressed": "true",
            "FILE_PATH": str(p.resolve()),
        })

    with open(out_csv, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=rows[0].keys())
        writer.writeheader()
        writer.writerows(rows)
    print(f"Wrote {len(rows)} rows to {out_csv}")


if __name__ == "__main__":
    main()

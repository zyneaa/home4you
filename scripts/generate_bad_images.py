#!/usr/bin/env python3
"""Generate BAD images: correct extensions but corrupted/invalid magic bytes.

Usage: python3 generate_bad_images.py <min_mb> <max_mb> [out_dir] [count_per_format]
Example: python3 generate_bad_images.py 0.1 30
"""

import random
import sys
from pathlib import Path

FORMATS = ["png", "jpeg", "gif", "bmp", "webp", "tiff", "ico"]


def next_index(out: Path) -> int:
    nums = []
    for p in out.glob("*_*.*"):
        parts = p.stem.split("_")
        if len(parts) >= 2 and parts[1].isdigit():
            nums.append(int(parts[1]))
    return max(nums, default=0) + 1


def generate(out_dir, min_mb, max_mb, count_per_format):
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    made = []
    for fmt in FORMATS:
        ext = "jpg" if fmt == "jpeg" else fmt
        for _ in range(count_per_format):
            target = random.uniform(min_mb, max_mb) * 1024 * 1024
            path = out / f"bad_{next_index(out)}.{ext}"
            size = int(target)
            style = random.choice(["zero_head", "garbage", "truncated_junk", "partial_magic"])
            if style == "zero_head":
                data = b"\x00" * 64 + bytes(random.randint(0, 255) for _ in range(size - 64))
            elif style == "garbage":
                data = bytes(random.randint(0, 255) for _ in range(size))
            elif style == "truncated_junk":
                data = bytes(random.randint(0, 255) for _ in range(random.randint(1, 64)))
            else:  # partial_magic: real-ish magic prefix then junk
                data = b"\x89PNG" + bytes(random.randint(0, 255) for _ in range(size - 4))
            path.write_bytes(data)
            final = out / f"bad_{path.stem.split('_')[1]}_b{len(data)}.{ext}"
            path.rename(final)
            made.append(final)
            print(f"  {final}  size={len(data) / 1024 / 1024:.2f}MB  style={style}")
    print(f"Done: {len(made)} bad images in {out}/ ({min_mb}-{max_mb} MB each)")


if __name__ == "__main__":
    if len(sys.argv) < 3:
        sys.exit("Usage: python3 generate_bad_images.py <min_mb> <max_mb> [out_dir] [count_per_format]")
    min_mb, max_mb = float(sys.argv[1]), float(sys.argv[2])
    if min_mb <= 0 or max_mb <= min_mb:
        sys.exit("Error: require 0 < min_mb < max_mb")
    out = sys.argv[3] if len(sys.argv) > 3 else "scripts/bad_images"
    count = int(sys.argv[4]) if len(sys.argv) > 4 else 1
    generate(out, min_mb, max_mb, count)

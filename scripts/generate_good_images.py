#!/usr/bin/env python3
"""Generate fake (synthetic) images with valid magic bytes in many formats.

Usage: python3 generate_good_images.py <min_mb> <max_mb> [out_dir]
Example: python3 generate_good_images.py 0.1 30
"""

import random
import sys
from pathlib import Path

from PIL import Image, ImageDraw

FORMATS = ["png", "jpeg", "gif", "bmp", "webp", "tiff", "ico"]
MAGIC = {
    "png": b"\x89PNG\r\n\x1a\n",
    "jpeg": b"\xff\xd8\xff",
    "gif": b"GIF8",
    "bmp": b"BM",
    "webp": b"RIFF",
    "tiff": b"II*\x00",
    "ico": b"\x00\x00\x01\x00",
}


def make_image(size, color, seed):
    random.seed(seed)
    img = Image.new("RGB", size, color)
    draw = ImageDraw.Draw(img)
    for _ in range(10):
        x1, y1 = random.randint(0, size[0]), random.randint(0, size[1])
        x2, y2 = random.randint(0, size[0]), random.randint(0, size[1])
        draw.ellipse([min(x1, x2), min(y1, y2), max(x1, x2), max(y1, y2)],
                     fill=tuple(random.randint(0, 255) for _ in range(3)))
    return img


def next_index(out: Path) -> int:
    nums = []
    for p in out.glob("*_*.*"):
        parts = p.stem.split("_")
        if len(parts) >= 2 and parts[1].isdigit():
            nums.append(int(parts[1]))
    return max(nums, default=0) + 1


def generate(out_dir, min_mb, max_mb):
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    made = []
    while len(made) < len(FORMATS):
        fmt = FORMATS[len(made)]
        ext = "jpg" if fmt == "jpeg" else fmt
        target = random.uniform(min_mb, max_mb) * 1024 * 1024
        color = tuple(random.randint(0, 255) for _ in range(3))
        img = make_image((256, 256), color, seed=len(made) * 100 + hash(fmt) % 1000)
        path = out / f"good_{next_index(out)}_w{img.width}_h{img.height}.{ext}"
        import io
        buf = io.BytesIO()
        img.save(buf, format=fmt.upper(), quality=90)
        data = buf.getvalue()
        if len(data) < target:
            # append random padding after encoded image (parsers tolerate trailing data)
            data += bytes(random.randint(0, 255) for _ in range(int(target) - len(data)))
        else:
            # too big already: regenerate with noise until big enough
            while len(data) < target:
                px = img.load()
                for _ in range(20000):
                    x, y = random.randint(0, img.width - 1), random.randint(0, img.height - 1)
                    px[x, y] = tuple(random.randint(0, 255) for _ in range(3))
                buf = io.BytesIO()
                img.save(buf, format=fmt.upper(), quality=100)
                data = buf.getvalue()
        path.write_bytes(data)
        final = out / f"good_{path.stem.split('_')[1]}_w{img.width}_h{img.height}_b{len(data)}.{ext}"
        path.rename(final)
        head = data[:12]
        assert head.startswith(MAGIC[fmt]), f"{final}: bad magic {head!r}"
        made.append(final)
        print(f"  {final}  size={len(data) / 1024 / 1024:.2f}MB  magic={head[:8].hex()}")
    print(f"Done: {len(made)} valid images in {out}/ ({min_mb}-{max_mb} MB each)")


if __name__ == "__main__":
    if len(sys.argv) < 3:
        sys.exit("Usage: python3 generate_good_images.py <min_mb> <max_mb> [out_dir]")
    min_mb, max_mb = float(sys.argv[1]), float(sys.argv[2])
    if min_mb <= 0 or max_mb <= min_mb:
        sys.exit("Error: require 0 < min_mb < max_mb")
    generate(sys.argv[3] if len(sys.argv) > 3 else "scripts/fake_images", min_mb, max_mb)

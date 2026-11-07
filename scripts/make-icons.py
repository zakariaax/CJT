#!/usr/bin/env python3
"""Draw simple opaque PNG icons for the tracker PWA. No external image library."""
import math
import struct
import zlib
from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / "public" / "icons"

# 5x7 bitmap glyphs. 1 is ink.
FONT = {
    "J": [
        "00111",
        "00001",
        "00001",
        "00001",
        "10001",
        "10001",
        "01110",
    ],
    "T": [
        "11111",
        "00100",
        "00100",
        "00100",
        "00100",
        "00100",
        "00100",
    ],
}


def mix(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def circle_coverage(x, y, cx, cy, radius):
    d = math.hypot(x + 0.5 - cx, y + 0.5 - cy)
    return max(0.0, min(1.0, radius - d + 0.5))


def draw_mark(size, circle_ratio):
    bg = (20, 22, 28)
    red = (176, 32, 48)
    ink = (255, 255, 255)
    pixels = [[bg for _ in range(size)] for _ in range(size)]
    cx = cy = size / 2
    radius = size * circle_ratio / 2
    for y in range(size):
        row = pixels[y]
        for x in range(size):
            cov = circle_coverage(x, y, cx, cy, radius)
            if cov:
                row[x] = mix(bg, red, cov)
    # "JT" centered in the circle. Glyphs are 5 wide, 7 tall, 1 column gap.
    glyph_h = 7
    gap = 1
    word_w = 5 + gap + 5
    scale = max(1, int(size * circle_ratio / 18))
    origin_x = int(round(cx - (word_w * scale) / 2))
    origin_y = int(round(cy - (glyph_h * scale) / 2))
    for glyph, gx0 in (("J", 0), ("T", 6)):
        pattern = FONT[glyph]
        for gy, bits in enumerate(pattern):
            for gx, bit in enumerate(bits):
                if bit != "1":
                    continue
                for dy in range(scale):
                    yy = origin_y + gy * scale + dy
                    if yy < 0 or yy >= size:
                        continue
                    for dx in range(scale):
                        xx = origin_x + (gx0 + gx) * scale + dx
                        if xx < 0 or xx >= size:
                            continue
                        # Keep letters inside the circle.
                        if math.hypot(xx + 0.5 - cx, yy + 0.5 - cy) < radius - scale * 0.4:
                            pixels[yy][xx] = ink
    return pixels


def write_png(path, pixels):
    height = len(pixels)
    width = len(pixels[0])
    raw = bytearray()
    for row in pixels:
        raw.append(0)
        for r, g, b in row:
            raw.extend((r, g, b))

    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(bytes(raw), 9)) + chunk(b"IEND", b"")
    path.write_bytes(png)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    specs = {
        "icon-192.png": (192, 0.70),
        "icon-512.png": (512, 0.70),
        "icon-maskable-512.png": (512, 0.50),
        "apple-touch-icon.png": (180, 0.68),
        "favicon-32.png": (32, 0.78),
    }
    for name, (size, ratio) in specs.items():
        write_png(OUT / name, draw_mark(size, ratio))
        print(name, size)


if __name__ == "__main__":
    main()

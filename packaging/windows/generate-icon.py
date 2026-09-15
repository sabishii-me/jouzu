#!/usr/bin/env python3
"""Generate the Windows JZ dot icon with Python's standard library."""
import argparse
import math
from pathlib import Path
import struct
import zlib

ROOT = Path(__file__).resolve().parent
SIZES = (16, 20, 24, 32, 40, 48, 64, 128, 256)
# J and Z from presentation.ts's two-row Braille mark. Preserve each
# character's position in the ten-character cyan-to-pink gradient.
GLYPHS = (("⠈⢹", "⠣⠜", 0), ("⢉⠝", "⠮⠤", 6))
START, END = (34, 211, 238), (244, 114, 182)
BRAILLE = ((0, 0), (0, 1), (0, 2), (1, 0), (1, 1), (1, 2), (0, 3), (1, 3))


def dots():
    for letter, (top, bottom, gradient_index) in enumerate(GLYPHS):
        for row, glyphs in enumerate((top, bottom)):
            for column, glyph in enumerate(glyphs):
                color = tuple(math.floor(a + (b - a) * (gradient_index + column) / 9 + 0.5)
                              for a, b in zip(START, END))
                for bit, (x, y) in enumerate(BRAILLE):
                    if (ord(glyph) - 0x2800) & (1 << bit):
                        yield (1.5 + letter * 5 + column * 2 + x, 2 + row * 4 + y, color)


def rgba(size):
    scale = size / 11
    samples = 4
    # Supersample circle coverage only; unpainted pixels retain zero alpha.
    pixels = bytearray(size * size * 4)
    for x, y, color in dots():
        cx, cy, radius = x * scale, y * scale, 0.43 * scale
        for py in range(max(0, math.floor(cy - radius)), min(size, math.ceil(cy + radius))):
            for px in range(max(0, math.floor(cx - radius)), min(size, math.ceil(cx + radius))):
                inside = sum((px + (sx + 0.5) / samples - cx) ** 2
                             + (py + (sy + 0.5) / samples - cy) ** 2 <= radius ** 2
                             for sy in range(samples) for sx in range(samples))
                if inside:
                    offset = (py * size + px) * 4
                    pixels[offset:offset + 4] = bytes((*color, round(255 * inside / samples ** 2)))

    return pixels


def png(size):
    pixels = rgba(size)

    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))

    rows = b"".join(b"\0" + pixels[y * size * 4:(y + 1) * size * 4] for y in range(size))
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(rows, 9)) + chunk(b"IEND", b""))


def dib(size):
    # DIB frames keep small icons compatible with the .NET Framework compiler
    # and Windows icon APIs; Windows uses the PNG frame at 256 pixels.
    pixels = rgba(size)
    bitmap, mask = bytearray(), bytearray()
    stride = ((size + 31) // 32) * 4
    for y in reversed(range(size)):
        row_mask = bytearray(stride)
        for x in range(size):
            r, g, b, a = pixels[(y * size + x) * 4:(y * size + x + 1) * 4]
            bitmap.extend((b, g, r, a))
            if a == 0:
                row_mask[x // 8] |= 0x80 >> (x % 8)
        mask.extend(row_mask)
    return struct.pack("<IiiHHIIiiII", 40, size, size * 2, 1, 32, 0, len(bitmap), 0, 0, 0, 0) + bitmap + mask


def artifacts():
    circles = "\n".join(f'  <circle cx="{x:g}" cy="{y:g}" r="0.43" fill="#{r:02x}{g:02x}{b:02x}"/>'
                        for x, y, (r, g, b) in dots())
    svg = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 11 11" role="img" aria-label="Jouzu">\n'
           f'{circles}\n</svg>\n').encode()
    images = [png(size) if size == 256 else dib(size) for size in SIZES]
    offset = 6 + 16 * len(SIZES)
    directory = bytearray(struct.pack("<HHH", 0, 1, len(SIZES)))
    for size, image in zip(SIZES, images):
        directory.extend(struct.pack("<BBBBHHII", size % 256, size % 256, 0, 0, 1, 32, len(image), offset))
        offset += len(image)
    return {"jouzu.svg": svg, "jouzu.ico": bytes(directory) + b"".join(images)}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Check that the icon files match the generator.")
    args = parser.parse_args()
    for name, content in artifacts().items():
        path = ROOT / name
        if args.check:
            if not path.exists() or path.read_bytes() != content:
                raise SystemExit(f"{name} differs; run python3 packaging/windows/generate-icon.py")
        else:
            path.write_bytes(content)
    print("Windows icon files match the generator." if args.check else "Generated Windows icon files.")

"""Draw the home-screen icons. Run from the repo root: python3 scripts/make_icons.py"""
from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path("icons")
PERSIMMON = "#9d3414"
CREAM = "#fff7ee"
INDIGO = "#1c3f68"


def icon(size, inset=0.0):
    image = Image.new("RGB", (size, size), PERSIMMON)
    draw = ImageDraw.Draw(image)
    pad = size * inset
    left = size * 0.16 + pad
    top = size * 0.16 + pad
    right = size * 0.84 - pad
    bottom = size * 0.66 - pad * 0.4
    radius = size * 0.12
    draw.rounded_rectangle([left, top, right, bottom], radius=radius, fill=CREAM)
    tail = [
        (size * 0.30 + pad * 0.2, bottom - size * 0.04),
        (size * 0.26 + pad * 0.15, size * 0.82 - pad * 0.3),
        (size * 0.48, bottom - size * 0.02),
    ]
    draw.polygon(tail, fill=CREAM)
    # Cover the seam where the tail meets the bubble.
    draw.rectangle([size * 0.30, bottom - size * 0.08, size * 0.50, bottom], fill=CREAM)
    line_left = left + size * 0.12
    line_w = (right - left) * 0.62
    y1 = top + (bottom - top) * 0.34
    y2 = top + (bottom - top) * 0.58
    h = max(3, int(size * 0.035))
    draw.rounded_rectangle([line_left, y1, line_left + line_w, y1 + h], radius=h, fill=PERSIMMON)
    draw.rounded_rectangle([line_left, y2, line_left + line_w * 0.72, y2 + h], radius=h, fill=INDIGO)
    # A short rising mark, like a tone.
    mark_y = top + size * 0.08
    draw.line(
        [(line_left, mark_y + size * 0.06), (line_left + line_w * 0.38, mark_y)],
        fill=PERSIMMON,
        width=max(3, int(size * 0.028)),
    )
    return image


def main():
    OUT.mkdir(exist_ok=True)
    icon(512).save(OUT / "icon-512.png")
    icon(192).save(OUT / "icon-192.png")
    icon(180).save(OUT / "apple-touch-icon.png")
    icon(32).save(OUT / "favicon-32.png")
    icon(512, inset=0.08).save(OUT / "icon-maskable.png")


if __name__ == "__main__":
    main()

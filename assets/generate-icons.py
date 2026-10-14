"""Rebuild original WAVE app icons from vector geometry (requires Pillow)."""
from pathlib import Path
from PIL import Image, ImageDraw

OUTPUT = Path(__file__).resolve().parent
SCALE = 4

for size in (192, 512):
    dimension = size * SCALE
    image = Image.new("RGB", (dimension, dimension))
    pixels = image.load()
    start, end = (69, 124, 250), (23, 51, 130)
    for y in range(dimension):
        for x in range(dimension):
            position = (x + y) / (2 * (dimension - 1))
            pixels[x, y] = tuple(round(a + (b - a) * position) for a, b in zip(start, end))
    draw = ImageDraw.Draw(image)
    factor = dimension / 64
    points = [(x * factor, y * factor) for x, y in ((12, 24), (21, 44), (32, 20), (43, 44), (52, 24))]
    width = round(4.5 * factor)
    draw.line(points, fill=(239, 248, 255), width=width, joint="curve")
    radius = width / 2
    for x, y in points:
        draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=(239, 248, 255))
    image.resize((size, size), Image.Resampling.LANCZOS).save(OUTPUT / f"icon-{size}.png", optimize=True)

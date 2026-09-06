"""Render the studio's three-panel brand mark. Requires Pillow."""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1] / 'public' / 'icons'
SIZE = 2048
image = Image.new('RGB', (SIZE, SIZE), '#faf9f6')
draw = ImageDraw.Draw(image)
# All artwork remains inside the maskable icon's central safe circle.
draw.rectangle((464, 464, 1584, 1584), fill='#272822')
draw.rectangle((544, 544, 1504, 976), fill='#a63f2b')
draw.rectangle((544, 1056, 984, 1504), fill='#faf9f6')
draw.rectangle((1064, 1056, 1504, 1504), fill='#faf9f6')
for size in (192, 512):
    image.resize((size, size), Image.Resampling.LANCZOS).save(ROOT / f'icon-{size}.png', optimize=True)
image.resize((1024, 1024), Image.Resampling.LANCZOS).save(ROOT / 'icon-source.png', optimize=True)

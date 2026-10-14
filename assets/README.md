# WAVE direct textures

The root-level editable SVG files are original artwork created for WAVE. The ps3/ subfolder contains original PS3 interface textures with separate attribution in ps3/NOTICE.md. They are bundled directly with the app, load locally, and require no remote image service or external assets.

- `wave-background.svg` — 1920 × 1080 midnight-blue atmosphere with layered flowing light and silk contours.
- `cover-orbit.svg` — 800 × 800 sculptural metallic orbital study in ultramarine.
- `cover-drift.svg` — 800 × 800 translucent water-glass study in pale blue.
- `cover-nocturne.svg` — 800 × 800 flowing violet light sculpture.
- `favicon.svg` — 64 × 64 original WAVE mark.
- `icon-192.png` and `icon-512.png` — opaque PWA icons matching the original WAVE mark; regenerate with `python assets/generate-icons.py` (Pillow required).

The textures use vector paths, gradients, and subtle SVG procedural grain. The original WAVE SVG artwork contains no Sony assets. The separately attributed ps3/ directory contains PS3 interface assets, excluded from the WAVE MIT license. Titles embedded in each SVG support accessible use; when an image is decorative, use an empty `alt` attribute in the interface.

# PlayStation 3 XMB wave renderer

Source: https://github.com/linkev/PlayStation-3-XMB/tree/main/ps3xmbwave

Copyright (c) 2025 Mart. Distributed under the MIT license, preserved in `LICENSE` and at the top of the bundled `src/ps3-wave.js` module.

Retrieved October 14, 2026. These upstream JavaScript files are preserved here. `src/ps3-wave.js` combines the renderer, displacement pipeline, particle layer, settings, and monthly gradient presets into a private namespace; omits settings-panel metadata; and adds WAVE's lifecycle, theme, resolution, reduced-motion caching, and audio-response integration. No upstream control panel is included. Particle density is reduced for player performance. Upstream shader and displacement calculations are preserved.

This is linkev's open-source, reverse-engineering-based recreation, not Sony firmware. As documented by upstream, its displacement pipeline contains synthetic descriptors because exact runtime payloads from the PS3 are not available. Its gradients are fitted presets rather than redistributed firmware DDS textures. Sony and PlayStation trademarks remain their owners' property. WAVE is an independent project.

`SPLINE_REVERSE_ENGINEER.md` is the upstream technical provenance reference. The separate WAVE artwork in `assets/` is not part of this upstream renderer.

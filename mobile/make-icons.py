#!/usr/bin/env python3
"""Regenerate the native app icon art from the master PNGs in assets/.

Run it only when the artwork in assets/ changes (those PNGs come from
`node scripts/make-icons.cjs`). The output is committed, so builds never need
Pillow:

    python3 mobile/make-icons.py        # needs: pip install pillow

Inputs (assets/):
    icon-only.png        1024 px, full-bleed square, no transparency
    icon-foreground.png  1024 px, transparent, mark sized for adaptive icons
    icon-background.png  1024 px, opaque backdrop for adaptive icons

Outputs:
    android/app/src/main/res/mipmap-*dpi/ic_launcher.png            legacy square
    android/app/src/main/res/mipmap-*dpi/ic_launcher_round.png      legacy round
    android/app/src/main/res/mipmap-*dpi/ic_launcher_foreground.png adaptive layer
    android/app/src/main/res/mipmap-*dpi/ic_launcher_background.png adaptive layer
    android/app/src/main/res/mipmap-*dpi/ic_launcher_monochrome.png themed icon layer
    android/app/src/main/res/drawable-*dpi/ic_splash.png            launch icon
    ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png  1024 px, no alpha
    ios/App/App/Assets.xcassets/LaunchLogo.imageset/*.png           launch logo
"""

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets"
RES = ROOT / "android/app/src/main/res"
XCASSETS = ROOT / "ios/App/App/Assets.xcassets"

# Android density buckets: name -> scale relative to mdpi (1 dp = scale px).
DENSITIES = {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}


def load(name, mode):
    return Image.open(ASSETS / name).convert(mode)


def resize(image, size):
    """High quality resize that does not bleed dark fringes into transparency."""
    size = (size, size)
    if image.mode == "RGBA":
        return image.convert("RGBa").resize(size, Image.LANCZOS).convert("RGBA")
    return image.resize(size, Image.LANCZOS)


def save(image, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, optimize=True)
    print("wrote", path.relative_to(ROOT), image.size, image.mode)


def mask(size, shape):
    """Anti-aliased rounded-square or circle mask, drawn at 8x and shrunk."""
    big = size * 8
    canvas = Image.new("L", (big, big), 0)
    draw = ImageDraw.Draw(canvas)
    if shape == "round":
        draw.ellipse((0, 0, big - 1, big - 1), fill=255)
    else:
        draw.rounded_rectangle((0, 0, big - 1, big - 1), radius=int(big * 0.2), fill=255)
    return canvas.resize((size, size), Image.LANCZOS)


def monochrome(foreground):
    """Single-colour silhouette for Android 13+ themed icons.

    The launcher only uses the alpha channel and tints it. The outline of the
    mark and the facet edges are near white in the colour art, so they keep
    full opacity while the coloured facets become semi-transparent. That keeps
    the faceted look instead of a flat triangle.
    """
    rgba = foreground.convert("RGBA")
    out = Image.new("RGBA", rgba.size, (255, 255, 255, 0))
    src = rgba.load()
    dst = out.load()
    for y in range(rgba.height):
        for x in range(rgba.width):
            r, g, b, a = src[x, y]
            if a < 8:
                continue
            whiteness = min(max((min(r, g, b) - 150) / 85.0, 0.0), 1.0)
            # The soft outer glow (low alpha) is dropped, solid pixels are kept.
            solid = min(max((a - 90) / 120.0, 0.0), 1.0)
            alpha = solid * (0.42 + 0.58 * whiteness)
            dst[x, y] = (255, 255, 255, round(alpha * 255))
    return out


def android():
    icon = load("icon-only.png", "RGB")
    foreground = load("icon-foreground.png", "RGBA")
    background = load("icon-background.png", "RGB")
    mono = monochrome(foreground)
    for name, scale in DENSITIES.items():
        legacy = round(48 * scale)
        adaptive = round(108 * scale)
        splash = round(288 * scale)
        base = resize(icon, legacy).convert("RGBA")
        square = base.copy()
        square.putalpha(mask(legacy, "square"))
        circle = base.copy()
        circle.putalpha(mask(legacy, "round"))
        save(square, RES / f"mipmap-{name}/ic_launcher.png")
        save(circle, RES / f"mipmap-{name}/ic_launcher_round.png")
        save(resize(foreground, adaptive), RES / f"mipmap-{name}/ic_launcher_foreground.png")
        save(resize(background, adaptive), RES / f"mipmap-{name}/ic_launcher_background.png")
        save(resize(mono, adaptive), RES / f"mipmap-{name}/ic_launcher_monochrome.png")
        save(resize(foreground, splash), RES / f"drawable-{name}/ic_splash.png")


def ios():
    icon = load("icon-only.png", "RGB")
    if icon.size != (1024, 1024):
        raise SystemExit("assets/icon-only.png must be 1024x1024")
    # App Store icons must not have an alpha channel, so save a plain RGB image.
    save(icon, XCASSETS / "AppIcon.appiconset/AppIcon-512@2x.png")
    foreground = load("icon-foreground.png", "RGBA")
    for scale in (1, 2, 3):
        # The launch logo is shown 200 pt wide, centred on the dark background.
        save(resize(foreground, 200 * scale), XCASSETS / f"LaunchLogo.imageset/launch-logo-{scale}x.png")


if __name__ == "__main__":
    android()
    ios()

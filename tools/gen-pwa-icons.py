#!/usr/bin/env python3
"""Gera os ícones do PWA em public/icons/ (disco de vinil âmbar sobre o fundo escuro do app).

Uso: python3 tools/gen-pwa-icons.py   (requer Pillow). Os PNGs gerados ficam versionados;
rode de novo só se quiser mudar o desenho.
"""
import os
from PIL import Image, ImageDraw

BG = (24, 21, 19, 255)        # --background do app (tema escuro)
VINYL = (14, 12, 11, 255)
GROOVE = (44, 38, 34, 255)
AMBER = (232, 163, 61, 255)   # --primary do app
HOLE = BG
S = 2048                       # supersample; reduz com LANCZOS


def draw(record_frac: float) -> Image.Image:
    im = Image.new("RGBA", (S, S), BG)
    d = ImageDraw.Draw(im)
    c = S / 2
    r = S * record_frac / 2

    def circle(rad, fill=None, outline=None, width=0):
        d.ellipse([c - rad, c - rad, c + rad, c + rad], fill=fill, outline=outline, width=width)

    circle(r, fill=VINYL)
    for k in range(5):  # sulcos
        circle(r * (0.93 - k * 0.09), outline=GROOVE, width=max(2, int(S * 0.004)))
    circle(r * 0.36, fill=AMBER)          # rótulo
    circle(r * 0.05, fill=HOLE)           # furo
    # brilho diagonal sutil no disco
    hl = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    hd = ImageDraw.Draw(hl)
    hd.pieslice([c - r, c - r, c + r, c + r], 205, 245, fill=(255, 255, 255, 22))
    hd.pieslice([c - r, c - r, c + r, c + r], 25, 65, fill=(255, 255, 255, 22))
    hl_mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(hl_mask).ellipse([c - r * 0.98, c - r * 0.98, c + r * 0.98, c + r * 0.98], fill=255)
    hl.putalpha(Image.composite(hl.getchannel("A"), Image.new("L", (S, S), 0), hl_mask))
    return Image.alpha_composite(im, hl)


out = os.path.join(os.path.dirname(__file__), "..", "public", "icons")
os.makedirs(out, exist_ok=True)
any_img, mask_img = draw(0.78), draw(0.58)  # maskable: disco dentro da zona segura (80%)
for name, img, size in [
    ("icon-192.png", any_img, 192),
    ("icon-512.png", any_img, 512),
    ("icon-maskable-512.png", mask_img, 512),
    ("apple-touch-icon.png", any_img, 180),
]:
    img.resize((size, size), Image.LANCZOS).convert("RGB").save(os.path.join(out, name), optimize=True)
    print("ok", name)

#!/usr/bin/env python3
"""生成 Peek 的扩展图标（纯标准库，无需 Pillow）。

形状：紫色圆角方块 + 两个叠放的白色窗口，寓意「页面上浮一层」。
"""

import os
import struct
import zlib

SS = 4                      # 超采样倍数
N = 128                     # 逻辑尺寸
S = N * SS                  # 渲染尺寸
BG = (91, 79, 214)          # #5B4FD6
WHITE = (255, 255, 255)
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "icons")


def sdf_round_rect(x, y, x0, y0, x1, y1, r):
    cx = (x0 + x1) / 2.0
    cy = (y0 + y1) / 2.0
    hx = (x1 - x0) / 2.0 - r
    hy = (y1 - y0) / 2.0 - r
    dx = abs(x - cx) - hx
    dy = abs(y - cy) - hy
    ox = max(dx, 0.0)
    oy = max(dy, 0.0)
    return (ox * ox + oy * oy) ** 0.5 + min(max(dx, dy), 0.0) - r


def new_buffer():
    return [[0.0, 0.0, 0.0, 0.0] for _ in range(S * S)]


def blend(buf, i, color, alpha):
    if alpha <= 0:
        return
    a = min(alpha, 1.0)
    if a >= 1.0:
        buf[i][0], buf[i][1], buf[i][2], buf[i][3] = color[0] / 255.0, color[1] / 255.0, color[2] / 255.0, 1.0
        return
    dr, dg, db, da = buf[i]
    out_a = a + da * (1 - a)
    if out_a <= 0:
        return
    for k in range(3):
        buf[i][k] = (color[k] / 255.0 * a + buf[i][k] * da * (1 - a)) / out_a
    buf[i][3] = out_a


def fill_shape(buf, sdf_args, color, alpha=1.0, stroke=None):
    x0, y0, x1, y1, r = sdf_args
    for py in range(S):
        y = (py + 0.5) / SS
        for px in range(S):
            x = (px + 0.5) / SS
            d = sdf_round_rect(x, y, x0, y0, x1, y1, r)
            hit = (abs(d) <= stroke / 2.0) if stroke else (d <= 0)
            if hit:
                blend(buf, py * S + px, color, alpha)


def resample(buf, dw, dh):
    out = bytearray(dw * dh * 4)
    for y in range(dh):
        sy0 = y * S / dh
        sy1 = (y + 1) * S / dh
        for x in range(dw):
            sx0 = x * S / dw
            sx1 = (x + 1) * S / dw
            ar = ag = ab = aa = 0.0
            n = 0
            py = int(sy0)
            while py < sy1:
                wy = min(py + 1, sy1) - max(py, sy0)
                px = int(sx0)
                while px < sx1:
                    wx = min(px + 1, sx1) - max(px, sx0)
                    w = wy * wx
                    if w > 0:
                        r_, g_, b_, a_ = buf[py * S + px]
                        ar += r_ * a_ * w
                        ag += g_ * a_ * w
                        ab += b_ * a_ * w
                        aa += a_ * w
                        n += w
                    px += 1
                py += 1
            if aa > 0:
                o = (y * dw + x) * 4
                out[o] = int(round(min(1.0, ar / aa) * 255))
                out[o + 1] = int(round(min(1.0, ag / aa) * 255))
                out[o + 2] = int(round(min(1.0, ab / aa) * 255))
                out[o + 3] = int(round(min(1.0, aa / n) * 255))
    return bytes(out)


def write_png(path, w, h, rgba):
    stride = w * 4
    raw = bytearray()
    for y in range(h):
        raw.append(0)
        raw += rgba[y * stride:(y + 1) * stride]

    def chunk(tag, data):
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
    png += chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)


def main():
    os.makedirs(OUT, exist_ok=True)
    buf = new_buffer()

    fill_shape(buf, (2, 2, 126, 126, 30), BG)                       # 底板
    fill_shape(buf, (24, 25, 90, 87, 11), WHITE, 0.70, stroke=7)    # 后面的窗口（描边）
    fill_shape(buf, (44, 44, 118, 114, 20), BG)                     # 前面卡片的光晕
    fill_shape(buf, (50, 50, 112, 108, 15), WHITE)                  # 前面的卡片

    for size in (16, 32, 48, 128):
        write_png(os.path.join(OUT, "icon%d.png" % size), size, size, resample(buf, size, size))
        print("wrote icon%d.png" % size)


if __name__ == "__main__":
    main()

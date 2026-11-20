#!/usr/bin/env python3
"""Turns the raw generated stills into render-ready plates plus depth maps.

For every image in assets/raw (or, when that folder is absent, for every
existing plate) it writes
  assets/plates/<name>.jpg   1920x1080 colour plate
  assets/depth/<name>.png    1920x1080 depth map (white = near), from Depth Anything V2,
                             edge-snapped to the plate with a guided filter
  assets/glow/<name>.jpg     640x360 light bloom: halation around the practical
                             lights plus a cool horizontal anamorphic streak

It also prints an Otsu split per depth map: the natural gap between subject and
background, which is where the film slots its type (PLATES.textDepth in film.js).

The depth maps drive the 2.5D camera moves, the depth-aware fog and the
"type behind the subject" occlusion in the film shader.

Usage: python3 scripts/prep_stills.py <depth_anything_v2_small.onnx>
"""
import pathlib
import sys

import cv2
import numpy as np
import onnxruntime as ort

root = pathlib.Path(__file__).resolve().parent.parent
raw, plates, depth_dir = root / "assets/raw", root / "assets/plates", root / "assets/depth"
glow_dir = root / "assets/glow"
for folder in (plates, depth_dir, glow_dir):
    folder.mkdir(exist_ok=True)

session = ort.InferenceSession(sys.argv[1], providers=["CPUExecutionProvider"])
input_name = session.get_inputs()[0].name
MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)



def guided_filter(guide, src, radius, eps):
    """He et al. guided filter: smooths src but keeps the edges of guide."""
    box = lambda x: cv2.boxFilter(x, -1, (2 * radius + 1, 2 * radius + 1))
    mean_g, mean_s = box(guide), box(src)
    a = (box(guide * src) - mean_g * mean_s) / (box(guide * guide) - mean_g * mean_g + eps)
    b = mean_s - a * mean_g
    return box(a) * guide + box(b)


from_raw = raw.is_dir()
for path in sorted((raw if from_raw else plates).iterdir()):
    img = cv2.imread(str(path), cv2.IMREAD_COLOR)
    if img is None:
        continue
    plate = cv2.resize(img, (1920, 1080), interpolation=cv2.INTER_LANCZOS4)
    if from_raw:
        # step the quality down until the plate fits the repo's 500 KB limit for plain binaries
        target = plates / f"{path.stem}.jpg"
        for quality in range(93, 79, -2):
            cv2.imwrite(str(target), plate, [cv2.IMWRITE_JPEG_QUALITY, quality])
            if target.stat().st_size < 490_000:
                break

    # Bloom is baked once here instead of being sampled per pixel per frame.
    small = cv2.resize(plate, (640, 360), interpolation=cv2.INTER_AREA).astype(np.float32) / 255
    peak = small.max(axis=2, keepdims=True)
    halo = cv2.GaussianBlur(small * np.clip((peak - 0.55) / 0.45, 0, 1), (0, 0), 8)
    streak = cv2.GaussianBlur(small * np.clip((peak - 0.82) / 0.18, 0, 1), (0, 0), sigmaX=42, sigmaY=1.6)
    glow = halo * 1.5 + streak * np.array([1.0, 0.72, 0.5], dtype=np.float32) * 2.2  # BGR: cool streak
    cv2.imwrite(str(glow_dir / f"{path.stem}.jpg"), (np.clip(glow, 0, 1) * 255).astype(np.uint8), [cv2.IMWRITE_JPEG_QUALITY, 88])

    rgb = cv2.cvtColor(cv2.resize(img, (924, 518), interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2RGB)
    tensor = ((rgb.astype(np.float32) / 255 - MEAN) / STD).transpose(2, 0, 1)[None]
    depth = session.run(None, {input_name: tensor})[0].squeeze()
    lo, hi = np.percentile(depth, 1), np.percentile(depth, 99)
    depth = np.clip((depth - lo) / (hi - lo), 0, 1)
    depth = cv2.resize(depth.astype(np.float32), (1920, 1080), interpolation=cv2.INTER_CUBIC)
    guide = cv2.cvtColor(plate, cv2.COLOR_BGR2GRAY).astype(np.float32) / 255
    depth = np.clip(guided_filter(guide, depth, 10, 4e-4), 0, 1)
    depth8 = (depth * 255).astype(np.uint8)
    cv2.imwrite(str(depth_dir / f"{path.stem}.png"), depth8)
    split, _ = cv2.threshold(depth8, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    near = (depth8 > split).mean()
    print(f"{path.stem:10s} otsu split {split / 255:.2f}  ({near:.0%} of the frame is nearer)")

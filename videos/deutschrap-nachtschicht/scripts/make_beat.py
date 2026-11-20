#!/usr/bin/env python3
"""Synthesizes the instrumental for NACHTSCHICHT: a dark 140 BPM drill beat in F minor.

Everything is generated from scratch (no samples), so the track is free of any
third-party rights. Besides the audio it writes beatmap.json, the single timing
source the video is cut on.

Usage: python3 scripts/make_beat.py <out.wav> <beatmap.json>
"""
import json
import sys

import numpy as np
from scipy import signal

SR = 44100
BPM = 140.0
BEAT = 60.0 / BPM
BAR = 4 * BEAT
STEP = BEAT / 4  # 16th note
BARS = 34
TAIL = 1.7
TOTAL = BARS * BAR + TAIL
N = int(TOTAL * SR)
rng = np.random.default_rng(45)

SECTIONS = [  # name, first bar, bar count
    ("intro", 0, 4),
    ("drop_a", 4, 8),
    ("verse", 12, 8),
    ("break", 20, 2),
    ("drop_b", 22, 8),
    ("outro", 30, 4),
]


def section_of(bar):
    for name, start, count in SECTIONS:
        if start <= bar < start + count:
            return name
    return "outro"


def midi(n):
    return 440.0 * 2 ** ((n - 69) / 12)


def t_of(bar, step=0.0):
    return bar * BAR + step * STEP


def place(buf, sig, t, gain=1.0, pan=0.0):
    """Adds a mono signal into a stereo buffer at time t with constant-power pan."""
    i = int(round(t * SR))
    if i >= N or i < 0:
        return
    sig = sig[: N - i]
    left = np.cos((pan + 1) * np.pi / 4)
    right = np.sin((pan + 1) * np.pi / 4)
    buf[i : i + len(sig), 0] += sig * gain * left
    buf[i : i + len(sig), 1] += sig * gain * right


def butter(sig, cutoff, kind, order=2):
    sos = signal.butter(order, cutoff, btype=kind, fs=SR, output="sos")
    return signal.sosfilt(sos, sig, axis=0)


def env_exp(n, tau, attack=0.002):
    t = np.arange(n) / SR
    return np.minimum(t / attack, 1.0) * np.exp(-t / tau)


# ---------------------------------------------------------------- instruments
def piano(note, dur=2.6, vel=1.0):
    """Dark felt piano: inharmonic partials, two detuned strings, soft hammer."""
    f0 = midi(note)
    n = int(dur * SR)
    t = np.arange(n) / SR
    out = np.zeros(n)
    tau0 = 1.5 * (220.0 / f0) ** 0.35
    for detune in (0.9994, 1.0007):
        for k in range(1, 11):
            fk = k * f0 * detune * np.sqrt(1 + 0.00045 * k * k)
            if fk > 9000:
                break
            amp = (1.0 / k**1.35) * (0.55 + 0.45 * vel) ** (k - 1)
            out += amp * np.exp(-t / (tau0 / (1 + 0.42 * (k - 1)))) * np.sin(2 * np.pi * fk * t)
    out *= np.minimum(t / 0.005, 1.0)
    thump = rng.standard_normal(n) * np.exp(-t / 0.012) * 0.05
    out = butter(out + butter(thump, 900, "low"), 4200, "low")
    out[-2000:] *= np.linspace(1, 0, 2000)
    return out * vel * 0.24


def bell(note, dur=1.8, vel=1.0):
    """Cold FM bell for the counter melody."""
    f0 = midi(note)
    n = int(dur * SR)
    t = np.arange(n) / SR
    mod = np.sin(2 * np.pi * f0 * 3.5 * t) * 1.6 * np.exp(-t / 0.25)
    out = np.sin(2 * np.pi * f0 * t + mod) * np.exp(-t / 0.55)
    out *= np.minimum(t / 0.003, 1.0)
    return out * vel * 0.12


def pad(notes, dur):
    """Slow detuned saw pad, heavily low-passed."""
    n = int(dur * SR)
    t = np.arange(n) / SR
    out = np.zeros((n, 2))
    for note in notes:
        for j, cents in enumerate((-9, -3, 4, 10)):
            f = midi(note) * 2 ** (cents / 1200)
            saw = signal.sawtooth(2 * np.pi * f * t + rng.uniform(0, 6.28))
            out[:, j % 2] += saw
    out = butter(out, 750, "low", 4)
    fade = int(0.35 * SR)
    shape = np.ones(n)
    shape[:fade] = np.linspace(0, 1, fade) ** 2
    shape[-fade:] = np.linspace(1, 0, fade) ** 2
    return out * shape[:, None] * 0.028


def kick():
    n = int(0.32 * SR)
    t = np.arange(n) / SR
    freq = 46 + 150 * np.exp(-t / 0.022)
    body = np.sin(2 * np.pi * np.cumsum(freq) / SR) * np.exp(-t / 0.11)
    click = butter(rng.standard_normal(n) * np.exp(-t / 0.003), 2500, "high") * 0.25
    return np.tanh((body + click) * 1.8) * 0.75


def snare():
    n = int(0.34 * SR)
    t = np.arange(n) / SR
    tone = (np.sin(2 * np.pi * 205 * t) + 0.6 * np.sin(2 * np.pi * 338 * t)) * np.exp(-t / 0.045)
    noise = butter(rng.standard_normal(n), [1400, 9500], "band") * np.exp(-t / 0.085)
    return np.tanh((tone * 0.7 + noise * 0.9) * 1.6) * 0.5


def clap():
    n = int(0.3 * SR)
    t = np.arange(n) / SR
    noise = butter(rng.standard_normal(n), [900, 4200], "band")
    shape = np.zeros(n)
    for delay in (0.0, 0.011, 0.023):
        i = int(delay * SR)
        shape[i:] += np.exp(-t[: n - i] / 0.008)
    shape += np.exp(-t / 0.1) * 0.6
    return noise * shape * 0.33


def hat(open_=False, pitch=1.0):
    dur = 0.4 if open_ else 0.09
    n = int(dur * SR)
    t = np.arange(n) / SR
    metal = sum(signal.square(2 * np.pi * f * pitch * t) for f in (3100, 4270, 5330, 6790, 8120, 9410))
    sig = butter(metal * 0.12 + rng.standard_normal(n) * 0.6, 7200, "high", 4)
    return sig * np.exp(-t / (0.16 if open_ else 0.022)) * 0.2


def bass808(events):
    """Monophonic 808 with pitch punch and drill slides. events: (t, note, slide_to, slide_at)."""
    freq = np.zeros(N)
    amp = np.zeros(N)
    events = sorted(events)
    for idx, (t0, note, slide_to, slide_at) in enumerate(events):
        i0 = int(t0 * SR)
        i1 = int(events[idx + 1][0] * SR) if idx + 1 < len(events) else N
        i1 = min(i1, i0 + int(1.5 * SR), N)
        n = i1 - i0
        t = np.arange(n) / SR
        f = np.full(n, midi(note))
        if slide_to is not None:
            glide = np.clip((t - slide_at) / 0.09, 0, 1)
            f = midi(note) * (midi(slide_to) / midi(note)) ** glide
        freq[i0:i1] = f * (1 + 1.4 * np.exp(-t / 0.011))
        shape = np.minimum(t / 0.002, 1.0) * np.exp(-t / 0.75)
        shape[-min(n, 400) :] *= np.linspace(1, 0, min(n, 400))
        amp[i0:i1] = shape
    freq[freq == 0] = 40
    phase = 2 * np.pi * np.cumsum(freq) / SR
    # the octave partial keeps the bass audible on phone and laptop speakers
    wave = (np.sin(phase) + 0.32 * np.sin(2 * phase)) * amp
    wave = np.tanh(wave * 2.6) / np.tanh(2.6)
    return butter(wave, 3000, "low") * 0.62


def riser(dur):
    n = int(dur * SR)
    t = np.arange(n) / SR
    noise = rng.standard_normal(n)
    out = np.zeros(n)
    state = 0.0
    coef = 0.002 + 0.5 * (t / dur) ** 3
    for i in range(n):  # one-pole low-pass with an opening cutoff
        state += coef[i] * (noise[i] - state)
        out[i] = state
    sweep = np.sin(2 * np.pi * np.cumsum(180 * (9 ** (t / dur))) / SR) * 0.15
    return (out * 0.5 + sweep) * (t / dur) ** 2 * 0.3


def impact():
    n = int(2.6 * SR)
    t = np.arange(n) / SR
    boom = np.sin(2 * np.pi * np.cumsum(34 + 40 * np.exp(-t / 0.08)) / SR) * np.exp(-t / 0.7)
    crash = butter(rng.standard_normal(n), 2600, "high") * np.exp(-t / 0.5) * 0.22
    return np.tanh(boom * 2.2) * 0.6 + crash


def reverb(stereo, seconds=2.2, wet=0.3):
    n = int(seconds * SR)
    t = np.arange(n) / SR
    ir = rng.standard_normal((n, 2)) * np.exp(-t / (seconds / 5.5))[:, None]
    ir = butter(butter(ir, 5200, "low"), 250, "high")
    ir /= np.sqrt((ir**2).sum(axis=0))
    out = np.stack([signal.fftconvolve(stereo[:, c], ir[:, c])[:N] for c in (0, 1)], axis=1)
    return stereo + out * wet


# ------------------------------------------------------------------- patterns
F, AB, C, DB, G, E, BB = 53, 56, 60, 61, 55, 52, 58  # F3.. as MIDI anchors
LOOP = [  # 4-bar piano loop, one entry per 8th note (None = rest)
    [72, 68, 65, 68, 72, 68, 67, 68],
    [72, 68, 65, 68, 73, 72, 68, None],
    [73, 68, 65, 68, 73, 68, 65, 68],
    [72, 67, 64, 67, 70, 67, 64, None],
]
CHORDS = [[53, 56, 60], [53, 56, 60], [49, 53, 56], [48, 52, 55, 58]]
BASS = [  # per bar of the loop: (step, note, slide_to, slide_at_seconds)
    [(0, 29, None, 0), (6, 29, None, 0), (10, 29, 32, 0.12)],
    [(0, 29, None, 0), (3, 29, None, 0), (6, 29, None, 0), (11, 41, 29, 0.05)],
    [(0, 37, None, 0), (6, 37, None, 0), (10, 37, None, 0)],
    [(0, 36, None, 0), (8, 36, None, 0), (14, 36, 31, 0.06)],
]
COUNTER = {0: [(0, 84), (6, 80), (12, 79)], 2: [(0, 85), (6, 80), (12, 77)], 3: [(4, 79), (10, 76)]}

keys = np.zeros((N, 2))
pads = np.zeros((N, 2))
drums = np.zeros((N, 2))
hats = np.zeros((N, 2))
fx = np.zeros((N, 2))
bass_events = []
beatmap = {"kicks": [], "snares": [], "hats": [], "rolls": []}

K, S, CL = kick(), snare(), clap()

for bar in range(BARS):
    sec = section_of(bar)
    loop_bar = bar % 4
    full = sec in ("drop_a", "drop_b")
    drums_on = full or sec == "verse" or (sec == "outro" and bar < 32)
    last_verse_bar = bar == 19

    # keys
    octave = -12 if sec == "verse" else 0
    for i, note in enumerate(LOOP[loop_bar]):
        if note is None or (last_verse_bar and i >= 4):
            continue
        vel = 0.95 if i % 4 == 0 else 0.72 + rng.uniform(-0.06, 0.06)
        place(keys, piano(note + octave, vel=vel), t_of(bar, i * 2) + rng.uniform(0, 0.004), pan=-0.15 + 0.3 * (i % 2))
    if sec == "drop_b" and loop_bar in COUNTER:
        for step, note in COUNTER[loop_bar]:
            place(keys, bell(note), t_of(bar, step), pan=0.35)
    if not last_verse_bar:
        place_len = BAR + 0.3
        seg = pad(CHORDS[loop_bar], place_len)
        i = int(t_of(bar) * SR)
        pads[i : i + len(seg)] += seg[: N - i]

    if not drums_on:
        continue

    # 808 + kick
    pattern = BASS[loop_bar] if sec != "verse" else [BASS[loop_bar][0], BASS[loop_bar][-1]]
    for step, note, slide_to, slide_at in pattern:
        if last_verse_bar and step >= 8:
            continue
        t = t_of(bar, step)
        bass_events.append((t, note, slide_to, slide_at))
        place(drums, K, t)
        beatmap["kicks"].append(round(t, 4))

    # snare: drill placement, beat 3 then beat 4 of the following bar
    snare_step = 8 if bar % 2 == 0 else 12
    if not (last_verse_bar and snare_step >= 8):
        t = t_of(bar, snare_step)
        place(drums, S, t)
        place(drums, CL, t, pan=0.1)
        beatmap["snares"].append(round(t, 4))
    if full and loop_bar == 3:
        place(drums, S, t_of(bar, 15), gain=0.45)

    # hats
    steps = [0, 3, 6, 8, 11, 14] if sec != "verse" else [0, 4, 8, 12, 14]
    for step in steps:
        if last_verse_bar and step >= 8:
            continue
        t = t_of(bar, step)
        place(hats, hat(), t, gain=1.0 if step in (0, 8) else 0.7, pan=0.25)
        beatmap["hats"].append(round(t, 4))
    if full and loop_bar in (1, 3):  # 32nd-note roll with rising pitch
        beatmap["rolls"].append([round(t_of(bar, 12), 4), round(t_of(bar, 16), 4)])
        for j in range(8):
            place(hats, hat(pitch=1 + j * 0.035), t_of(bar, 12 + j * 0.5), gain=0.35 + j * 0.06, pan=-0.3 + j * 0.08)
    if full and loop_bar == 3:
        place(hats, hat(open_=True), t_of(bar, 14), gain=0.8, pan=-0.2)

# transitions
for drop_bar in (4, 22):
    r = riser(BAR)
    place(fx, r, t_of(drop_bar - 1), pan=0.0)
    place(fx, impact(), t_of(drop_bar))
place(fx, impact(), t_of(0), gain=0.55)
place(fx, impact(), t_of(32), gain=0.8)

# vinyl crackle under intro, break and outro
crackle = np.zeros(N)
crackle[rng.integers(0, N, 2600)] = rng.uniform(-1, 1, 2600)
crackle = butter(crackle, [1200, 7000], "band") * 0.9
gate = np.zeros(N)
for name, start, count in SECTIONS:
    if name in ("intro", "break", "outro"):
        gate[int(t_of(start) * SR) : int(t_of(start + count) * SR)] = 1.0
fx[:, 0] += crackle * gate
fx[:, 1] += np.roll(crackle, 211) * gate

# ------------------------------------------------------------------------ mix
bass = bass808(bass_events)

duck = np.ones(N)  # sidechain keys/pad to the kick
for t in beatmap["kicks"]:
    i = int(t * SR)
    n = min(int(0.3 * SR), N - i)
    duck[i : i + n] = np.minimum(duck[i : i + n], 1 - 0.55 * np.exp(-np.arange(n) / SR / 0.09))

keys = reverb(keys, 2.6, 0.38)
# intro and break sit behind a low-pass, as if heard through a wall
muffled = butter(keys, 1100, "low", 4)
blend = np.zeros(N)
for name, start, count in SECTIONS:
    if name in ("intro", "break"):
        a, b = int(t_of(start) * SR), int(t_of(start + count) * SR)
        blend[a:b] = np.linspace(1.0, 0.35, b - a)
keys = keys * (1 - blend[:, None]) + muffled * blend[:, None] * 1.25

drums = reverb(drums, 0.7, 0.08)
mix = (keys * 1.15 + pads) * duck[:, None] + drums * 1.15 + hats * 3.0 + reverb(fx, 2.4, 0.3)
mix[:, 0] += bass
mix[:, 1] += bass
mix = butter(mix, 28, "high")
mix += 0.45 * butter(mix, 5000, "high")  # air shelf
end = int(BARS * BAR * SR)
mix[end:] *= np.linspace(1, 0, N - end)[:, None] ** 1.5
mix = np.tanh(mix * 0.8)  # glue + soft limiter
mix /= np.abs(mix).max() / 0.86

beatmap.update(
    {
        "bpm": BPM,
        "bar_sec": BAR,
        "beat_sec": BEAT,
        "duration_sec": round(TOTAL, 4),
        "sections": [{"id": n, "start": round(t_of(s), 4), "end": round(t_of(s + c), 4), "bars": c} for n, s, c in SECTIONS],
        "impacts": [round(t_of(b), 4) for b in (0, 4, 22, 32)],
        "hard_stop": [round(t_of(19, 8), 4), round(t_of(20), 4)],
    }
)

out_wav, out_map = sys.argv[1], sys.argv[2]
from scipy.io import wavfile  # noqa: E402

wavfile.write(out_wav, SR, (mix * 32767).astype(np.int16))
with open(out_map, "w") as fh:
    json.dump(beatmap, fh, indent=1)
print(f"wrote {out_wav} ({TOTAL:.2f}s) and {out_map}")

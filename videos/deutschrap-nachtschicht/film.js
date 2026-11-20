/*
 * NACHTSCHICHT film layer.
 *
 * One WebGL2 canvas renders every shot: a still plate is pushed through a
 * depth-map camera (parallax + dolly), then type that sits BEHIND the subject
 * (occluded by the depth map), then atmosphere (bloom, depth-aware fog, rain,
 * dust, light flicker), then the grade.
 *
 * Every pixel is a pure function of the composition time, so any frame can be
 * rendered in any order. HyperFrames drives it through the "hf-seek" event.
 */
(() => {
  const W = 1920;
  const H = 1080;
  const FPS = 30;
  const BEATMAP = window.NACHTSCHICHT_BEATMAP;
  const BAR = BEATMAP.bar_sec;
  const DURATION = 60;
  const bars = (n) => n * BAR;

  const BONE = [0.94, 0.91, 0.85];
  const AMBER = [1.0, 0.66, 0.06];

  // Per-plate look: where the focal plane sits, where type slots in between
  // subject and background (about half the subject's depth; scripts/prep_stills.py
  // prints the split of each map as a starting point), and which atmosphere
  // the location has.
  const PLATES = {
    skyline: { focus: 0.12, textDepth: 0.12, fog: 0.55, fogColor: [0.55, 0.43, 0.3], rain: 0.45 },
    stairwell: {
      focus: 0.3,
      textDepth: 0.3,
      fog: 0.12,
      fogColor: [0.3, 0.45, 0.4],
      flicker: 1,
      dust: 0.5,
    },
    block_suv: { focus: 0.25, textDepth: 0.28, fog: 0.5, fogColor: [0.5, 0.42, 0.34], rain: 0.8 },
    coupe: { focus: 0.4, textDepth: 0.25, fog: 0.45, fogColor: [0.45, 0.55, 0.68], bloom: 1.5 },
    taillights: {
      focus: 0.4,
      textDepth: 0.1,
      fog: 0.6,
      fogColor: [0.7, 0.16, 0.1],
      bloom: 1.4,
      drift: [0.01, -0.05],
    },
    chain: { focus: 0.6, textDepth: 0.43, fog: 0.0, bloom: 0.9, dust: 0.3 },
    doberman: { focus: 0.6, textDepth: 0.42, fog: 0.4, fogColor: [0.5, 0.4, 0.3], rain: 0.5 },
    cash: { focus: 0.55, textDepth: 0.2, fog: 0.2, fogColor: [0.5, 0.42, 0.32], dust: 0.9 },
    ubahn: { focus: 0.3, textDepth: 0.45, fog: 0.15, fogColor: [0.5, 0.5, 0.3], bloom: 1.1 },
    watch: { focus: 0.6, textDepth: 0.47, fog: 0.0, bloom: 1.0, dust: 0.3 },
    tunnel: { focus: 0.25, textDepth: 0.54, fog: 0.5, fogColor: [0.6, 0.45, 0.25], flicker: 0.8 },
    kiosk: {
      focus: 0.3,
      textDepth: 0.5,
      fog: 0.4,
      fogColor: [0.55, 0.3, 0.22],
      rain: 0.9,
      bloom: 1.2,
    },
    interior: { focus: 0.55, textDepth: 0.3, fog: 0.0, bloom: 1.2 },
    boxing: { focus: 0.4, textDepth: 0.3, fog: 0.25, fogColor: [0.5, 0.4, 0.28], dust: 1.0 },
    cage: { focus: 0.3, textDepth: 0.2, fog: 0.9, fogColor: [0.5, 0.55, 0.6], rain: 1.0 },
    shisha: {
      focus: 0.5,
      textDepth: 0.2,
      fog: 0.55,
      fogColor: [0.5, 0.4, 0.6],
      drift: [0.012, -0.06],
      dust: 0.4,
    },
    studio: {
      focus: 0.5,
      textDepth: 0.2,
      fog: 0.45,
      fogColor: [0.6, 0.42, 0.25],
      dust: 0.8,
      drift: [0.02, -0.02],
    },
  };

  const word = (str, o = {}) => ({
    kind: "word",
    str,
    width: 0.94,
    y: 0.47,
    color: BONE,
    behind: 1,
    ...o,
  });
  const marquee = (str, o = {}) => ({
    kind: "marquee",
    str,
    size: 300,
    y: 0.5,
    color: BONE,
    behind: 1,
    outline: true,
    scroll: 0.045,
    ...o,
  });

  const SHOTS = [];
  const shot = (plate, from, to, o = {}) =>
    SHOTS.push({ plate, t0: bars(from), t1: bars(to), ...PLATES[plate], ...o });
  // A burst of sixteenth-note flash frames that telegraphs the drop.
  const stutter = (from, frames) =>
    frames.forEach(([plate, treat], i) => {
      const a = from + i / 16;
      if (plate)
        shot(plate, a, a + 1 / 16, {
          treat,
          zoom: [1.12 + i * 0.03, 1.14 + i * 0.03],
          fog: 0,
          rain: 0,
        });
      else SHOTS.push({ plate: null, t0: bars(a), t1: bars(a + 1 / 16) });
    });

  // ---------------------------------------------------------------- INTRO
  shot("skyline", 0, 2, {
    zoom: [1.05, 1.11],
    cam: [
      [-0.012, 0.002],
      [0.012, -0.002],
    ],
  });
  shot("stairwell", 2, 3, {
    zoom: [1.04, 1.1],
    dolly: [0, 0.07],
    cam: [
      [0, 0.004],
      [0, -0.004],
    ],
  });
  shot("block_suv", 3, 3.5, {
    zoom: [1.06, 1.09],
    cam: [
      [-0.01, 0],
      [-0.002, 0],
    ],
  });
  stutter(3.5, [
    ["coupe", 3],
    ["taillights", 1],
    ["doberman", 3],
    ["cash", 4],
    ["chain", 4],
    ["watch", 3],
    ["coupe", 4],
    [null, 0],
  ]);

  // --------------------------------------------------------------- DROP A
  shot("coupe", 4, 6, {
    zoom: [1.34, 1.07],
    center: [0.5, 0.43],
    ease: "expoOut",
    cam: [
      [0.014, 0],
      [-0.012, 0],
    ],
    text: word("NACHTSCHICHT", { y: 0.3, width: 0.9 }),
    punch: 1,
  });
  shot("taillights", 6, 7, {
    zoom: [1.08, 1.15],
    cam: [
      [-0.012, 0.003],
      [0.01, 0],
    ],
    text: word("BENZIN", { y: 0.72, width: 0.4, x: 0.755, behind: 0 }),
    punch: 1,
  });
  shot("chain", 7, 8, {
    zoom: [1.1, 1.2],
    cam: [
      [0.014, 0],
      [-0.008, 0.004],
    ],
    text: word("KARAT", { y: 0.5, width: 0.9, color: AMBER, behind: 0, outline: true }),
    punch: 1,
  });
  shot("doberman", 8, 9, {
    zoom: [1.05, 1.17],
    dolly: [0, 0.05],
    cam: [
      [-0.008, 0],
      [0.008, 0],
    ],
    text: word("LOYAL", { y: 0.42, width: 0.42, x: 0.765 }),
    punch: 1,
  });
  shot("cash", 9, 10, {
    zoom: [1.14, 1.06],
    cam: [
      [0.012, 0],
      [-0.012, 0.003],
    ],
    text: word("BARGELD", { y: 0.72, width: 0.44, x: 0.735, color: AMBER, behind: 0 }),
    punch: 1,
  });
  shot("ubahn", 10, 11, {
    zoom: [1.06, 1.16],
    dolly: [0, 0.06],
    cam: [
      [0.014, 0],
      [-0.01, 0],
    ],
    text: word("UNTERGRUND", { y: 0.4, width: 0.9, depth: 0.62 }),
    punch: 1,
  });
  shot("watch", 11, 12, {
    zoom: [1.1, 1.24],
    cam: [
      [-0.012, 0],
      [0.01, 0.004],
    ],
    text: word("KEINE ZEIT", { y: 0.5, width: 0.92, behind: 0, outline: true }),
    punch: 1,
  });

  // ---------------------------------------------------------------- VERSE
  shot("tunnel", 12, 14, {
    zoom: [1.04, 1.16],
    dolly: [0, 0.12],
    cam: [
      [0.004, 0],
      [-0.004, 0],
    ],
    text: marquee("VON UNTEN NACH OBEN", { y: 0.46, depth: 0.72 }),
  });
  shot("kiosk", 14, 16, {
    zoom: [1.09, 1.09],
    cam: [
      [0.02, 0],
      [-0.02, 0],
    ],
    text: marquee("KEIN SCHLAF", { y: 0.3, size: 240, outline: false, depth: 0.42, scroll: -0.04 }),
  });
  shot("interior", 16, 18, {
    zoom: [1.03, 1.15],
    dolly: [0, 0.08],
    cam: [
      [-0.006, 0.002],
      [0.006, -0.002],
    ],
    text: word("NACHTFAHRT", { y: 0.24, width: 0.56, depth: 0.3 }),
  });
  shot("boxing", 18, 19.5, {
    zoom: [1.06, 1.14],
    cam: [
      [0.012, 0],
      [-0.006, 0],
    ],
    text: marquee("KEINE PAUSE", { y: 0.42, scroll: 0.05 }),
  });
  SHOTS.push({ plate: null, t0: bars(19.5), t1: bars(20) }); // hard stop: the beat cuts out, so does the picture

  // ---------------------------------------------------------------- BREAK
  shot("cage", 20, 21.5, {
    zoom: [1.04, 1.1],
    cam: [
      [-0.01, 0],
      [0.01, 0],
    ],
  });
  stutter(21.5, [
    ["doberman", 3],
    ["block_suv", 0],
    ["taillights", 1],
    ["watch", 4],
    ["coupe", 3],
    ["cash", 4],
    ["doberman", 1],
    [null, 0],
  ]);

  // --------------------------------------------------------------- DROP B
  shot("block_suv", 22, 23, {
    zoom: [1.3, 1.08],
    ease: "expoOut",
    cam: [
      [-0.012, 0],
      [0.012, 0],
    ],
    text: word("NACHTSCHICHT", { y: 0.34, width: 0.9 }),
    punch: 1.4,
  });
  const half = (plate, at, o) => shot(plate, at, at + 0.5, { punch: 1.4, ...o });
  half("doberman", 23, {
    zoom: [1.55, 1.7],
    center: [0.44, 0.33],
    treat: 3,
    text: word("LOYAL", { y: 0.5, width: 0.44, x: 0.77 }),
  });
  half("taillights", 23.5, {
    zoom: [1.1, 1.18],
    mirror: 1,
    treat: 1,
    text: word("BENZIN", { y: 0.5, width: 0.9, behind: 0, outline: true }),
  });
  half("coupe", 24, {
    zoom: [1.5, 1.34],
    center: [0.5, 0.52],
    text: word("BLOCK", { y: 0.5, width: 0.92, behind: 0, outline: true }),
  });
  half("chain", 24.5, {
    zoom: [1.3, 1.42],
    center: [0.45, 0.55],
    treat: 4,
    text: word("KARAT", { y: 0.5, width: 0.9, behind: 0, outline: true }),
  });
  half("cash", 25, {
    zoom: [1.2, 1.3],
    text: word("BARGELD", { y: 0.5, width: 0.94, color: AMBER, behind: 0, outline: true }),
  });
  half("watch", 25.5, {
    zoom: [1.3, 1.5],
    center: [0.52, 0.52],
    text: word("KEINE ZEIT", { y: 0.5, width: 0.92, behind: 0, outline: true, color: AMBER }),
  });
  half("ubahn", 26, {
    zoom: [1.1, 1.2],
    mirror: 1,
    dolly: [0, 0.08],
    text: word("UNTERGRUND", { y: 0.4, width: 0.9, depth: 0.62 }),
  });
  half("tunnel", 26.5, {
    zoom: [1.1, 1.26],
    dolly: [0, 0.1],
    treat: 3,
    text: word("BETON", { y: 0.46, width: 0.8, depth: 0.72 }),
  });
  half("kiosk", 27, {
    zoom: [1.12, 1.2],
    cam: [
      [0.02, 0],
      [0, 0],
    ],
    text: word("KIEZ", { y: 0.36, width: 0.5, color: AMBER }),
  });
  half("shisha", 27.5, {
    zoom: [1.1, 1.22],
    text: word("RAUCH", { y: 0.42, width: 0.5, x: 0.35 }),
  });
  half("skyline", 28, { zoom: [1.16, 1.08], text: word("BERLIN", { y: 0.36, width: 0.86 }) });
  half("stairwell", 28.5, {
    zoom: [1.08, 1.2],
    dolly: [0, 0.08],
    treat: 3,
    text: word("BLOCK", { y: 0.47, width: 0.74, depth: 0.82 }),
  });
  half("boxing", 29, {
    zoom: [1.1, 1.2],
    text: word("DISZIPLIN", { y: 0.42, width: 0.42, x: 0.66 }),
  });
  shot("interior", 29.5, 29.75, { zoom: [1.1, 1.16], punch: 1.4 });
  shot("cage", 29.75, 30, { zoom: [1.1, 1.16], punch: 1.4, treat: 3 });

  // ---------------------------------------------------------------- OUTRO
  shot("shisha", 30, 32, {
    zoom: [1.05, 1.13],
    cam: [
      [0.01, 0],
      [-0.01, 0.003],
    ],
  });
  shot("studio", 32, DURATION / BAR, {
    zoom: [1.04, 1.13],
    dolly: [0, 0.05],
    cam: [
      [0.008, 0],
      [-0.008, 0],
    ],
  });

  // ------------------------------------------------------------- timing
  const lerp = (a, b, u) => a + (b - a) * u;
  const clamp01 = (x) => Math.min(1, Math.max(0, x));
  const smooth = (a, b, x) => {
    const u = clamp01((x - a) / (b - a));
    return u * u * (3 - 2 * u);
  };
  const EASES = {
    lin: (u) => u,
    inOut: (u) => u * u * (3 - 2 * u),
    expoOut: (u) => 1 - Math.pow(2, -9 * u) * (1 - u),
  };
  // Decaying envelope since the latest event at or before t.
  const envelope = (times, t, tau) => {
    let lo = 0;
    let hi = times.length - 1;
    let last = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (times[mid] <= t + 1e-6) {
        last = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return last < 0 ? 0 : Math.exp(-(t - times[last]) / tau);
  };
  const shotAt = (t) => {
    for (let i = SHOTS.length - 1; i >= 0; i--) if (t >= SHOTS[i].t0 - 1e-6) return i;
    return 0;
  };

  // ---------------------------------------------------------------- WebGL
  const canvas = document.getElementById("film");
  canvas.width = W;
  canvas.height = H;
  const gl = canvas.getContext("webgl2", {
    antialias: false,
    alpha: false,
    preserveDrawingBuffer: true,
  });

  const VERT = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = vec2(aPos.x * 0.5 + 0.5, 0.5 - aPos.y * 0.5);
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

  const FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uPlate, uDepth, uText, uGlow;
uniform vec2 uRes, uCenter, uCam, uShake, uFogDrift, uTextShift;
uniform float uT, uSeed, uZoom, uDolly, uFocus, uMirror;
uniform float uTextAlpha, uTextDepth, uTextBehind, uTextScale;
uniform vec3 uTextColor, uFogColor;
uniform float uFog, uRain, uDust, uFlicker, uPulse, uSnare, uBloom, uFlash, uFade, uBlank;
uniform int uTreat;

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * noise(p); p = p * 2.03 + 7.1; a *= 0.5; }
  return v;
}
float rainLayer(vec2 uv, float scale, float speed) {
  vec2 g = vec2(uv.x * scale + uv.y * scale * 0.1, uv.y * scale * 0.11 - uT * speed);
  vec2 id = floor(g), f = fract(g);
  float h = hash(id);
  float x = abs(f.x - 0.5 - (h - 0.5) * 0.7);
  return smoothstep(0.035, 0.0, x) * smoothstep(0.0, 0.25, f.y) * smoothstep(1.0, 0.45, f.y) * step(0.5, h);
}
float dustLayer(vec2 uv, float s, float k) {
  vec2 g = uv * vec2(s * 1.78, s) + vec2(uT * 0.022 * k, -uT * 0.016 * k);
  vec2 id = floor(g), f = fract(g) - 0.5;
  vec2 o = vec2(hash(id), hash(id + 7.3)) - 0.5;
  float tw = 0.5 + 0.5 * sin(uT * 1.3 + hash(id + 2.1) * 6.283);
  return smoothstep(0.04, 0.0, length(f - o * 0.7)) * tw * step(0.55, hash(id + 4.0));
}
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

void main() {
  vec2 c = vUv - 0.5;
  // the 2.39:1 letterbox bars cover everything outside this band
  if (abs(c.y) > 0.376) { outColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  if (uBlank > 0.5) { outColor = vec4(vec3(hash(vUv * uRes + uSeed) * 0.012), 1.0); return; }

  // camera: zoom about a plate point, then let depth push pixels (parallax + dolly)
  vec2 p = c / uZoom + uCenter + uShake;
  if (uMirror > 0.5) p.x = 0.5 - abs(p.x - 0.5);
  vec2 q = p;
  for (int i = 0; i < 3; i++) {
    float di = texture(uDepth, q).r;
    q = p + (di - uFocus) * (uCam + (p - uCenter) * uDolly);
  }
  float d = texture(uDepth, q).r;

  // lens: chromatic aberration grows toward the corners and kicks on the snare
  vec2 ab = c * (0.0012 + uSnare * 0.007) * (0.5 + 3.0 * dot(c, c));
  vec3 col = vec3(texture(uPlate, q + ab).r, texture(uPlate, q).g, texture(uPlate, q - ab).b);

  // halation around practical lights + anamorphic streaks, baked per plate
  vec3 glow = texture(uGlow, q).rgb;
  // type that lives in the scene: a plane at uTextDepth, hidden by anything
  // nearer and shadowed by the subject in front of it
  float cover = 0.0;
  if (uTextAlpha > 0.001) {
    vec2 tuv = (vUv - 0.5) / uTextScale + 0.5 + uTextShift + (uTextDepth - uFocus) * uCam * uZoom;
    float ta = texture(uText, tuv).a;
    float occ = smoothstep(uTextDepth - 0.05, uTextDepth + 0.05, d);
    float shade = 0.0;
    for (int i = 0; i < 3; i++) {
      float a = float(i) * 2.0944 + 0.6;
      vec2 o = vec2(cos(a), sin(a) * uRes.x / uRes.y) * 0.011 + vec2(0.006, -0.012);
      shade += smoothstep(uTextDepth - 0.05, uTextDepth + 0.05, texture(uDepth, q + o).r) * 1.3333;
    }
    ta *= mix(1.0, 1.0 - occ, uTextBehind);
    vec3 ink = uTextColor * (1.0 - 0.16 * uTextBehind * shade);
    col = mix(col, ink, ta * uTextAlpha);
    cover = ta * uTextAlpha;
  }
  // lights hidden behind a letter do not bloom through it
  float beat = (1.0 + uPulse * 0.9) * (1.0 - 0.8 * cover);
  col += glow * 0.42 * uBloom * beat;

  // atmosphere: fog thickens with distance and drifts, then rain and dust
  float n = fbm(vec2(p.x * 2.6, p.y * 4.2) + uFogDrift * uT + d * 2.0);
  float fog = uFog * pow(1.0 - d, 1.3) * smoothstep(0.3, 0.85, n);
  col += uFogColor * fog * (1.0 - col);
  col += vec3(0.62, 0.7, 0.8) * (rainLayer(vUv, 95.0, 2.7) * 0.1 + rainLayer(vUv + 0.31, 160.0, 3.6) * 0.06) * uRain;
  col += vec3(1.0, 0.86, 0.66) * (dustLayer(vUv, 9.0, 1.0) + dustLayer(vUv + 0.4, 15.0, 1.7)) * 0.16 * uDust * (0.25 + luma(col));

  // exposure: beat pulse and dying fluorescent tubes
  float tube = step(0.87, hash(vec2(floor(uT * 18.0), 3.1))) + 0.5 * step(0.93, hash(vec2(floor(uT * 31.0), 9.7)));
  col *= (1.0 + uPulse * 0.1) * (1.0 - uFlicker * 0.2 * min(tube, 1.0));

  // grade
  col = max(col, 0.0);
  float l = luma(col);
  col = mix(vec3(l), col, 1.08);
  col = mix(col, smoothstep(vec3(0.0), vec3(1.0), col), 0.3);
  col += (1.0 - l) * (1.0 - l) * vec3(-0.012, 0.004, 0.016) + l * l * vec3(0.02, 0.008, -0.016);
  l = luma(col);
  if (uTreat == 1) col = mix(mix(vec3(0.03, 0.0, 0.0), vec3(1.0, 0.1, 0.06), pow(l, 0.8)), vec3(1.0), smoothstep(0.7, 1.0, l));
  else if (uTreat == 3) col = vec3(smoothstep(0.05, 0.72, l));
  else if (uTreat == 4) col = mix(mix(vec3(0.02, 0.01, 0.0), vec3(1.0, 0.66, 0.06), pow(l, 0.85)), vec3(1.0), smoothstep(0.75, 1.0, l));

  col *= 1.0 - 0.6 * pow(length(c * vec2(1.0, 0.8)) * 1.22, 2.6);
  col += (hash(vUv * uRes + uSeed * 17.13) - 0.5) * 0.07 * (1.0 - luma(col) * 0.6);
  col = mix(col, vec3(1.0, 0.97, 0.9), uFlash);
  col *= 1.0 - uFade;
  outColor = vec4(col, 1.0);
}`;

  const compile = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  gl.useProgram(prog);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(prog, "aPos");
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
  gl.viewport(0, 0, W, H);

  const loc = new Proxy(
    {},
    { get: (cache, name) => (cache[name] ??= gl.getUniformLocation(prog, name)) },
  );
  const makeTexture = (source, wrapS) => {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrapS || gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  };

  // ----------------------------------------------------------------- type
  const textCanvas = document.createElement("canvas");
  textCanvas.width = W;
  textCanvas.height = H;
  const tctx = textCanvas.getContext("2d");
  const textTexture = makeTexture(textCanvas, gl.REPEAT);
  let textKey = null;
  const drawText = (spec) => {
    const key = spec ? JSON.stringify(spec) : "";
    if (key === textKey) return;
    textKey = key;
    tctx.clearRect(0, 0, W, H);
    if (spec) {
      tctx.fillStyle = "#fff";
      tctx.strokeStyle = "#fff";
      tctx.textBaseline = "alphabetic";
      let size = spec.size || 100;
      let text = spec.str;
      tctx.font = `${size}px Anton`;
      if (spec.kind === "marquee") {
        // repeat the phrase so one texture width holds whole copies and wraps seamlessly
        const unit = `${spec.str}  —  `;
        const copies = Math.max(1, Math.round(W / tctx.measureText(unit).width));
        size *= W / (tctx.measureText(unit).width * copies);
        text = unit.repeat(copies);
        tctx.textAlign = "left";
      } else {
        size = Math.min(560, (size * spec.width * W) / tctx.measureText(text).width);
        tctx.textAlign = "center";
      }
      tctx.font = `${size}px Anton`;
      const x = spec.kind === "marquee" ? 0 : (spec.x ?? 0.5) * W;
      // centre the capitals on spec.y and keep them clear of the letterbox bars
      const m = tctx.measureText(text);
      const capHeight = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
      const top = Math.min(Math.max(spec.y * H - capHeight / 2, 0.152 * H), 0.85 * H - capHeight);
      const baseline = top + m.actualBoundingBoxAscent;
      if (spec.outline) {
        tctx.lineWidth = Math.max(4, size * 0.024);
        tctx.lineJoin = "round";
        tctx.strokeText(text, x, baseline);
      } else tctx.fillText(text, x, baseline);
    }
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, textTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, textCanvas);
  };

  // --------------------------------------------------------------- render
  const textures = {};
  const hud = { tc: document.getElementById("hud-tc"), shot: document.getElementById("hud-shot") };
  const pad = (n) => String(n).padStart(2, "0");
  let lastTime = null;

  const renderAt = (time) => {
    const t = Math.min(Math.max(time, 0), DURATION - 1e-4);
    if (t === lastTime) return;
    lastTime = t;
    const frame = Math.round(t * FPS);
    const index = shotAt(t);
    const s = SHOTS[index];

    const kick = envelope(BEATMAP.kicks, t, 0.11);
    const snare = envelope(BEATMAP.snares, t, 0.09);
    const impactTimes = BEATMAP.impacts;
    const impact = Math.max(
      envelope([impactTimes[1], impactTimes[2]], t, 0.13),
      0.6 * envelope([impactTimes[3]], t, 0.2),
    );
    const fadeIn = 1 - smooth(0.05, 1.3, t);
    const fadeOut = smooth(DURATION - 2.0, DURATION - 0.5, t);

    const set1 = (name, v) => gl.uniform1f(loc[name], v);
    set1("uBlank", s.plate ? 0 : 1);
    set1("uSeed", frame);
    set1("uT", t);
    gl.uniform2f(loc.uRes, W, H);
    set1("uFade", Math.max(fadeIn, fadeOut));

    if (s.plate) {
      const u = EASES[s.ease || "lin"](clamp01((t - s.t0) / (s.t1 - s.t0)));
      const punch = (s.punch || 0) * kick;
      // Hat rolls ratchet the camera in on every 32nd note and smear the lens.
      // Deliberately no brightness strobe: at this tempo it would flash at ~19 Hz.
      const treat = s.treat || 0;
      let roll = 0;
      for (const [a, b] of BEATMAP.rolls) {
        if (t >= a && t < b) roll = 1 + Math.floor((t - a) / (BAR / 32));
      }
      const zoom = lerp(s.zoom[0], s.zoom[1], u) * (1 + 0.02 * punch + 0.011 * roll);
      const cam = s.cam || [
        [0, 0],
        [0, 0],
      ];
      const sway = [0.0014 * Math.sin(t * 1.7 + index), 0.0011 * Math.sin(t * 2.3 + index * 1.3)];
      const dolly = s.dolly ? lerp(s.dolly[0], s.dolly[1], u) : 0;
      const center = s.center || [0.5, 0.5];

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, textures[s.plate].plate);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, textures[s.plate].depth);
      gl.activeTexture(gl.TEXTURE3);
      gl.bindTexture(gl.TEXTURE_2D, textures[s.plate].glow);
      drawText(s.text || null);
      gl.uniform1i(loc.uPlate, 0);
      gl.uniform1i(loc.uDepth, 1);
      gl.uniform1i(loc.uText, 2);
      gl.uniform1i(loc.uGlow, 3);

      gl.uniform2f(loc.uCenter, center[0], center[1]);
      gl.uniform2f(
        loc.uCam,
        lerp(cam[0][0], cam[1][0], u) + sway[0],
        lerp(cam[0][1], cam[1][1], u) + sway[1],
      );
      gl.uniform2f(
        loc.uShake,
        impact * 0.007 * Math.sin(t * 93),
        impact * 0.007 * Math.cos(t * 71),
      );
      set1("uZoom", zoom);
      set1("uDolly", dolly);
      set1("uFocus", s.focus);
      set1("uMirror", s.mirror || 0);
      set1("uFog", s.fog || 0);
      gl.uniform3fv(loc.uFogColor, s.fogColor || [0.5, 0.5, 0.5]);
      gl.uniform2fv(loc.uFogDrift, s.drift || [0.035, -0.008]);
      set1("uRain", s.rain || 0);
      set1("uDust", s.dust || 0);
      set1("uFlicker", s.flicker || 0);
      set1("uBloom", s.bloom || 1);
      set1("uPulse", punch);
      set1("uSnare", Math.min(1.4, (s.punch ? snare : snare * 0.35) + 0.14 * roll));
      set1("uFlash", impact * 0.8);
      gl.uniform1i(loc.uTreat, treat);

      const text = s.text;
      set1("uTextAlpha", text ? 0.94 : 0);
      if (text) {
        set1("uTextDepth", text.depth ?? s.textDepth);
        set1("uTextBehind", text.behind);
        set1("uTextScale", lerp(1.0, 1.04, u) * (1 + 0.012 * punch));
        gl.uniform3fv(loc.uTextColor, text.color);
        gl.uniform2f(loc.uTextShift, text.scroll ? text.scroll * (t - s.t0) : 0, 0);
      }
    }
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    if (hud.tc)
      hud.tc.textContent = `TC 00:${pad(Math.floor(t / 60))}:${pad(Math.floor(t) % 60)}:${pad(frame % FPS)}`;
    if (hud.shot) hud.shot.textContent = `SZENE ${pad(index + 1)}/${pad(SHOTS.length)}`;
  };

  // ----------------------------------------------------------------- boot
  const loadImage = (src) =>
    new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`failed to load ${src}`));
      img.src = src;
    });
  const ready = (async () => {
    await Promise.all([
      document.fonts.load("100px Anton"),
      document.fonts.load("16px 'JetBrains Mono'"),
    ]);
    await Promise.all(
      Object.keys(PLATES).map(async (name) => {
        const [plate, depth, glow] = await Promise.all([
          loadImage(`assets/plates/${name}.jpg`),
          loadImage(`assets/depth/${name}.png`),
          loadImage(`assets/glow/${name}.jpg`),
        ]);
        textures[name] = {
          plate: makeTexture(plate),
          depth: makeTexture(depth),
          glow: makeTexture(glow),
        };
      }),
    );
    renderAt(window.__hfThreeTime || 0);
  })();

  // tell the runtime the film is not drawable until fonts and plates are in
  window.__hf = window.__hf || {};
  window.__hf.buildReady = window.__hf.buildReady || {};
  window.__hf.buildReady.film = ready;

  window.addEventListener("hf-seek", (event) => {
    if (Object.keys(textures).length === Object.keys(PLATES).length) renderAt(event.detail.time);
  });
  window.NACHTSCHICHT = { ready, renderAt, bars, BAR, DURATION, SHOTS };
})();

/** Original procedural scenes. All loops have fixed WebGL 1 compatible bounds. */
export const playfulGLSL = `
float playful_hash(float n) {
  return fract(sin(n * 127.1 + 311.7) * 43758.5453);
}

float playful_hash2(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

vec3 playful_palette(float hue) {
  return 0.52 + 0.48 * cos(6.2831853 * (hue + vec3(0.0, 0.666667, 0.333333)));
}

vec2 playful_rotate(vec2 p, float angle) {
  float c = cos(angle);
  float s = sin(angle);
  return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
}

vec3 playful_confetti(vec2 uv, float time) {
  vec2 p = uv * vec2(1.777778, 1.0);
  vec3 color = vec3(0.012, 0.008, 0.028);
  for (int i = 0; i < 24; i++) {
    float fi = float(i);
    float seed = playful_hash(fi + 17.0);
    float phase = time * (0.045 + seed * 0.035) + playful_hash(fi + 92.0);
    vec2 center = vec2(
      playful_hash(fi + 7.0) * 1.95 - 0.08 + 0.07 * sin(phase * 5.0 + fi),
      fract(phase) * 1.35 - 0.17
    );
    vec2 q = playful_rotate(p - center, fi * 2.4 + time * (0.35 + seed));
    float size = 0.014 + 0.021 * playful_hash(fi + 54.0);
    vec2 halfSize = vec2(size * (0.30 + 0.70 * abs(sin(time * 0.7 + fi))), size * 0.58);
    float distanceToPaper = max(abs(q.x) - halfSize.x, abs(q.y) - halfSize.y);
    float paper = 1.0 - smoothstep(-0.001, 0.0015, distanceToPaper);
    vec3 tint = playful_palette(fi * 0.618034);
    float fold = 0.68 + 0.32 * smoothstep(-halfSize.x, halfSize.x, q.x);
    color = mix(color, tint * fold + vec3(0.07), paper);
  }
  return color;
}

vec3 playful_bubbles(vec2 uv, float time) {
  vec2 p = uv * vec2(1.777778, 1.0);
  vec3 color = vec3(0.006, 0.019, 0.035) + vec3(0.0, 0.015, 0.025) * (1.0 - uv.y);
  for (int i = 0; i < 16; i++) {
    float fi = float(i);
    float seed = playful_hash(fi + 31.0);
    float phase = time * (0.015 + seed * 0.018) + playful_hash(fi + 111.0);
    vec2 center = vec2(
      playful_hash(fi + 6.0) * 1.9 - 0.06 + 0.06 * sin(time * 0.24 + fi * 2.0),
      1.2 - fract(phase) * 1.4
    );
    float radius = 0.044 + 0.082 * seed;
    vec2 q = p - center;
    float radial = length(q);
    float edge = abs(radial - radius);
    float rim = exp(-edge * edge / 0.000009);
    float outerGlow = exp(-edge * edge / 0.00013);
    float angle = atan(q.y, q.x + 0.000001);
    vec3 iridescence = playful_palette(angle * 0.30 + time * 0.035 + seed);
    float inside = 1.0 - smoothstep(radius * 0.82, radius, radial);
    color += iridescence * (rim * 0.58 + outerGlow * 0.07) + vec3(0.012, 0.024, 0.040) * inside;
    float highlight = exp(-pow((angle + 2.1) * 2.5, 2.0)) * rim;
    color += vec3(0.75, 0.91, 1.0) * highlight * 0.7;
  }
  return color;
}

vec3 playful_ribbons(vec2 uv, float time) {
  vec2 p = uv * vec2(1.777778, 1.0);
  vec3 color = vec3(0.012, 0.008, 0.027);
  for (int i = 0; i < 7; i++) {
    float fi = float(i);
    float center = 0.095 + fi * 0.135;
    center += 0.070 * sin(p.x * 3.2 - time * 0.32 + fi * 0.45);
    center += 0.028 * sin(p.x * 7.0 + time * 0.21 + fi * 0.8);
    float width = 0.025 + 0.017 * (0.5 + 0.5 * sin(p.x * 3.6 + time * 0.27 + fi));
    float d = (p.y - center) / width;
    float ribbon = 1.0 - smoothstep(0.94, 1.04, abs(d));
    float satin = 0.28 + 0.65 * pow(0.5 + 0.5 * cos(d * 2.6 + p.x * 1.5 - time * 0.2), 2.0);
    float sheen = exp(-pow(d - 0.55 * sin(p.x * 2.0 + fi), 2.0) * 75.0);
    vec3 tint = playful_palette(fi * 0.135 + p.x * 0.08 - time * 0.008);
    color = mix(color, tint * satin + vec3(0.22, 0.17, 0.22) * sheen, ribbon);
  }
  return color;
}

vec3 playful_comet(vec2 uv, float time) {
  vec2 p = uv * vec2(1.777778, 1.0);
  vec2 starCell = floor(p * 75.0);
  vec2 starPoint = fract(p * 75.0) - vec2(playful_hash2(starCell), playful_hash2(starCell + 13.0));
  float stars = (1.0 - smoothstep(0.03, 0.12, length(starPoint))) * step(0.962, playful_hash2(starCell + 41.0));
  vec3 color = vec3(0.004, 0.008, 0.025) + stars * vec3(0.43, 0.56, 0.78);
  vec2 direction = normalize(vec2(1.0, 0.3));
  for (int i = 0; i < 8; i++) {
    float fi = float(i);
    float seed = playful_hash(fi + 33.0);
    float phase = fract(time * (0.035 + seed * 0.012) + fi * 0.137);
    vec2 center = vec2(phase * 2.9 - 0.65, playful_hash(fi + 62.0) * 1.0 - 0.36 + phase * 0.8);
    vec2 q = p - center;
    float along = dot(q, direction);
    float across = dot(q, vec2(-direction.y, direction.x));
    float taper = smoothstep(-0.50, 0.0, along) * (1.0 - smoothstep(-0.002, 0.012, along));
    float tail = exp(-across * across / 0.000045) * taper * taper;
    float halo = exp(-across * across / 0.0005) * taper * 0.11;
    float head = exp(-dot(q, q) / 0.000025);
    vec3 tint = mix(vec3(0.13, 0.52, 1.0), vec3(1.0, 0.27, 0.45), seed);
    color += tint * (tail * 0.7 + halo) + vec3(0.85, 0.94, 1.0) * head;
  }
  return color;
}

vec3 playful_fireworks(vec2 uv, float time) {
  vec2 p = uv * vec2(1.777778, 1.0);
  vec3 color = vec3(0.008, 0.006, 0.024);
  for (int i = 0; i < 8; i++) {
    float fi = float(i);
    float cycle = time * 0.12 + fi * 0.173;
    float age = fract(cycle);
    float generation = floor(cycle);
    float seed = playful_hash(fi * 19.0 + generation * 13.0);
    vec2 center = vec2(0.18 + 1.4 * playful_hash(fi * 7.0 + generation), 0.18 + 0.52 * playful_hash(fi * 13.0 + generation * 3.0));
    center.y += age * age * 0.18;
    vec2 q = p - center;
    float angle = atan(q.y, q.x + 0.000001);
    float sector = (angle + 3.14159265) * 3.8197186;
    float spokeSeed = playful_hash(floor(sector) + fi * 24.0);
    float radius = (0.07 + 0.27 * sqrt(age)) * (0.76 + 0.24 * spokeSeed);
    float radial = length(q);
    float angularDistance = abs(fract(sector) - 0.5) * radial * 0.261799;
    float ray = exp(-angularDistance * angularDistance / 0.000018);
    float tip = exp(-pow(radial - radius, 2.0) / 0.000060);
    float trail = exp(-pow(radial - radius * 0.88, 2.0) / 0.0009) * 0.38;
    float visibility = smoothstep(0.015, 0.16, age) * (1.0 - smoothstep(0.42, 0.90, age));
    vec3 tint = playful_palette(seed + fi * 0.13) * 0.85 + vec3(0.16);
    color += tint * ray * (tip + trail) * visibility * 1.25;
  }
  return color;
}

vec3 playful_petals(vec2 uv, float time) {
  vec2 p = uv * vec2(1.777778, 1.0);
  vec3 color = vec3(0.028, 0.006, 0.020) + vec3(0.030, 0.004, 0.009) * (1.0 - uv.y);
  for (int i = 0; i < 20; i++) {
    float fi = float(i);
    float seed = playful_hash(fi + 9.0);
    float phase = time * (0.021 + seed * 0.016) + playful_hash(fi + 51.0);
    vec2 center = vec2(
      playful_hash(fi + 14.0) * 1.94 - 0.08 + sin(time * 0.21 + fi) * 0.09,
      fract(phase) * 1.35 - 0.17
    );
    float size = 0.035 + seed * 0.033;
    vec2 q = playful_rotate(p - center, fi + time * 0.22 + sin(time * 0.27 + fi) * 0.8) / size;
    q.x /= 0.62 + 0.26 * sin(time * 0.31 + fi);
    float distanceToPetal = max(length(q - vec2(0.42, 0.0)), length(q + vec2(0.42, 0.0))) - 0.87;
    float petal = 1.0 - smoothstep(-0.015, 0.025, distanceToPetal);
    vec3 tint = mix(vec3(1.0, 0.18, 0.33), vec3(1.0, 0.69, 0.68), seed);
    float sheen = 0.60 + 0.40 * smoothstep(-0.50, 0.35, q.x);
    float vein = exp(-q.x * q.x * 400.0) * (1.0 - smoothstep(0.1, 0.68, abs(q.y)));
    color = mix(color, tint * sheen + vec3(0.17, 0.07, 0.09) * vein, petal);
  }
  return color;
}

vec3 playful_matrix(vec2 uv, float time) {
  vec2 grid = uv * vec2(48.0, 27.0);
  vec2 cell = floor(grid);
  vec2 q = fract(grid);
  float columnSeed = playful_hash(cell.x + 29.0);
  float flow = time * (2.0 + columnSeed * 2.8);
  float trail = mod(cell.y - flow + columnSeed * 35.0, 35.0);
  float intensity = exp(-trail * 0.13);
  float head = 1.0 - smoothstep(0.2, 1.5, trail);
  float glyphSeed = playful_hash2(vec2(cell.x, cell.y + floor(time * 0.6 + columnSeed)));
  float row = floor(q.y * 5.0);
  float horizontal = 1.0 - smoothstep(0.045, 0.080, abs(fract(q.y * 5.0) - 0.5));
  horizontal *= smoothstep(0.16, 0.24, q.x) * (1.0 - smoothstep(0.75, 0.83, q.x));
  horizontal *= step(0.44, playful_hash(glyphSeed * 101.0 + row));
  float left = 1.0 - smoothstep(0.04, 0.08, abs(q.x - 0.23));
  float right = 1.0 - smoothstep(0.04, 0.08, abs(q.x - 0.77));
  left *= step(0.28, playful_hash(glyphSeed * 313.0 + row));
  right *= step(0.32, playful_hash(glyphSeed * 231.0 + row));
  float glyph = max(horizontal, max(left, right));
  glyph *= smoothstep(0.10, 0.16, q.y) * (1.0 - smoothstep(0.84, 0.90, q.y));
  float activeColumn = 0.30 + 0.70 * step(0.20, columnSeed);
  vec3 green = mix(vec3(0.03, 0.75, 0.22), vec3(0.60, 1.0, 0.76), head);
  return vec3(0.002, 0.013, 0.007) + green * glyph * intensity * activeColumn;
}

vec3 playful_rainbow(vec2 uv, float time) {
  vec2 p = uv * vec2(1.777778, 1.0);
  float wave = p.x * 0.36 + p.y * 0.44;
  wave += 0.085 * sin(p.x * 3.6 + p.y * 2.8 - time * 0.32);
  wave += 0.045 * sin(p.y * 7.0 - p.x * 1.8 + time * 0.19);
  wave -= time * 0.030;
  vec3 spectrum = playful_palette(wave);
  float silk = 0.73 + 0.20 * sin(wave * 6.2831853 + p.x * 2.1);
  float gleam = pow(0.5 + 0.5 * sin(wave * 12.5663706 + p.y * 1.8), 10.0);
  return spectrum * silk + vec3(0.12, 0.10, 0.13) * gleam;
}

vec3 playfulPattern(int id, vec2 uv, float time) {
  if (id == 21) return playful_confetti(uv, time);
  if (id == 22) return playful_bubbles(uv, time);
  if (id == 23) return playful_ribbons(uv, time);
  if (id == 24) return playful_comet(uv, time);
  if (id == 25) return playful_fireworks(uv, time);
  if (id == 26) return playful_petals(uv, time);
  if (id == 27) return playful_matrix(uv, time);
  if (id == 28) return playful_rainbow(uv, time);
  return vec3(0.0);
}
`;

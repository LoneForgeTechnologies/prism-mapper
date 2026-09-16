/** WebGL 1 procedural geometry. No textures, derivatives, or unbounded loops. */
export const geometricGLSL = `
vec3 geometric_palette(float phase) {
  return .52 + .48 * cos(6.2831853 * (phase + vec3(0.02, .35, .67)));
}

mat2 geometric_rotate(float angle) {
  float c = cos(angle), s = sin(angle);
  return mat2(c, -s, s, c);
}

float geometric_hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float geometric_line(float distance, float width) {
  return 1.0 - smoothstep(width, width * 2.5, abs(distance));
}

float geometric_triangle(vec2 p) {
  const float k = 1.7320508;
  p.x = abs(p.x) - .36;
  p.y += .36 / k;
  if (p.x + k * p.y > 0.0) p = vec2(p.x - k * p.y, -k * p.x - p.y) * .5;
  p.x -= clamp(p.x, -.72, 0.0);
  return -length(p) * sign(p.y);
}

vec3 geometricPattern(int id, vec2 uv, float time) {
  vec2 p = (uv - .5) * vec2(1.77778, 1.0);

  // An octagonal wireframe corridor, with rings flowing out from the distance.
  if (id == 13) {
    p = geometric_rotate(.11 * sin(time * .12)) * p;
    vec2 ap = abs(p);
    float radius = max(max(ap.x, ap.y), (ap.x + ap.y) * .7071068);
    float depth = -log(max(radius, .012));
    float ringPhase = depth * 2.25 + time * .32;
    float rings = geometric_line(fract(ringPhase) - .5, .023);
    float angle = atan(p.y, p.x);
    float spokePhase = (angle + .3926991) * 1.2732395;
    float spokes = geometric_line(fract(spokePhase) - .5, .012);
    float nearFade = smoothstep(.018, .13, radius);
    float farGlow = exp(-radius * 15.0);
    vec3 hue = mix(vec3(.06, .85, 1.0), vec3(.88, .11, .72), .5 + .5 * sin(depth * 1.7 + angle * 2.0));
    vec3 col = vec3(.003, .007, .025) + hue * (rings * .80 + spokes * .32) * nearFade;
    col += hue * exp(-abs(fract(ringPhase) - .5) * 18.0) * .18 * nearFade;
    col += vec3(.13, .3, .75) * farGlow * .30;
    return col;
  }

  // Fold a drifting arrangement of circles into twelve mirrored petals.
  if (id == 14) {
    float radius = length(p);
    float angle = atan(p.y, p.x) + time * .055;
    float folded = abs(mod(angle + .2617994, .5235988) - .2617994);
    vec2 q = vec2(cos(folded), sin(folded)) * radius;
    q.x += .045 * sin(time * .22);
    float petals = length(q - vec2(.33 + .055 * sin(time * .18), .075));
    float arcs = sin(petals * 38.0 - time * .35);
    float lattice = sin(q.x * 25.0 + sin(q.y * 24.0 + time * .23));
    float ribbon = pow(.5 + .5 * arcs, 5.0);
    float seam = pow(.5 + .5 * lattice, 12.0);
    vec3 hue = geometric_palette(petals * 1.5 + radius * .3 + time * .016);
    vec3 col = hue * (.12 + .66 * ribbon) + geometric_palette(radius + .45) * seam * .38;
    col *= .65 + .35 * smoothstep(.0, .25, radius);
    col += vec3(.25, .6, 1.0) * exp(-radius * 24.0) * .35;
    return col;
  }

  // A luminous perspective floor beneath a striped sunset disk.
  if (id == 15) {
    float horizon = .47;
    vec3 col = mix(vec3(.006, .007, .04), vec3(.075, .013, .105), clamp(uv.y / horizon, 0.0, 1.0));
    vec2 sunUV = (uv - vec2(.5, .315)) * vec2(1.77778, 1.0);
    float sunRadius = length(sunUV);
    float disk = 1.0 - smoothstep(.16, .164, sunRadius);
    float stripes = smoothstep(.12, .22, fract(uv.y * 45.0));
    stripes = mix(1.0, stripes, smoothstep(.29, .44, uv.y));
    vec3 sunColor = mix(vec3(1.0, .64, .12), vec3(.94, .08, .39), clamp((uv.y - .15) * 3.5, 0.0, 1.0));
    col += sunColor * disk * stripes * .87;
    col += vec3(.57, .06, .24) * exp(-sunRadius * 9.0) * .22;
    if (uv.y > horizon) {
      float d = uv.y - horizon;
      vec2 floorUV = vec2((uv.x - .5) * 2.0, 1.0) / (d + .03);
      floorUV.y -= time * .65;
      vec2 cell = abs(fract(floorUV) - .5);
      float width = clamp(.004 / (d + .035), .012, .095);
      float grid = max(geometric_line(cell.x - .5, width), geometric_line(cell.y - .5, width));
      float fog = smoothstep(.006, .09, d);
      vec3 gridColor = mix(vec3(.61, .11, .97), vec3(.03, .68, .98), clamp(d * 2.4, 0.0, 1.0));
      col = vec3(.006, .008, .035) + gridColor * grid * fog * .9;
      col += vec3(.43, .04, .52) * exp(-d * 12.0) * .3;
    }
    return col;
  }

  // Seven soft ribbons with independently moving crests and fine bright edges.
  if (id == 16) {
    vec3 col = vec3(.003, .008, .018);
    for (int i = 0; i < 7; i++) {
      float layer = float(i);
      float center = .17 + layer * .11;
      center += .085 * sin(uv.x * 6.0 + time * .28 + layer * .58);
      center += .035 * sin(uv.x * 12.0 - time * .19 + layer * .9);
      float d = uv.y - center;
      vec3 hue = geometric_palette(layer * .11 + uv.x * .15 + time * .008);
      float body = exp(-d * d * 650.0);
      float edge = exp(-abs(d + .021) * 210.0);
      col += hue * (body * .31 + edge * .53);
    }
    return col;
  }

  // Broad colored arms turn slowly, with a fine illuminated leading edge.
  if (id == 17) {
    float radius = length(p);
    float angle = atan(p.y, p.x);
    float phase = angle * 3.0 + radius * 25.0 - time * .44;
    float band = .5 + .5 * sin(phase);
    float edge = pow(.5 + .5 * cos(phase + .9), 18.0);
    vec3 hue = geometric_palette(radius * .8 + sin(angle * 3.0 + time * .08) * .09 + time * .013);
    float centerFade = smoothstep(.015, .09, radius);
    vec3 col = vec3(.006, .008, .018) + hue * (.10 + .68 * pow(band, 2.0) + .25 * edge) * centerFade;
    col += vec3(.06, .12, .25) * (1.0 - centerFade);
    return col;
  }

  // Honeycomb cells carry a slow diagonal light wave across glasslike facets.
  if (id == 18) {
    vec2 hp = p * 8.0;
    vec2 period = vec2(1.0, 1.7320508);
    vec2 a = mod(hp, period) - period * .5;
    vec2 b = mod(hp - period * .5, period) - period * .5;
    vec2 q = dot(a, a) < dot(b, b) ? a : b;
    vec2 cell = hp - q;
    float hexDistance = max(abs(q.x), dot(abs(q), vec2(.5, .8660254)));
    float edge = geometric_line(hexDistance - .5, .013);
    float travel = .5 + .5 * sin(cell.x * .55 + cell.y * .8 - time * .43);
    float facet = .5 + .5 * cos(atan(q.y, q.x) * 3.0);
    vec3 hue = geometric_palette(cell.x * .035 + cell.y * .035 + time * .016);
    vec3 col = hue * (.035 + .23 * travel * (.5 + .5 * facet));
    col += hue * edge * (.28 + .64 * travel);
    col += vec3(.35, .66, .76) * exp(-length(q) * 22.0) * travel * .22;
    return col;
  }

  // Two independently drifting circular line fields create interference islands.
  if (id == 19) {
    vec2 first = p - vec2(.24 * cos(time * .09), .17 * sin(time * .13));
    vec2 second = p - vec2(-.28 + .06 * sin(time * .11), .14 * cos(time * .1));
    float a = .5 + .5 * cos(length(first) * 92.0 - time * .25);
    float b = .5 + .5 * cos(length(second) * 90.0 + time * .18);
    float linesA = pow(a, 7.0);
    float linesB = pow(b, 7.0);
    float interference = pow(a * b, 2.0);
    vec3 col = vec3(.004, .006, .016);
    col += vec3(.03, .55, .95) * linesA * .44;
    col += vec3(.92, .18, .54) * linesB * .44;
    col += geometric_palette(length(p) * .6 + .1) * interference * .62;
    return col;
  }

  // An offset field of turning triangular prisms with three colored facets.
  if (id == 20) {
    vec2 tileP = p * 5.5;
    float row = floor(tileP.y);
    tileP.x += mod(row, 2.0) * .5;
    vec2 cell = floor(tileP);
    vec2 q = fract(tileP) - .5;
    float seed = geometric_hash(cell);
    q = geometric_rotate(time * (.09 + seed * .1) + seed * 6.2831853) * q;
    float d = geometric_triangle(q);
    float inside = 1.0 - smoothstep(-.006, .006, d);
    float edge = geometric_line(d, .007);
    float sector = floor((atan(q.y, q.x) + 3.1415927) / 2.0943951);
    float facet = .42 + .22 * sector;
    vec3 hue = geometric_palette(seed * .6 + time * .014 + sector * .065);
    vec3 col = vec3(.004, .008, .025) + hue * inside * facet * .75;
    col += mix(hue, vec3(.65, .82, 1.0), .4) * edge * .65;
    col += hue * exp(-max(d, 0.0) * 38.0) * .055;
    return col;
  }

  return vec3(0.0);
}
`;

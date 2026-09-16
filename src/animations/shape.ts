/**
 * Original outline-aware WebGL 1 materials. Distances and widths use projector
 * pixels; edgePosition is the normalized arc length around the mapped outline.
 * Uniform u_detail changes density without moving the mapping boundary.
 */
export const shapeGLSL = `
vec3 shape_palette(float phase) {
  vec3 spectrum = .52 + .48 * cos(6.2831853 * (phase + vec3(.02, .35, .67)));
  return mix(spectrum, spectrum * u_color + u_color * .25, .36);
}

float shape_gaussian(float distance, float width) {
  float normalized = distance / max(width, 1.0);
  return exp(-normalized * normalized * 2.0);
}

float shape_wrapDistance(float value) {
  return abs(fract(value + .5) - .5);
}

float shape_outline(float distance, float width) {
  // The narrow core stays readable while the wider glow softens its inner edge.
  return .72 * shape_gaussian(distance, width) + .22 * exp(-distance / (width * 2.8));
}

vec3 shapePattern(int id, vec2 uv, float time, float edgeDistance, float edgePosition, float perimeter) {
  float width = max(u_edgeWidth, 1.0);
  float detail = max(u_detail, .25);
  float distance = max(edgeDistance, 0.0);
  float position = fract(edgePosition);
  float outline = shape_outline(distance, width);
  float outlineLength = max(perimeter, 1.0);

  // Three colored comet heads follow the actual traced perimeter, with soft tails.
  if (id == 29) {
    vec3 col = u_color * outline * .035;
    float count = max(1.0, floor(2.0 * detail + 1.0));
    float travel = fract(position * count - time * .12);
    float head = exp(-pow(shape_wrapDistance(travel) / .027, 2.0));
    float tail = exp(-travel * 10.0) * smoothstep(0.0, .018, travel);
    vec3 hue = shape_palette(position * .8 - time * .025);
    col += hue * outline * (head * .95 + tail * .76);
    col += mix(hue, vec3(1.0), .72) * shape_gaussian(distance, width * .32) * head * .52;
    return col;
  }

  // Continuous breathing; its brightness never turns off or flashes abruptly.
  if (id == 30) {
    float breath = .58 + .32 * sin(time * .62);
    float wave = .78 + .22 * sin(position * 6.2831853 * floor(2.0 + detail * 2.0) - time * .3);
    vec3 hue = mix(u_color, shape_palette(position * .6 + time * .016), .45);
    float halo = exp(-distance / (width * (3.0 + breath * 2.0)));
    return hue * (outline * breath * wave + halo * breath * .15);
  }

  // Dash count derives from output pixels and closes evenly around the perimeter.
  if (id == 31) {
    float count = clamp(floor(outlineLength / max(width * 8.0, 36.0) * detail + .5), 3.0, 160.0);
    float phase = fract(position * count - time * .72);
    float dash = smoothstep(.08, .17, phase) * (1.0 - smoothstep(.59, .68, phase));
    vec3 hue = shape_palette(position * .85 + time * .015);
    float core = shape_gaussian(distance, width * .55);
    return hue * outline * (dash * .8 + .025) + mix(hue, u_color, .6) * core * dash * .25;
  }

  // Equidistant rings grow inward from every mapped edge, including concave edges.
  if (id == 32) {
    float spacing = max(14.0, width * 5.0) / detail;
    float phase = distance / spacing - time * .22;
    float ringDistance = shape_wrapDistance(phase) * spacing;
    float ring = shape_gaussian(ringDistance, max(1.0, min(width * .65, spacing * .13)));
    float haze = exp(-ringDistance / max(2.0, spacing * .24));
    vec3 hue = shape_palette(distance / max(outlineLength * .16, 100.0) - time * .022);
    float depthFade = .55 + .45 * exp(-distance / max(80.0, outlineLength * .13));
    return hue * (ring * .66 + haze * .12) * depthFade + u_color * outline * .2;
  }

  // Soft blooms are spaced along arc length; they are not tied to vertex count.
  if (id == 33) {
    float count = floor(3.0 + detail * 2.0);
    float along = shape_wrapDistance(position * count) * outlineLength / count;
    float reach = max(width * 6.0, outlineLength / count * .22);
    // Keep the glow shallow. Far inside a polygon, the nearest boundary segment
    // switches across its medial axis and arc-length coordinates are discontinuous.
    float radius = length(vec2(along, distance * reach / (width * 2.5)));
    float breath = .72 + .28 * sin(time * .67 + floor(position * count + .5) * 1.7);
    float bloom = shape_gaussian(radius, reach * (.6 + breath * .55));
    bloom *= 1.0 - smoothstep(width * 2.5, width * 4.0, distance);
    float brightCenter = shape_gaussian(radius, width * 1.5);
    // A continuous panel-space palette prevents color seams where edges meet.
    vec3 hue = shape_palette(uv.x * .7 + uv.y * .3 + time * .02);
    return hue * (bloom * breath * .77 + outline * .075) + mix(hue, vec3(1.0), .52) * brightCenter * breath * .32;
  }

  // A broad scanner travels smoothly back and forth through the mapped panel.
  if (id == 34) {
    float plane = uv.x + (uv.y - .5) * .24;
    float center = .5 + .83 * sin(time * .31);
    float bandWidth = .11 / sqrt(detail);
    float band = exp(-pow((plane - center) / bandWidth, 2.0));
    float leading = exp(-pow((plane - center + bandWidth * .55) / (bandWidth * .09), 2.0));
    vec3 hue = shape_palette(.55 + uv.y * .16 + time * .012);
    vec3 col = hue * (band * .27 + leading * .38);
    col += mix(hue, u_color, .5) * outline * (.15 + band * .83);
    return col;
  }

  // A rotating fan reveals concentric rings and keeps the traced outline visible.
  if (id == 35) {
    vec2 p = (uv - .5) * vec2(u_surfaceAspect, 1.0);
    float radius = length(p);
    float angle = atan(p.y, p.x + .000001) / 6.2831853;
    float phase = fract(time * .068 - angle);
    float head = exp(-pow(shape_wrapDistance(phase) / .014, 2.0));
    float tail = exp(-phase * 7.0) * smoothstep(0.0, .022, phase);
    float sweep = head * .55 + tail * .8;
    float rings = exp(-pow(shape_wrapDistance(radius * (4.0 + detail * 3.0)) / .048, 2.0));
    vec3 hue = mix(vec3(.12, .88, .63), u_color, .58);
    vec3 col = hue * (sweep * (.19 + rings * .38) + outline * (.16 + sweep * .67));
    col += mix(hue, vec3(1.0), .5) * exp(-radius * 85.0) * .5;
    return col;
  }

  // A seamless triangular lattice with interlaced light waves and lit cell seams.
  if (id == 36) {
    vec2 p = (uv - .5) * vec2(1.7777778, 1.0) * 7.0;
    p += vec2(time * .025, -time * .018);
    vec2 lattice = vec2(p.x - p.y * .5773503, p.y * 1.1547005);
    vec2 cell = floor(lattice);
    vec2 local = fract(lattice);
    float upper = step(1.0, local.x + local.y);
    vec2 center = cell + vec2(mix(.3333333, .6666667, upper));
    float nearest = min(min(min(local.x, 1.0 - local.x), min(local.y, 1.0 - local.y)), abs(local.x + local.y - 1.0));
    float seam = 1.0 - smoothstep(.012, .036, nearest);
    float crossing = .5 + .5 * sin(center.x * .76 + center.y * 1.08 - time * .42 + upper * 1.3);
    float strand = pow(crossing, 3.0);
    vec3 hue = shape_palette(center.x * .06 + center.y * .055 + upper * .12 + time * .01);
    vec3 col = hue * (.045 + strand * .39 + seam * (.18 + strand * .37));
    col += mix(hue, u_color, .6) * outline * .42;
    return col;
  }

  return vec3(0.0);
}
`;

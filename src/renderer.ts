import {
  defaultEdgeWidth,
  type Media,
  type Project,
  type Surface,
} from "./model";
import { inverseHomography, matrixToGL } from "./geometry";
import { patternById } from "./patterns";
import { boundsQuad, surfacePoints, triangulatePolygon } from "./polygon";
import { organicGLSL } from "./animations/organic";
import { geometricGLSL } from "./animations/geometric";
import { playfulGLSL } from "./animations/playful";
import { shapeGLSL } from "./animations/shape";
import { halloweenGLSL } from "./animations/halloween";
import { readAudioFrame, type AudioFrame } from "./audio";
import { resolveShowFrame, type TimelineVideoFrame } from "./timeline";

const vertexShader = `
attribute vec2 a_position;
void main() { gl_Position=vec4(a_position.x*2.0-1.0,1.0-a_position.y*2.0,0.0,1.0); }
`;

const fragmentShader = `
precision highp float;
uniform mat3 u_inverse;
// xy is the canvas size; zw is the actual output size, including in the preview.
uniform vec4 u_resolution;
uniform float u_time;
uniform float u_detail;
uniform float u_opacity;
uniform float u_brightness;
uniform vec3 u_color;
uniform int u_source;
uniform sampler2D u_texture;
uniform vec4 u_content;
// mask, premultiplied screen blend, feather pixels, outline point count.
uniform vec4 u_layer;
uniform float u_edgeWidth;
uniform float u_surfaceAspect;
#ifdef OUTLINE_TEXTURE
uniform sampler2D u_outlineTexture;
#else
uniform vec2 u_outline[64];
#endif

// Distances and arclength use physical output pixels, never UV/bounding-box units.
vec3 outlineMetrics(vec2 screen) {
  vec2 point=screen*u_resolution.zw;
  float nearest=1.0e20, nearestPosition=0.0, perimeter=0.0;
  vec2 first=vec2(0.0), previous=vec2(0.0);
  for(int i=0;i<64;i++) {
    if(float(i)>=u_layer.w) break;
    #ifdef OUTLINE_TEXTURE
    vec4 encoded=texture2D(u_outlineTexture,vec2((float(i)+.5)/64.0,.5));
    vec2 current=vec2(encoded.r*256.0+encoded.g,encoded.b*256.0+encoded.a)/257.0*u_resolution.zw;
    #else
    vec2 current=u_outline[i]*u_resolution.zw;
    #endif
    if(i==0) first=current;
    else {
      vec2 segment=current-previous;
      float segmentLength=length(segment);
      float t=clamp(dot(point-previous,segment)/max(dot(segment,segment),.000001),0.0,1.0);
      float distance=length(point-previous-t*segment);
      if(distance<nearest) {nearest=distance;nearestPosition=perimeter+t*segmentLength;}
      perimeter+=segmentLength;
    }
    previous=current;
  }
  vec2 segment=first-previous;
  float segmentLength=length(segment);
  float t=clamp(dot(point-previous,segment)/max(dot(segment,segment),.000001),0.0,1.0);
  float distance=length(point-previous-t*segment);
  if(distance<nearest) {nearest=distance;nearestPosition=perimeter+t*segmentLength;}
  perimeter+=segmentLength;
  return vec3(nearest,nearestPosition/max(perimeter,.000001),perimeter);
}

${organicGLSL}
${geometricGLSL}
${playfulGLSL}
${shapeGLSL}
${halloweenGLSL}

vec3 aurora(vec2 uv) {
  float t=u_time*.16;
  vec2 p=vec2(uv.x*1.78,uv.y);
  float center=.49+.16*sin(p.x*2.8+t)+.085*sin(p.x*5.2-t*.9);
  float d=p.y-center;
  float broad=exp(-d*d*18.0);
  float veil=exp(-abs(d)*10.0);
  float strands=.5+.5*sin(d*95.0+sin(p.x*8.0+t)*2.8+t*2.0);
  float filament=pow(strands,6.0)*exp(-abs(d)*15.0);
  float glow=exp(-pow(d+.035*sin(p.x*11.0-t),2.0)*550.0);
  vec3 ink=vec3(.008,.017,.035);
  vec3 cyan=mix(vec3(.02,.32,.69),vec3(.13,.95,.74),.5+.5*sin(p.x*2.3-t));
  vec3 col=ink+cyan*(broad*.18+veil*.22+filament*.38+glow*.25);
  float amberCenter=.65+.18*sin(p.x*2.3-t*.8+1.5);
  float amber=exp(-pow(p.y-amberCenter,2.0)*210.0);
  float amberFine=pow(.5+.5*sin((p.y-amberCenter)*145.0+p.x*3.0),10.0);
  col+=vec3(1.0,.40,.12)*amber*(.21+amberFine*.25)*smoothstep(.3,1.6,p.x);
  col+=vec3(.22,.28,.75)*exp(-pow(p.y-(.25+.1*cos(p.x*3.0+t)),2.0)*120.0)*.12;
  float vignette=1.0-.38*length((uv-.5)*vec2(.8,1.0));
  return col*vignette;
}

void main() {
  vec2 screen=vec2(gl_FragCoord.x/u_resolution.x,1.0-gl_FragCoord.y/u_resolution.y);
  vec3 edge=vec3(1.0e20,0.0,0.0);
  if(u_layer.z>0.0 || (u_source>=29 && u_source<=36) || u_source==49) edge=outlineMetrics(screen);
  float alpha=u_opacity;
  if(u_layer.z>0.0) alpha*=smoothstep(0.0,u_layer.z,edge.x);
  if(u_layer.x>0.5) {gl_FragColor=vec4(0.0,0.0,0.0,alpha);return;}
  vec3 projected=u_inverse*vec3(screen,1.0);
  if (abs(projected.z)<.0000001) discard;
  vec2 uv=projected.xy/projected.z;
  // Geometry clips the original outline. Content transforms only its sampling space.
  // Positive rotation turns the visible content clockwise; scale>1 zooms in.
  uv-=vec2(.5)+u_content.xy;
  uv=vec2(u_content.z*uv.x+u_content.w*uv.y,-u_content.w*uv.x+u_content.z*uv.y)+.5;
  // Transformed media outside its bounds is transparent, not edge-stretched.
  if(u_source==1 && (uv.x<0.0||uv.x>1.0||uv.y<0.0||uv.y>1.0)) discard;
  if (u_source==0 || u_source==2 || u_source>=5) uv=(uv-.5)*u_detail+.5;
  vec4 color=vec4(u_color,1.0);
  if (u_source==0) color=vec4(aurora(uv),1.0);
  else if (u_source==1) color=texture2D(u_texture,uv);
  else if (u_source==2) {
    vec2 p=(uv-.5)*vec2(1.77778,1.0);
    float radius=length(p);
    float ring=pow(.5+.5*cos(radius*65.0-u_time*1.4),16.0);
    vec3 hue=.5+.5*cos(vec3(0.0,2.2,4.3)+radius*4.0-u_time*.15);
    color=vec4(vec3(.008,.02,.025)+hue*(ring*.75+.04),1.0);
  } else if (u_source==3) {
    float checker=mod(floor(uv.x*16.0)+floor(uv.y*9.0),2.0);
    color=vec4(mix(vec3(.025,.035,.045),vec3(.91,.95,.93),checker),1.0);
  }
  if(u_source>=5 && u_source<=12) color=vec4(organicPattern(u_source,uv,u_time),1.0);
  else if(u_source>=13 && u_source<=20) color=vec4(geometricPattern(u_source,uv,u_time),1.0);
  else if(u_source>=21 && u_source<=28) color=vec4(playfulPattern(u_source,uv,u_time),1.0);
  else if((u_source>=29 && u_source<=36) || u_source==49) color=vec4(shapePattern(u_source,uv,u_time,edge.x,edge.y,edge.z),1.0);
  else if(u_source>=37 && u_source<=48) color=vec4(halloweenPattern(u_source,uv,u_time),1.0);
  alpha*=color.a;
  vec3 rgb=clamp(color.rgb,0.0,1.0)*u_brightness;
  // Screen is S*a + D*(1-S*a), including opacity, texture alpha, and feather.
  if(u_layer.y>0.5) rgb*=alpha;
  gl_FragColor=vec4(rgb,alpha);
}
`;

interface SurfaceGeometry {
  signature: string;
  inverse: Float32Array;
  contentQuad: Surface["corners"];
  outline: Float32Array;
  count: number;
  vertexCount: number;
  buffer: WebGLBuffer;
  outlineTexture: WebGLTexture | null;
}

interface Asset {
  url: string;
  kind: Media["kind"];
  name: string;
  texture: WebGLTexture;
  element: HTMLImageElement | HTMLVideoElement;
  ready: boolean;
  failed: boolean;
  uploaded: boolean;
  lastTime: number;
  wantsPlaying: boolean;
  disposed: boolean;
  timelineKey?: string;
}

/** Independent GPU renderer shared by the editor preview and clean projector window. */
export class ProjectionRenderer {
  private gl: WebGLRenderingContext | null;
  private program: WebGLProgram | null = null;
  private geometries = new Map<string, SurfaceGeometry>();
  private outlineUsesTexture = false;
  private position = -1;
  private gridTexture: WebGLTexture | null = null;
  private uniforms: Record<string, WebGLUniformLocation | null> = {};
  private assets = new Map<string, Asset>();
  private reported = new Set<string>();
  private destroyed = false;
  private contextLost = false;
  private frame = 0;
  private animationTime = 0;
  private audioFrame: AudioFrame = {
    active: false,
    level: 0,
    bass: 0,
    mid: 0,
    treble: 0,
    beat: 0,
  };
  private previousTime: number | null = null;
  private surfaceClocks = new Map<string, number>();
  private onError?: (message: string) => void;
  private onLost = (event: Event) => {
    event.preventDefault();
    this.contextLost = true;
    this.report("Graphics connection lost. Waiting for the GPU to recover.");
  };
  private onRestored = () => {
    if (this.destroyed) return;
    this.contextLost = false;
    this.releaseResources();
    this.reported.clear();
    try {
      this.initialize();
      this.onError?.("");
    } catch (error) {
      this.report(`Could not restore graphics: ${errorMessage(error)}`);
    }
  };

  constructor(
    private canvas: HTMLCanvasElement,
    options?: { onError?: (message: string) => void },
  ) {
    this.onError = options?.onError;
    this.gl = canvas.getContext("webgl", {
      alpha: false,
      antialias: true,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
      powerPreference: "high-performance",
    });
    canvas.style.backgroundColor = "#000";
    canvas.addEventListener("webglcontextlost", this.onLost);
    canvas.addEventListener("webglcontextrestored", this.onRestored);
    if (!this.gl) {
      this.report(
        "WebGL is unavailable. Enable hardware acceleration to project.",
      );
      return;
    }
    try {
      this.initialize();
    } catch (error) {
      this.report(`Could not start graphics: ${errorMessage(error)}`);
      this.releaseResources();
    }
  }

  private report(message: string) {
    if (this.destroyed || this.reported.has(message)) return;
    this.reported.add(message);
    this.canvas.dataset.renderError = message;
    this.onError?.(message);
    console.warn("[Prism Mapper]", message);
  }

  private compile(type: number, source: string): WebGLShader {
    const gl = this.gl!;
    const shader = gl.createShader(type);
    if (!shader) throw new Error("Could not allocate a GPU shader.");
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const message =
        gl.getShaderInfoLog(shader) || "Shader compilation failed.";
      gl.deleteShader(shader);
      throw new Error(message);
    }
    return shader;
  }

  private initialize() {
    const gl = this.gl!;
    const program = gl.createProgram();
    if (!program) throw new Error("Could not allocate a GPU program.");
    this.program = program;
    const shaders: WebGLShader[] = [];
    try {
      shaders.push(this.compile(gl.VERTEX_SHADER, vertexShader));
      // WebGL1 only guarantees 16 fragment-uniform vectors. A 64-point
      // uniform outline is fast on modern GPUs; a tiny packed texture keeps
      // the same features available on older GPUs with smaller limits.
      this.outlineUsesTexture =
        gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS) < 80;
      shaders.push(
        this.compile(
          gl.FRAGMENT_SHADER,
          `${this.outlineUsesTexture ? "#define OUTLINE_TEXTURE\n" : ""}${fragmentShader}`,
        ),
      );
      shaders.forEach((shader) => gl.attachShader(program, shader));
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS))
        throw new Error(
          gl.getProgramInfoLog(program) || "Shader linking failed.",
        );
    } finally {
      shaders.forEach((shader) => gl.deleteShader(shader));
    }
    this.position = gl.getAttribLocation(program, "a_position");
    for (const name of [
      "inverse",
      "resolution",
      "time",
      "detail",
      "opacity",
      "brightness",
      "color",
      "source",
      "texture",
      "content",
      "layer",
      "edgeWidth",
      "surfaceAspect",
      "outline[0]",
      "outlineTexture",
    ])
      this.uniforms[name] = gl.getUniformLocation(program, `u_${name}`);
    this.gridTexture = this.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.gridTexture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      makeCalibrationGrid(),
    );
    gl.clearColor(0, 0, 0, 1);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  private createTexture(): WebGLTexture {
    const gl = this.gl!,
      texture = gl.createTexture();
    if (!texture) throw new Error("Could not allocate a GPU texture.");
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      1,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      new Uint8Array([0, 0, 0, 255]),
    );
    return texture;
  }

  private getAsset(media: Media): Asset {
    const existing = this.assets.get(media.id);
    if (existing?.url === media.url && existing.kind === media.kind)
      return existing;
    if (existing) this.disposeAsset(existing);
    const element =
      media.kind === "video" ? document.createElement("video") : new Image();
    const asset: Asset = {
      url: media.url,
      kind: media.kind,
      name: media.name,
      texture: this.createTexture(),
      element,
      ready: false,
      failed: false,
      uploaded: false,
      lastTime: -1,
      wantsPlaying: false,
      disposed: false,
    };
    const fail = () => {
      if (asset.disposed) return;
      asset.failed = true;
      this.report(
        `Cannot decode “${media.name}”. Try a PNG/JPEG image or H.264 MP4 video.`,
      );
    };
    element.onerror = fail;
    // Imported assets use a CORS-enabled media:// protocol in the desktop shell.
    // This must be set before src so WebGL can sample images and video frames.
    element.crossOrigin = "anonymous";
    if (element instanceof HTMLVideoElement) {
      element.muted = true;
      element.loop = true;
      element.playsInline = true;
      element.preload = "auto";
      element.onloadeddata = () => {
        if (!asset.disposed) asset.ready = true;
      };
      element.onseeked = () => {
        // A paused seek changes the decoded image after currentTime was set.
        // Invalidate its upload so the new frame reaches the output texture.
        if (!asset.disposed) asset.uploaded = false;
      };
      element.src = media.url;
      element.load();
    } else {
      element.onload = () => {
        if (!asset.disposed) asset.ready = element.naturalWidth > 0;
      };
      element.src = media.url;
    }
    this.assets.set(media.id, asset);
    return asset;
  }

  private prepareAsset(
    asset: Asset,
    playing: boolean,
    timeline?: TimelineVideoFrame,
  ): boolean {
    if (asset.failed || asset.disposed) return false;
    const gl = this.gl!,
      element = asset.element;
    if (element instanceof HTMLVideoElement) {
      let cueChanged = false;
      element.loop = !timeline;
      if (timeline) {
        const hasMetadata =
          element.readyState >= HTMLMediaElement.HAVE_METADATA;
        const duration =
          Number.isFinite(element.duration) && element.duration > 0
            ? element.duration
            : Infinity;
        // A shorter video holds its final decoded frame until the next cue.
        // Seeking just before duration avoids a decoder clearing its end frame.
        const target = Math.min(
          timeline.position,
          Math.max(0, duration - 0.001),
        );
        cueChanged = asset.timelineKey !== timeline.key;
        if (
          hasMetadata &&
          (cueChanged ||
            (!element.seeking && Math.abs(element.currentTime - target) > 0.25))
        ) {
          try {
            element.currentTime = target;
            asset.timelineKey = timeline.key;
          } catch {
            // Some decoders do not accept seeks until their first frame is ready.
            // The next render retries against the authoritative clock.
          }
        }
        playing =
          timeline.playing && hasMetadata && timeline.position < duration;
      } else asset.timelineKey = undefined;
      if (
        asset.wantsPlaying !== playing ||
        (playing && cueChanged && element.paused)
      ) {
        asset.wantsPlaying = playing;
        if (playing)
          element.play().catch((error) => {
            if (
              !asset.disposed &&
              asset.wantsPlaying &&
              error?.name !== "AbortError"
            )
              this.report(
                `Could not play “${asset.name}”: ${errorMessage(error)}`,
              );
          });
        else element.pause();
      }
      asset.ready =
        element.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
        element.videoWidth > 0;
    }
    if (!asset.ready) return false;
    gl.bindTexture(gl.TEXTURE_2D, asset.texture);
    if (
      !asset.uploaded ||
      (element instanceof HTMLVideoElement &&
        asset.lastTime !== element.currentTime)
    ) {
      try {
        const width =
          element instanceof HTMLVideoElement
            ? element.videoWidth
            : element.naturalWidth;
        const height =
          element instanceof HTMLVideoElement
            ? element.videoHeight
            : element.naturalHeight;
        const maxSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
        if (width > maxSize || height > maxSize)
          throw new Error(
            `Media dimensions exceed the GPU limit of ${maxSize} pixels.`,
          );
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.RGBA,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          element,
        );
        const error = gl.getError();
        if (error !== gl.NO_ERROR)
          throw new Error(`GPU texture upload failed (${error}).`);
        asset.uploaded = true;
        if (element instanceof HTMLVideoElement)
          asset.lastTime = element.currentTime;
      } catch (error) {
        asset.failed = true;
        this.report(`Cannot display “${asset.name}”: ${errorMessage(error)}`);
        return false;
      }
    }
    return true;
  }

  render(project: Project, timeSeconds: number, now = Date.now()): void {
    if (this.destroyed) return;
    const showFrame = resolveShowFrame(project, now);
    project = showFrame.project;
    const incomingAudio = readAudioFrame();
    // Pause holds the response along with procedural motion. Stopping capture
    // always releases the response, including when playback is paused.
    if (project.playing || !incomingAudio.active)
      this.audioFrame = incomingAudio;
    const finiteTime = Number.isFinite(timeSeconds) ? timeSeconds : 0;
    const delta =
      this.previousTime !== null && project.playing
        ? Math.max(0, Math.min(0.25, finiteTime - this.previousTime))
        : 0;
    this.animationTime += delta;
    const existingIds = new Set(project.surfaces.map((s) => s.id));
    for (const id of this.surfaceClocks.keys())
      if (!existingIds.has(id)) this.surfaceClocks.delete(id);
    for (const [id, geometry] of this.geometries)
      if (!existingIds.has(id)) {
        this.disposeGeometry(geometry);
        this.geometries.delete(id);
      }
    for (const surface of project.surfaces)
      this.surfaceClocks.set(
        surface.id,
        showFrame.video
          ? showFrame.video.position * (surface.speed ?? 1)
          : (this.surfaceClocks.get(surface.id) ?? this.animationTime - delta) +
              delta * (surface.speed ?? 1),
      );
    this.previousTime = finiteTime;
    const gl = this.gl;
    if (!gl || this.contextLost || !this.program) return;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const available = new Set(project.media.map((media) => media.id));
    const visibleSources = new Set(
      project.surfaces
        .filter(
          (surface) =>
            surface.visible && surface.opacity > 0 && surface.kind !== "mask",
        )
        .map((surface) => surface.source),
    );
    for (const [id, asset] of this.assets) {
      if (
        !available.has(id) ||
        (asset.kind === "video" &&
          !visibleSources.has(id) &&
          !visibleSources.has(`media:${id}`))
      ) {
        this.disposeAsset(asset);
        this.assets.delete(id);
      } else if (
        asset.element instanceof HTMLVideoElement &&
        (!project.playing || (showFrame.video && project.blackout)) &&
        !asset.element.paused
      ) {
        asset.element.pause();
        asset.wantsPlaying = false;
      }
    }
    if (project.blackout || this.canvas.width === 0 || this.canvas.height === 0)
      return;
    gl.useProgram(this.program);
    gl.enableVertexAttribArray(this.position);
    gl.uniform4f(
      this.uniforms.resolution,
      this.canvas.width,
      this.canvas.height,
      project.width,
      project.height,
    );
    gl.uniform1f(this.uniforms.time, this.animationTime);
    gl.uniform1i(this.uniforms.texture, 0);
    gl.activeTexture(gl.TEXTURE0);
    for (const surface of project.surfaces) {
      if (!surface.visible || surface.opacity <= 0) continue;
      let geometry: SurfaceGeometry;
      try {
        geometry = this.getGeometry(surface);
      } catch (error) {
        this.report(`“${surface.name}”: ${errorMessage(error)}`);
        continue;
      }
      const pattern = patternById.get(surface.source);
      let source = pattern?.shader ?? 1;
      if (surface.source === "grid")
        gl.bindTexture(gl.TEXTURE_2D, this.gridTexture);
      if (!pattern && surface.kind !== "mask") {
        const media = project.media.find(
          (media) =>
            media.id === surface.source ||
            `media:${media.id}` === surface.source,
        );
        if (!media) {
          this.report(
            `Media for “${surface.name}” is missing. Import it again or choose a pattern.`,
          );
          continue;
        }
        // No file behind this entry yet (restoring after a reload, or waiting to be
        // imported again). The layer stays dark without a misleading decode error.
        if (!media.url) continue;
        try {
          if (
            !this.prepareAsset(
              this.getAsset(media),
              project.playing,
              showFrame.video,
            )
          )
            continue;
        } catch (error) {
          this.report(`Cannot load “${media.name}”: ${errorMessage(error)}`);
          continue;
        }
        source = 1;
      }
      const mask = surface.kind === "mask";
      const reaction = surface.audio;
      const responding = !mask && reaction?.enabled && this.audioFrame.active;
      const amount = responding ? unit(reaction.amount) : 0;
      const signal = responding ? unit(this.audioFrame[reaction.band]) : 0;
      const brightnessResponse =
        responding && reaction.mode !== "zoom"
          ? 1 - amount * 0.85 * (1 - signal)
          : 1;
      const zoomResponse =
        responding && reaction.mode !== "brightness"
          ? 1 + signal * amount * 0.22
          : 1;
      // Audio changes content, never the mapping outline, mask opacity, or
      // the user's master brightness ceiling.
      gl.uniform1f(
        this.uniforms.brightness,
        unit(project.brightness) * brightnessResponse,
      );
      const screenBlend = !mask && surface.blendMode === "screen";
      // Every layer sets its own blend state so a mask or screen layer cannot
      // accidentally change the meaning of later normal/additive layers.
      gl.blendEquation(gl.FUNC_ADD);
      if (screenBlend) gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_COLOR);
      else
        gl.blendFunc(
          gl.SRC_ALPHA,
          !mask && surface.blendMode === "add"
            ? gl.ONE
            : gl.ONE_MINUS_SRC_ALPHA,
        );
      gl.uniformMatrix3fv(this.uniforms.inverse, false, geometry.inverse);
      gl.uniform4f(
        this.uniforms.layer,
        mask ? 1 : 0,
        screenBlend ? 1 : 0,
        Math.max(0, Math.min(80, surface.feather ?? 0)),
        geometry.count,
      );
      gl.uniform1f(
        this.uniforms.edgeWidth,
        Math.max(
          1,
          Math.min(80, surface.edgeWidth ?? defaultEdgeWidth(surface.source)),
        ),
      );
      const [a, b, c, d] = geometry.contentQuad;
      const physicalLength = (from: typeof a, to: typeof a) =>
        Math.hypot(
          (to.x - from.x) * project.width,
          (to.y - from.y) * project.height,
        );
      // For flat polygons this is their exact content-bounds aspect. For
      // perspective quads, averaged opposite edges give a useful local ratio.
      const aspect =
        (physicalLength(a, b) + physicalLength(d, c)) /
        Math.max(0.000001, physicalLength(a, d) + physicalLength(b, c));
      gl.uniform1f(this.uniforms.surfaceAspect, aspect);
      const content = surface.content;
      const angle = ((content?.rotation ?? 0) * Math.PI) / 180;
      const scale = Math.max(0.05, content?.scale ?? 1) * zoomResponse;
      gl.uniform4f(
        this.uniforms.content,
        content?.offsetX ?? 0,
        content?.offsetY ?? 0,
        Math.cos(angle) / scale,
        Math.sin(angle) / scale,
      );
      if (this.outlineUsesTexture) {
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, geometry.outlineTexture);
        gl.uniform1i(this.uniforms.outlineTexture, 1);
        gl.activeTexture(gl.TEXTURE0);
      } else gl.uniform2fv(this.uniforms["outline[0]"], geometry.outline);
      gl.uniform1i(this.uniforms.source, source);
      gl.uniform1f(this.uniforms.time, this.surfaceClocks.get(surface.id) ?? 0);
      gl.uniform1f(this.uniforms.detail, surface.detail ?? 1);
      gl.uniform1f(this.uniforms.opacity, unit(surface.opacity));
      const color = parseColor(surface.color);
      gl.uniform3f(this.uniforms.color, color[0], color[1], color[2]);
      gl.bindBuffer(gl.ARRAY_BUFFER, geometry.buffer);
      gl.vertexAttribPointer(this.position, 2, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLES, 0, geometry.vertexCount);
    }
    if (++this.frame % 120 === 0) {
      const error = gl.getError();
      if (error !== gl.NO_ERROR)
        this.report(
          `The GPU reported a rendering error (${error}). Reopen the output window.`,
        );
    }
  }

  private getGeometry(surface: Surface): SurfaceGeometry {
    const points = surfacePoints(surface);
    const signature = `${surface.polygon ? "polygon" : "quad"}:${points.map((p) => `${p.x},${p.y}`).join(";")}`;
    const previous = this.geometries.get(surface.id);
    if (previous?.signature === signature) return previous;
    if (points.length < 3 || points.length > 64)
      throw new Error("An outline needs 3 to 64 corners.");
    const contentQuad = surface.polygon ? boundsQuad(points) : surface.corners;
    const inverse = matrixToGL(inverseHomography(contentQuad));
    const indices = surface.polygon
      ? triangulatePolygon(points)
      : [0, 1, 2, 0, 2, 3];
    if (!indices.length)
      throw new Error("The outline could not be triangulated.");
    const vertices = new Float32Array(
      indices.flatMap((i) => [points[i].x, points[i].y]),
    );
    const outline = new Float32Array(128);
    points.forEach((point, i) => {
      outline[i * 2] = point.x;
      outline[i * 2 + 1] = point.y;
    });
    const gl = this.gl!;
    const buffer = gl.createBuffer();
    if (!buffer) throw new Error("Could not allocate surface geometry.");
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
    let outlineTexture: WebGLTexture | null = null;
    if (this.outlineUsesTexture) {
      outlineTexture = gl.createTexture();
      if (!outlineTexture) {
        gl.deleteBuffer(buffer);
        throw new Error("Could not allocate the outline texture.");
      }
      // Two unsigned 16-bit components, packed into RGBA8. No float-texture
      // extension is needed; at 4K the maximum position error is <0.07px.
      const packed = new Uint8Array(256);
      points.forEach((point, i) => {
        const x = Math.round(unit(point.x) * 65535),
          y = Math.round(unit(point.y) * 65535);
        packed.set([x >> 8, x & 255, y >> 8, y & 255], i * 4);
      });
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, outlineTexture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        64,
        1,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        packed,
      );
      gl.activeTexture(gl.TEXTURE0);
    }
    const result = {
      signature,
      inverse,
      contentQuad,
      outline,
      count: points.length,
      vertexCount: indices.length,
      buffer,
      outlineTexture,
    };
    if (previous) this.disposeGeometry(previous);
    this.geometries.set(surface.id, result);
    return result;
  }

  private disposeGeometry(geometry: SurfaceGeometry) {
    this.gl?.deleteBuffer(geometry.buffer);
    if (geometry.outlineTexture)
      this.gl?.deleteTexture(geometry.outlineTexture);
  }

  private disposeAsset(asset: Asset) {
    asset.disposed = true;
    asset.element.onerror = null;
    if (asset.element instanceof HTMLVideoElement) {
      asset.element.onloadeddata = null;
      asset.element.onseeked = null;
      asset.element.pause();
      asset.element.removeAttribute("src");
      asset.element.load();
    } else {
      asset.element.onload = null;
      asset.element.src = "";
    }
    this.gl?.deleteTexture(asset.texture);
  }

  private releaseResources() {
    for (const asset of this.assets.values()) this.disposeAsset(asset);
    this.assets.clear();
    if (this.gridTexture) this.gl?.deleteTexture(this.gridTexture);
    for (const geometry of this.geometries.values())
      this.disposeGeometry(geometry);
    this.geometries.clear();
    if (this.program) this.gl?.deleteProgram(this.program);
    this.gridTexture = null;
    this.program = null;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.canvas.removeEventListener("webglcontextlost", this.onLost);
    this.canvas.removeEventListener("webglcontextrestored", this.onRestored);
    this.releaseResources();
    this.gl?.clear(this.gl.COLOR_BUFFER_BIT);
  }
}

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
const unit = (value: number): number =>
  Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
function parseColor(value: string): [number, number, number] {
  const match = /^#([\da-f]{6})$/i.exec(value);
  if (!match) return [1, 1, 1];
  return [0, 2, 4].map(
    (index) => parseInt(match[1].slice(index, index + 2), 16) / 255,
  ) as [number, number, number];
}

function makeCalibrationGrid(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 1920;
  canvas.height = 1080;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Cannot create the calibration grid.");
  const { width: w, height: h } = canvas;
  ctx.fillStyle = "#07141a";
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "#628481";
  ctx.lineWidth = 2;
  for (let x = 0; x <= 16; x++) {
    ctx.beginPath();
    ctx.moveTo((x * w) / 16, 0);
    ctx.lineTo((x * w) / 16, h);
    ctx.stroke();
  }
  for (let y = 0; y <= 9; y++) {
    ctx.beginPath();
    ctx.moveTo(0, (y * h) / 9);
    ctx.lineTo(w, (y * h) / 9);
    ctx.stroke();
  }
  ctx.strokeStyle = "#c4fce1";
  ctx.lineWidth = 5;
  ctx.strokeRect(3, 3, w - 6, h - 6);
  ctx.beginPath();
  ctx.moveTo(w / 2, 0);
  ctx.lineTo(w / 2, h);
  ctx.moveTo(0, h / 2);
  ctx.lineTo(w, h / 2);
  ctx.stroke();
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.ellipse(w / 2, h / 2, h * 0.27, h * 0.27, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(w, h);
  ctx.moveTo(w, 0);
  ctx.lineTo(0, h);
  ctx.stroke();
  const labels: [string, number, number, CanvasTextAlign][] = [
    ["01 · TOP LEFT", 32, 65, "left"],
    ["02 · TOP RIGHT", w - 32, 65, "right"],
    ["04 · BOTTOM LEFT", 32, h - 32, "left"],
    ["03 · BOTTOM RIGHT", w - 32, h - 32, "right"],
  ];
  ctx.font = "600 34px system-ui, sans-serif";
  for (const [label, x, y, align] of labels) {
    ctx.textAlign = align;
    const textWidth = ctx.measureText(label).width;
    ctx.fillStyle = "#07141a";
    ctx.fillRect(
      align === "left" ? x - 12 : x - textWidth - 12,
      y - 39,
      textWidth + 24,
      53,
    );
    ctx.fillStyle = "#ecfff6";
    ctx.fillText(label, x, y);
  }
  ctx.fillStyle = "#07141a";
  ctx.fillRect(w / 2 - 177, h / 2 - 39, 354, 78);
  ctx.textAlign = "center";
  ctx.font = "600 25px system-ui, sans-serif";
  ctx.fillStyle = "#c4fce1";
  ctx.fillText("PRISM / ALIGNMENT", w / 2, h / 2 + 9);
  return canvas;
}

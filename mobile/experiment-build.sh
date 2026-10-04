#!/usr/bin/env bash
# Temporary. Builds one debug APK per test page. Run after `npm run build`.
set -eu
rm -rf pages experiment-apks
mkdir -p pages/plain pages/canvas2d pages/webgl-tri experiment-apks

cat > pages/plain/index.html <<'HTML'
<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<body style="margin:0;background:#123;color:#fff;font:24px sans-serif">
<h1>plain page</h1><p>No script and no canvas.</p>
HTML

cat > pages/canvas2d/index.html <<'HTML'
<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<body style="margin:0;background:#000">
<canvas id="c" style="width:100vw;height:100vh;display:block"></canvas>
<script>
const c = document.getElementById("c");
const x = c.getContext("2d");
c.width = innerWidth; c.height = innerHeight;
let t = 0;
(function frame() {
  t++;
  x.fillStyle = "hsl(" + (t % 360) + ",80%,50%)";
  x.fillRect(0, 0, c.width, c.height);
  x.fillStyle = "#fff";
  x.fillRect((t * 4) % c.width, 100, 80, 80);
  requestAnimationFrame(frame);
})();
console.log("canvas2d page running");
</script>
HTML

cat > pages/webgl-tri/index.html <<'HTML'
<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<body style="margin:0;background:#000">
<canvas id="c" style="width:100vw;height:100vh;display:block"></canvas>
<script>
const c = document.getElementById("c");
c.width = innerWidth; c.height = innerHeight;
const gl = c.getContext("webgl");
console.log(gl ? "webgl ok: " + gl.getParameter(gl.VERSION) : "webgl missing");
if (gl) {
  const compile = (type, source) => {
    const s = gl.createShader(type); gl.shaderSource(s, source); gl.compileShader(s); return s;
  };
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl.VERTEX_SHADER, "attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }"));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, "precision mediump float; uniform float t; void main(){ gl_FragColor = vec4(0.5 + 0.5 * sin(t), 0.4, 0.8, 1.0); }"));
  gl.linkProgram(program); gl.useProgram(program);
  const buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const p = gl.getAttribLocation(program, "p"); gl.enableVertexAttribArray(p); gl.vertexAttribPointer(p, 2, gl.FLOAT, false, 0, 0);
  const t = gl.getUniformLocation(program, "t");
  (function frame(now) { gl.uniform1f(t, now / 500); gl.drawArrays(gl.TRIANGLES, 0, 3); requestAnimationFrame(frame); })(0);
}
</script>
HTML

# The real app, and the real app with WebGL switched off before it starts.
cp -r dist pages/app
cp -r dist pages/app-nogl
cat > pages/app-nogl/nogl.js <<'JS'
const original = HTMLCanvasElement.prototype.getContext;
HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
  if (typeof type === "string" && /webgl/i.test(type)) return null;
  return original.call(this, type, ...rest);
};
console.log("WebGL switched off for this experiment");
JS
sed -i 's#<head>#<head><script src="./nogl.js"></script>#' pages/app-nogl/index.html
grep -c 'nogl.js' pages/app-nogl/index.html

for page in plain canvas2d webgl-tri app app-nogl; do
  echo "::group::Build the $page APK"
  rm -rf dist
  cp -r "pages/$page" dist
  npx cap sync android > /dev/null
  (cd android && ./gradlew assembleDebug -q)
  cp android/app/build/outputs/apk/debug/app-debug.apk "experiment-apks/$page.apk"
  echo "::endgroup::"
done
ls -l experiment-apks

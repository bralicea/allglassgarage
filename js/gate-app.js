import * as THREE from 'three';
import { GLTFLoader } from './vendor/GLTFLoader.js';
import { EffectComposer } from './post/EffectComposer.js';
import { RenderPass } from './post/RenderPass.js';
import { UnrealBloomPass } from './post/UnrealBloomPass.js';
import { OutputPass } from './post/OutputPass.js';
import { ShaderPass } from './post/ShaderPass.js';

try {
const stage = document.getElementById('stage');
const stageLoader = document.getElementById('stage-loader');
let firstGatePresented = false;
async function presentFirstGate() {
  if (firstGatePresented) return;
  firstGatePresented = true;
  /* Compile the exact production materials and post-processing passes behind
     the loader. This moves the first-use shader hitch off the first visible
     scroll frame without simplifying the render pipeline. */
  try {
    if (typeof renderer.compileAsync === 'function') {
      await renderer.compileAsync(scene, camera);
    } else {
      renderer.compile(scene, camera);
    }
    composer.render();
    window.__startupProfile.shaders = 'ready';
  } catch (error) {
    window.__startupProfile.shaders = 'fallback';
    console.warn('Shader precompile was unavailable; continuing normally.', error);
  }
  /* Let the compiled gate receive a fully composed frame before the cover
     leaves, then begin the photographs after the critical gate request. */
  await new Promise(resolve => requestAnimationFrame(resolve));
  await new Promise(resolve => requestAnimationFrame(resolve));
  stageLoader.classList.add('ready');
  stageLoader.setAttribute('aria-hidden', 'true');
  stage.setAttribute('aria-busy', 'false');
  requestDayAsset();
}
window.__startupProfile = { shaders: 'pending' };
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
/* Mobile Safari/Chrome have far less fill-rate than desktop GPUs. Preserve the
   exact scroll/camera score, but give primary-touch devices a saner render
   budget. Change this one predicate to false for a direct quality A/B. */
const MOBILE_RENDER_BUDGET = matchMedia('(hover:none) and (pointer:coarse)').matches;
const MOBILE_QUALITY_BASELINE = MOBILE_RENDER_BUDGET &&
  new URLSearchParams(location.search).get('mq') === 'baseline';
/* The product needs more mobile edge definition than the original 1.35 cap,
   while 1.75 plus 4x MSAA is too costly for sustained scroll. At 1.55 the
   canvas carries about 32% more pixels; retain dependable 2x MSAA because a
   nominal 3x sample count is not portable across mobile WebGL drivers. The
   mq=baseline comparison switch leaves normal visitors on the 1.55 default. */
const RENDER_DPR_CAP = MOBILE_RENDER_BUDGET ? (MOBILE_QUALITY_BASELINE ? 1.35 : 1.55) : 1.75;
const MOBILE_IDLE_ATMOSPHERE_FPS = 24;
const MOBILE_IDLE_ATMOSPHERE_MS = 1000 / MOBILE_IDLE_ATMOSPHERE_FPS;
/* Lenis smooths the WHEEL itself — browsers deliver it in ~100 px notches, and
   no amount of downstream easing hides a stepped input entirely. Native-scroll
   mode, so position:sticky and the scroll clock work unchanged; our own p-glide
   then rides an already-smooth scrollY. Skipped under reduced motion. */
const lenis = (!reduced && window.Lenis)
  ? new window.Lenis({ autoRaf: false, lerp: 0.12, anchors: true })
  : null;

const renderer = new THREE.WebGLRenderer({ antialias:true, alpha:true, powerPreference:'high-performance' });
renderer.setClearAlpha(0);
renderer.setPixelRatio(Math.min(devicePixelRatio, RENDER_DPR_CAP));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
stage.appendChild(renderer.domElement);
renderer.domElement.addEventListener('webglcontextlost', event => {
  event.preventDefault();
  window.__showGateFallback?.('The interactive 3D view was interrupted. The static site and contact information remain available.');
});
renderer.domElement.addEventListener('webglcontextrestored', () => {
  document.documentElement.classList.remove('runtime-fallback');
  window.__clearGateNotice?.();
  resize();
  invalidate();
});

const scene = new THREE.Scene();   // no background/fog — the backdrop is CSS
const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 200);
const FOV_LANDSCAPE = 30, FOV_PORTRAIT = 38;

/* ---- cinematic environment: dark room with emissive light banks.
   These are what the glass and steel actually reflect — the difference
   between "CG object" and "photographed object". ---- */
function buildEnv() {
  const s = new THREE.Scene();
  s.background = new THREE.Color(0x05060a);
  const bank = (w,h,d,x,y,z,color,power) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w,h,d),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(power) }));
    m.position.set(x,y,z); s.add(m);
  };
  // one BIG soft gradient source does the work — a broad falloff across the
  // surface reads as photography; scattered hot banks read as CG.
  const soft = (w,h,x,y,z,ry,power) => {
    const c = document.createElement('canvas'); c.width = 32; c.height = 256;
    const g = c.getContext('2d');
    const lg = g.createLinearGradient(0,0,0,256);
    lg.addColorStop(0,'#ffffff'); lg.addColorStop(.45,'#cfd6e0');
    lg.addColorStop(.8,'#4a525e'); lg.addColorStop(1,'#0c0e12');
    g.fillStyle = lg; g.fillRect(0,0,32,256);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w,h),
      new THREE.MeshBasicMaterial({ map:new THREE.CanvasTexture(c),
        color:new THREE.Color(power,power,power), side:THREE.DoubleSide }));
    m.position.set(x,y,z); m.rotation.y = ry; s.add(m);
  };
  soft(26, 14, 0, 5.0, 7.5, Math.PI, 2.5);      // the softbox: huge, front-above
  soft(18, 10, -9, 4.0, -1, Math.PI/2, 1.1);    // side wrap, left
  bank(10, 0.4, .2,  7,  3.4, -2, 0xdbe7ff, 1.6);  // thin cool rim streak
  bank(12, 0.3, .2,  0,  1.4, -7, 0xffffff, 0.7);  // low backlight
  /* what the PANES see: mirror glass facing the camera reflects the env BEHIND
     the camera (+z). The reference glass reads as glass because sharp bright
     shapes (door frames, the lit hallway) travel across it — these slim strips
     are that content. Thin area = little smeared lift on the rough frame. */
  bank(0.8, 9, .2,  5.0, 2.6,  9, 0xffffff, 3.6);   // tall streak, camera-right
  bank(0.6, 6, .2, -3.6, 1.8,  9, 0xe8eef8, 2.0);   // second, dimmer, left
  bank(0.7, 8, .2,  8.5, 2.2,  6, 0xf4f7ff, 2.2);   // outriggers: wide azimuths so
  bank(0.7, 8, .2, -8.5, 2.2,  6, 0xfff4e4, 1.8);   //   every beat catches a streak
  bank(9, 0.35, .2,  0.5, 0.35, 9, 0xffedd8, 1.6);  // warm floor-bounce line, low
  const pm = new THREE.PMREMGenerator(renderer);
  const tex = pm.fromScene(s, 0.03).texture;
  return tex;
}
scene.environment = buildEnv();
scene.environmentIntensity = 1.5;

/* practical lights for shape + a hard-ish rim */
const key = new THREE.DirectionalLight(0xfff6ec, 1.6); key.position.set(-5, 6, 7); scene.add(key);
const fill = new THREE.DirectionalLight(0xcfe0f5, 0.6); fill.position.set(6, 2, 6); scene.add(fill);

/* A hard 1.7 rim made the lower bevel resolve as broken white dashes at
   grazing mobile angles. The environment and second rim already provide the
   edge separation; this restrained fill keeps the shape without the artifact. */
const rim = new THREE.DirectionalLight(0xe6f0ff, 0.4); rim.position.set(8, 4.5, -5); scene.add(rim);
const rim2 = new THREE.DirectionalLight(0xf0e2d0, 1.1); rim2.position.set(-8, 3.5, -4); scene.add(rim2);
scene.add(new THREE.AmbientLight(0x353c46, 1.0));
/* nightfall uplights: the landscape fixtures' warm kiss on the aluminum —
   the clearcoat catches sharp streaks along the bevels from below. Dark by
   day; intensity rides the night crossfade (kB) in the render loop. */
const nightUpL = new THREE.DirectionalLight(0xffb46a, 0); nightUpL.position.set(-2.5, -2.2, 4.5); scene.add(nightUpL);
const nightUpR = new THREE.DirectionalLight(0xff9d4d, 0); nightUpR.position.set(3.0, -2.6, 3.8); scene.add(nightUpR);

/* glossy dark floor — catches the light banks as long soft streaks */
function radialPlane(w, h, y, stops, blending) {
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const g = c.getContext('2d');
  const rg = g.createRadialGradient(256,256,8,256,256,256);
  stops.forEach(([o,col]) => rg.addColorStop(o, col));
  g.fillStyle = rg; g.fillRect(0,0,512,512);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({ map:new THREE.CanvasTexture(c), transparent:true,
      opacity:1, depthWrite:false, blending: blending || THREE.NormalBlending }));
  m.rotation.x = -Math.PI/2; m.position.y = y; scene.add(m); return m;
}
// tight contact shadow grounds the leaf without a visible floor horizon
const contact = radialPlane(9, 9, 0.001,
  [[0,'rgba(0,0,0,.72)'],[.42,'rgba(0,0,0,.30)'],[1,'rgba(0,0,0,0)']]);
contact.scale.set(1, 0.13, 1);

/* pool of light under the product — on black, a floor exists only where light
   says it does: a soft elongated pool, brightest under the gate, reaching pure
   black well before the plane's geometric edge so no horizon line ever shows.
   Drawn OVER the mirror (renderOrder) so it doubles as the floor's roughness:
   the reflection reads through a grey scrim, not off polished chrome. */
const pool = softLight(30, 30, new THREE.Vector3(0.227, 0.247, 0.290), 0.32, 9.0, 0.18, 2.2);
pool.rotation.x = -Math.PI / 2; pool.position.y = -0.025;
pool.scale.set(1, 0.55, 1);
pool.position.z = -0.9;
pool.renderOrder = 0;
contact.renderOrder = 0.1;

/* analytic soft light: canvas radial gradients band on a page this dark —
   8-bit stops interpolated linearly leave a visible kink ring at every stop.
   A core+skirt Gaussian pair computed in the shader is smooth everywhere,
   in float precision, with a whisper of dither for the 8-bit output. */
function softLight(w, h, col, a1, k1, a2, k2) {
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uCol: { value: col }, uP: { value: new THREE.Vector4(a1, k1, a2, k2) } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `
      precision highp float; varying vec2 vUv;
      uniform vec3 uCol; uniform vec4 uP;
      void main(){
        vec2 d = (vUv - 0.5) * 2.0;
        float r2 = dot(d, d);
        // no dither here: it lands in LINEAR space where the sRGB transfer has a
        // 12.9x slope near black - the display-space grain pass dithers instead
        float fall = (uP.x * exp(-r2 * uP.y) + uP.z * exp(-r2 * uP.w)) * smoothstep(1.0, 0.7, sqrt(r2));
        gl_FragColor = vec4(uCol, fall);
      }`,
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  scene.add(m); return m;
}

/* caustics — the one effect that is about THIS product: light refracted
   through 12 mm glass, shivering on the floor. Two ridged noise fields drift
   against each other; min() of the pair is the classic filament web. Additive,
   faint, and slow: at a glance it should read as gloss, not as an effect. */
const caustic = (() => {
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uAlpha: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `
      precision highp float; varying vec2 vUv;
      uniform float uTime, uAlpha;
      float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
      float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1,0)), u.x),
                   mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), u.x), u.y); }
      void main(){
        vec2 p = (vUv - 0.5) * vec2(30.0, 15.0);
        float t = uTime * 0.07;
        float a = 1.0 - abs(vnoise(p * 0.55 + vec2(t, t * 0.6)) * 2.0 - 1.0);
        float b = 1.0 - abs(vnoise(p * 0.65 + vec2(-t * 0.8, t * 0.5) + 3.7) * 2.0 - 1.0);
        float c = pow(min(a, b), 5.0);
        float m = 1.0 - smoothstep(0.16, 0.48, length(vUv - 0.5));
        gl_FragColor = vec4(vec3(0.60, 0.68, 0.84) * c, c * m * uAlpha);
      }`,
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(22, 11), mat);
  m.rotation.x = -Math.PI / 2; m.position.set(0.2, -0.022, 0.2);
  m.renderOrder = 0.05; scene.add(m); return m;
})();

/* horizon glow — the cyc wall. A dying ember of light at the floor line, far
   behind the gate, gone a third of the way up the frame. It has a physical
   alibi the old background wash never had: it is the pool's spill hitting a
   back wall. Drawn first among the transparent set so all smoke sits over it;
   depth-tested, so the gate occludes it and the glass shows it through. */
const glow = softLight(44, 8, new THREE.Vector3(0.463, 0.431, 0.376), 0.20, 8.0, 0.14, 2.4);
glow.position.set(0.2, -0.55, -11);
glow.renderOrder = -0.7;   // over the far bank (24 m) - the wall sits at 11 m



/* ---- surface micro-detail: flat CG colour is the tell. A fine noise normal +
   roughness break-up gives powder-coated steel something to catch light on. ---- */
function microMaps() {
  const S = 512;
  const nc = document.createElement('canvas'); nc.width = nc.height = S;
  const rc = document.createElement('canvas'); rc.width = rc.height = S;
  const ng = nc.getContext('2d'), rg = rc.getContext('2d');
  const nd = ng.createImageData(S,S), rd = rg.createImageData(S,S);
  for (let i = 0; i < S*S; i++) {
    const n = (Math.random()*2-1);
    const o = i*4;
    nd.data[o]   = 128 + n*10;          // tangent-space X
    nd.data[o+1] = 128 + (Math.random()*2-1)*10;
    nd.data[o+2] = 255; nd.data[o+3] = 255;
    const v = 150 + n*26;
    rd.data[o] = rd.data[o+1] = rd.data[o+2] = v; rd.data[o+3] = 255;
  }
  ng.putImageData(nd,0,0); rg.putImageData(rd,0,0);
  const mk = (c, rep) => { const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep, rep); return t; };
  return { normal: mk(nc, 26), rough: mk(rc, 18) };
}
const MICRO = microMaps();

/* ---- SMOKE ----------------------------------------------------------------
   The overlapping-planes technique (the CodePen) has a hard ceiling: each card
   only spins about its own axis, so you get slow swirl and never flow — and it
   costs ~70 full-screen alpha fills to get even that.
   This is animated fractal noise with DOMAIN WARPING instead: fbm whose input
   coordinates are themselves displaced by fbm. That feedback is what produces
   curling, billowing motion rather than rotation. It is ONE full-screen pass,
   it genuinely evolves over time, and density/contrast/speed are all dials.
   Two layers: a far one behind everything that kills the backdrop, and a faint
   near one drifting between camera and product. Both ride on the camera so they
   always fill the view however it orbits.
   ------------------------------------------------------------------------- */
const SMOKE_FRAG = `
precision highp float;
varying vec2 vUv;
uniform float uTime, uAlpha, uSeed, uScale, uWarp, uContrast, uEdge, uFloor;
uniform float uMaskOn, uFeather, uInside, uTopBoost;
uniform float uHorizon, uLift;
uniform vec2 uGlowPos, uGlowRad;
uniform float uGlowAmt;
uniform vec3 uGlowCol;
uniform vec2  uMaskMin, uMaskMax;
uniform vec3  uLo, uHi;
uniform vec2  uAspect;

float hash(vec2 p){
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1,0)), u.x),
             mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), u.x), u.y);
}
float fbm(vec2 p){
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 6; i++){ v += a * vnoise(p); p *= 2.06; a *= 0.52; }
  return v;
}
void main(){
  vec2 uv = (vUv - 0.5) * uAspect * uScale + uSeed;
  float t = uTime * 0.055;

  // domain warp: displace the sample point by noise, twice. This is what makes
  // it billow and curl instead of merely drifting.
  vec2 q = vec2(fbm(uv + vec2(0.0, t)), fbm(uv + vec2(5.2, 1.3) - t * 0.8));
  vec2 r = vec2(fbm(uv + uWarp * q + vec2(1.7, 9.2) + t * 0.45),
                fbm(uv + uWarp * q + vec2(8.3, 2.8) - t * 0.36));
  float f = fbm(uv + uWarp * r);

  // a soft wide ramp, not a threshold — smoke has no hard edges
  float d = smoothstep(uFloor, uFloor + uContrast, f);

  // let it thin slightly toward the middle so the product keeps its contrast,
  // and thicken into the corners
  float rad = length((vUv - 0.5) * vec2(1.35, 1.0));
  d *= mix(1.0 - uEdge, 1.0, smoothstep(0.10, 0.85, rad));

  // stratified like real fog: it pools on the floor and thins with altitude.
  // uHorizon is the projected floor line, so the gradient rides the camera.
  float alt  = smoothstep(uHorizon + 0.02, uHorizon + 0.62, vUv.y);
  float sink = smoothstep(uHorizon + 0.06, uHorizon - 0.30, vUv.y);
  d *= mix(1.0, uLift, alt) * (1.0 + 0.18 * sink);

  if (uMaskOn > 0.5) {
    // signed distance to the product's screen rect; noise gnaws the boundary so
    // wisps lap over the silhouette instead of a clean vignette
    vec2 ctr = (uMaskMin + uMaskMax) * 0.5, half_ = (uMaskMax - uMaskMin) * 0.5;
    vec2 dd = abs(vUv - ctr) - half_;
    float sd = length(max(dd, 0.0)) + min(max(dd.x, dd.y), 0.0);
    float wob = (fbm(uv * 1.4 + vec2(7.7, 2.2) + t * 0.5) - 0.5) * uFeather * 2.4;
    float outside = smoothstep(-uFeather * 0.3, uFeather, sd + wob);
    // dry-ice belt hugging the sill line, wobbling with the noise
    float bandLo = smoothstep(uFeather * 1.9, 0.0, abs(vUv.y - uMaskMin.y + wob * 0.6) - 0.02) * 0.45;
    float bandHi = smoothstep(uFeather * 1.3, 0.0, abs(vUv.y - uMaskMax.y + wob * 0.6) - 0.012) * 0.7;
    d *= clamp(max(outside, uInside) + bandLo + bandHi, 0.0, 1.0);
    // the upper haze: the zone above the rect sits far from every below-horizon
    // boost, so the showcase lifts it explicitly (0 everywhere but the band mask)
    d *= 1.0 + uTopBoost * smoothstep(uMaskMax.y - 0.02, uMaskMax.y + 0.12, vUv.y);
  }
  vec3 col = mix(uLo, uHi, clamp(length(r) * 0.85 + f * 0.5, 0.0, 1.0));
  // fog in front of the backlight scatters it toward the camera: inside the
  // glow's screen ellipse the smoke warms and thins instead of going black
  vec2 gd = (vUv - uGlowPos) / max(uGlowRad, vec2(1e-3));
  float glit = exp(-dot(gd, gd) * 1.6) * uGlowAmt;
  col = mix(col, uGlowCol, clamp(glit, 0.0, 0.8));
  gl_FragColor = vec4(col, d * uAlpha * (1.0 - 0.22 * clamp(glit, 0.0, 1.0)));
}`;
const SMOKE_VERT = `varying vec2 vUv; void main(){ vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

function makeSmokeLayer(dist, opts) {
  const mat = new THREE.ShaderMaterial({
    vertexShader: SMOKE_VERT, fragmentShader: SMOKE_FRAG,
    /* depthTest ON is what keeps smoke BEHIND the product: with it off, the mid
       layer's later render order painted it straight over the frame in 2D even
       though it sat behind in 3D — the residual "smoke on the frame". The glass
       only escaped by drawing later still. */
    transparent: true, depthWrite: false, depthTest: !opts.overlay,
    uniforms: {
      uTime: { value: 0 }, uAlpha: { value: 0 },
      uSeed: { value: opts.seed }, uScale: { value: opts.scale },
      uWarp: { value: opts.warp }, uContrast: { value: opts.contrast },
      uEdge: { value: opts.edge }, uFloor: { value: opts.floor },
      uHorizon: { value: 0.35 }, uLift: { value: opts.lift },
      uGlowPos: { value: new THREE.Vector2(0.5, 0.4) },
      uGlowRad: { value: new THREE.Vector2(0.4, 0.15) },
      uGlowAmt: { value: opts.glowAmt }, uGlowCol: { value: new THREE.Vector3(0.55, 0.50, 0.42) },
      uMaskOn: { value: opts.overlay ? 1 : 0 }, uFeather: { value: 0.19 },
      uTopBoost: { value: 0 },
      uInside: { value: 0.12 },
      uMaskMin: { value: new THREE.Vector2(0, 0) }, uMaskMax: { value: new THREE.Vector2(1, 1) },
      uLo: { value: new THREE.Color(opts.lo) }, uHi: { value: new THREE.Color(opts.hi) },
      uAspect: { value: new THREE.Vector2(1, 1) },
    },
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  m.position.z = -dist;
  m.renderOrder = opts.order;
  m.frustumCulled = false;
  m.userData.dist = dist;
  camera.add(m);                        // rides the camera, always fills the view
  return m;
}
scene.add(camera);                       // camera must be in the graph for children to render

const smokeFar  = makeSmokeLayer(24, { seed: 0.0,  scale: 2.5, warp: 0.9, contrast: 0.34,
                                       floor: 0.30, edge: 0.30, lo: 0x121820, hi: 0x7d8b9f, order: -1, lift: 0.45, glowAmt: 0.55 });
/* No layer ever sits in front of the product. The old near veil is gone, and
   the mid layer TRACKS the camera-to-product distance each frame (it used to
   hang at a fixed 7 m, so beats that pulled the camera back past 7 m put the
   product BEHIND the smoke — that was the "smoke covers the product" bug). */
const smokeMid  = makeSmokeLayer(7, { seed: 12.3, scale: 2.1, warp: 0.95, contrast: 0.36,
                                     floor: 0.38, edge: 0.44, lo: 0x18202a, hi: 0x717f93, order: 1, lift: 0.32, glowAmt: 0.45 });
/* the AURA: deliberately drawn over the product, but shaped by a screen-space
   mask of the leaf — full smoke outside the silhouette, wisps lapping across the
   edges, ~10% inside, and a fog belt along the sill. Engulfed, not obscured. */
const smokeAura = makeSmokeLayer(1.9, { seed: 57.2, scale: 1.8, warp: 1.0, contrast: 0.40,
                                        floor: 0.42, edge: 0.0, lo: 0x2a323e, hi: 0x9aa8bc,
                                        order: 6, overlay: true, lift: 0.35, glowAmt: 0.35 });
const smokeLayers = [smokeFar, smokeMid, smokeAura];
window.__smoke = { far: smokeFar, mid: smokeMid, aura: smokeAura };   // A/B handle

const _mv = new THREE.Vector3(), _gv = new THREE.Vector3(), _ax = new THREE.Vector3();
const glowAnchor = new THREE.Vector3(0.2, 0.45, 0);   // behind the gate's upper body: the halo crowns the cap in every beat
function leafMaskUv() {
  const x0 = leaf.position.x - 0.06, x1 = leaf.position.x + 4.16;
  let mnx = 2, mny = 2, mxx = -1, mxy = -1;
  // y reaches below the floor line: the reflection is part of the silhouette now
  for (const x of [x0, x1]) for (const y of [-0.85, 1.34]) for (const z of [-0.06, 0.06]) {
    _mv.set(x, y, z).project(camera);
    const u = _mv.x * 0.5 + 0.5, v = _mv.y * 0.5 + 0.5;
    if (u < mnx) mnx = u; if (u > mxx) mxx = u;
    if (v < mny) mny = v; if (v > mxy) mxy = v;
  }
  return [mnx, mny, mxx, mxy];
}
function fitSmoke() {
  const vf = camera.fov * Math.PI / 180;
  for (const m of smokeLayers) {
    const h = 2 * Math.tan(vf / 2) * m.userData.dist, w = h * camera.aspect;
    m.scale.set(w * 1.04, h * 1.04, 1);
    m.material.uniforms.uAspect.value.set(camera.aspect, 1);
  }
}
let smokeAlpha = 0, smokeTime = 0;

let leaf=null, leafBaseX=0, leafBaseY=0, frameMat=null;
let mirror=null, mirrorLeaf=null; const mirrorFrameMats=[];
let finishIdx = 0;
const FLOOR_Y = -0.02;

/* ---- composition variants ----
   Three leaf GLBs share one envelope — same dimensions, travel and material
   names — so "yours to compose" is demonstrated, not asserted: swap the
   geometry, keep everything else. Records are cached and never disposed;
   every variant stays warm once visited. */
const COMPS = [
  /* bump a ?v= whenever a GLB is re-baked - same filename, so browsers
     otherwise keep serving their cached copy of the old geometry */
  ['Vertical',     'assets/glass-gate-vertical.glb?v=3'],
  ['Horizontal',   'assets/glass-gate-horizontal.glb?v=7'],
  ['Single sheet', 'assets/glass-gate-single.glb?v=7'],
];
let compIdx = 0, gate = null;          // current variant record
const gateCache = new Map();           // url -> record | pending Promise

function buildGateRecord(gs) {
  const rec = { root: gs, mirrorMats: [], frameMat: null,
                glassMats: [], glassMeshes: [], baseGlassMat: null,
                mirrorGlassMats: [], glassOrigMap: null, mirrorAllMats: [] };
  rec.leaf = gs.getObjectByName('GateLeaf');
  rec.leafBaseX = rec.leaf ? rec.leaf.position.x : 0;
  rec.leafBaseY = rec.leaf ? rec.leaf.position.y : 0;
  gs.traverse(o => {
    if (!o.material) return;
    const n = o.material.name || '';
    if (n.startsWith('glass')) {
      o.material.envMapIntensity = 3.4;   // dark glass reads by what it reflects
      o.material.roughness = 0.045;
      o.material.depthWrite = false; o.renderOrder = 2;
      if (!rec.glassMats.includes(o.material)) rec.glassMats.push(o.material);
      rec.glassMeshes.push(o);
      rec.baseGlassMat = rec.baseGlassMat || o.material;
      rec.glassOrigMap = rec.glassOrigMap || o.material.map;   // the baked dark-tint ramp
    } else if (n.startsWith('frame')) {
      /* Premium architectural powder-coat, the automotive-paint recipe: a
         satin COLOURED body under a thin GLOSSY clearcoat. Two specular
         lobes — the rough base keeps the broad soft sheen, the clearcoat adds
         the sharp streak highlights along the bevels that say "lacquered".
         Base metalness stays low so reflections stay neutral-white instead of
         tinted dark by the finish colour (the tell of cheap CG metal).
         Env intensity stays modest: the milky wash that once read as "smoke on
         the frame" was rough-metal env smear — the clearcoat lobe is sharp, so
         it streaks instead of smearing. */
      if (!rec.frameMat) {
        const std = o.material;
        rec.frameMat = new THREE.MeshPhysicalMaterial({
          name: std.name, map: std.map, color: std.color,
          /* the real finish is deep satin-MATTE: flat faces stay calm, only
             bevels and the cap edge glint. Low sharp clearcoat does exactly
             that — highlights need curvature to catch. Env held down so the
             new pane-reflection strips don't lift the rough body. */
          metalness: 0.52, roughness: 0.52, roughnessMap: MICRO.rough,
          envMapIntensity: 0.55,
          clearcoat: 0.4, clearcoatRoughness: 0.14,
        });
      }
      // no noise normal map: with real bevels + baked AO it only bends the edge
      // highlights into wobbly lines at close range
      o.material = rec.frameMat;
    }
  });
  /* the reflection: a second gate flipped about the floor plane, fading with
     depth below it. On a black page this faint mirrored image IS the floor —
     nothing else can tell the eye a surface exists there. BackSide corrects the
     winding the negative scale flips; no depth writes, so the smoke banks
     behind it are never cut along a gate-shaped silhouette. */
  const fadeAlpha = (mat, base, aFloor = 0) => {
    mat.transparent = true; mat.opacity = base;
    mat.userData.baseOp = base;
    mat.depthWrite = false; mat.side = THREE.BackSide;
    mat.userData.aFloor = { value: aFloor };   // uniform, so the glass picker can retune it live
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uAFloor = mat.userData.aFloor;
      sh.vertexShader = 'varying float vWY;\n' + sh.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvWY = (modelMatrix * vec4(position, 1.0)).y;');
      sh.fragmentShader = 'uniform float uAFloor;\nvarying float vWY;\n' + sh.fragmentShader.replace(
        '#include <dithering_fragment>',
        '#include <dithering_fragment>\ngl_FragColor.a = max(gl_FragColor.a, uAFloor) * smoothstep(-1.05, 0.0, vWY);');
    };
    // the floor is a uniform now, so one program legitimately serves every material
    mat.customProgramCacheKey = () => 'mirrorfade';
    mat.needsUpdate = true;
  };
  rec.mirror = gs.clone(true);
  rec.mirror.scale.y = -1;
  rec.mirror.position.y = 2 * FLOOR_Y;
  rec.mirror.traverse(o => {
    if (!o.material) return;
    o.material = o.material.clone();
    const n = o.material.name || '';
    if (n.startsWith('glass')) { o.material.envMapIntensity = 3.0; fadeAlpha(o.material, 0.55, 0.35); rec.mirrorGlassMats.push(o.material); }
    else if (n.startsWith('frame')) { o.material.envMapIntensity = 0.45; rec.mirrorMats.push(o.material); fadeAlpha(o.material, 0.34); }
    else fadeAlpha(o.material, 0.34);
    rec.mirrorAllMats.push(o.material);
    o.renderOrder = -0.5;
  });
  return rec;
}

function applyFinish() {
  const [, hx, metal] = FINISHES[finishIdx];
  if (frameMat) { frameMat.color.setHex(hx); frameMat.metalness = metal ?? 0.52; }
  for (const m of mirrorFrameMats) { m.color.setHex(hx); m.metalness = metal ?? 0.52; }
  window.__applyBloomBase?.();
}

/* ---- glass options ----
   The smoked tint in the GLBs is nothing but a 4x256 gradient ramp (see
   build-gate.mjs STOPS) on an alpha-blend material, so the other glasses their
   catalogue offers are sibling ramps generated here plus re-tuned scalars —
   picking a glass is a texture swap, never a rebuild or a bake.
   Alpha-blend glass shows env reflections scaled by its own alpha, so each
   option compensates with envMapIntensity: clear runs high intensity under
   very low alpha to keep the streaks that say "glass" on a nearly invisible
   pane; frosted trades the sharp streaks for a rough, milky env glow. Every
   pane is two sheets (front/back), so per-sheet alpha compounds: a-eff =
   1-(1-a)^2 — tune with that in mind. */
function glassRamp(stops) {
  const at = (t) => {          // same Catmull-Rom resampler as the build script
    let i = 0;
    while (i < stops.length - 2 && t > stops[i + 1][0]) i++;
    const p0 = stops[Math.max(0, i - 1)], p1 = stops[i], p2 = stops[i + 1],
          p3 = stops[Math.min(stops.length - 1, i + 2)];
    const u = (t - p1[0]) / (p2[0] - p1[0]), out = [];
    for (let c = 1; c <= 4; c++) out.push(0.5 * ((2 * p1[c]) + (-p0[c] + p2[c]) * u
      + (2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c]) * u * u
      + (-p0[c] + 3 * p1[c] - 3 * p2[c] + p3[c]) * u * u * u));
    return out;
  };
  const H = 256, data = new Uint8Array(4 * H * 4);
  for (let y = 0; y < H; y++) {
    const [r, g, b, a] = at(y / (H - 1));   // row 0 = pane top, matching the GLB ramp
    for (let x = 0; x < 4; x++) {
      const o = (y * 4 + x) * 4;
      data[o] = Math.round(r); data[o + 1] = Math.round(g); data[o + 2] = Math.round(b);
      data[o + 3] = Math.round(Math.max(0, Math.min(1, a)) * 255);
    }
  }
  const tex = new THREE.DataTexture(data, 4, H);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}
/* [name, ramp (null = the GLB's baked one), scalars] */
const GLASSES = [
  ['Dark-tint', null,
    { rough: 0.045, env: 3.4,  mirrorEnv: 3.0,  mirrorOp: 0.55, floor: 0.35 }],
  ['Frosted', glassRamp([[0.00, 150, 156, 163, 0.16],
                         [1.00, 150, 156, 163, 0.16]]),
    /* blur: the front panes swap to the thin-transmission material below;
       these scalars only shape the faint floor reflection */
    { rough: 0.50,  env: 0.60, mirrorEnv: 0.60, mirrorOp: 0.50, floor: 0.20, blur: true }],
  ['Clear', glassRamp([[0.00, 168, 182, 178, 0.045],
                       [1.00, 168, 182, 178, 0.045]]),
    { rough: 0.045, env: 11.0, mirrorEnv: 9.0,  mirrorOp: 0.30, floor: 0.08 }],
];
let glassIdx = 0;
function applyGlass() {
  if (!gate) return;
  const [, tex, g] = GLASSES[glassIdx];
  if (g.blur) {
    if (!gate.frostedMat) gate.frostedMat = makeFrostedMat(gate.baseGlassMat);
    for (const o of gate.glassMeshes) o.material = gate.frostedMat;
  } else {
    const m = gate.baseGlassMat;
    m.map = tex || gate.glassOrigMap;
    m.roughness = g.rough; m.envMapIntensity = g.env;
    m.needsUpdate = true;
    for (const o of gate.glassMeshes) o.material = m;
  }
  for (const m of gate.mirrorGlassMats) {
    m.map = tex || gate.glassOrigMap;
    m.roughness = g.rough; m.envMapIntensity = g.mirrorEnv;
    m.userData.baseOp = g.mirrorOp;
    m.opacity = g.mirrorOp;
    if (m.userData.aFloor) m.userData.aFloor.value = g.floor;
    m.needsUpdate = true;
  }
}

/* ---- frosted, for real ----
   Alpha-blend can dim what is behind a pane but never blur it, and three's
   built-in transmission pass ignores the transparent list — the smoke — so
   frosted uses a hand-rolled thin transmission: everything except the gate is
   rendered into a mipmapped half-res target, and the pane samples it at a
   coarse LOD. Genuine haze (~90% like real satin etch), smoke included. The
   prepass runs only while Frosted is the live glass, inside the same
   invalidation window as everything else. */
let bgRT = null;
const BG_CLEAR = new THREE.Color(0x05060a);   // the CSS backdrop's base
const frostU = { bg: { value: null }, size: { value: new THREE.Vector2(1, 1) },
                 lod: { value: 2.7 }, transmit: { value: 0.82 } };
function renderBg() {
  const sz = renderer.getDrawingBufferSize(new THREE.Vector2());
  const w = Math.max(1, sz.x >> 1), h = Math.max(1, sz.y >> 1);
  if (!bgRT) bgRT = new THREE.WebGLRenderTarget(w, h, {
    generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter, type: THREE.HalfFloatType,
  });
  else if (bgRT.width !== w || bgRT.height !== h) bgRT.setSize(w, h);
  gate.root.visible = false; gate.mirror.visible = false;
  bgQuad.visible = !!(bgQuadU.tA.value && bgQuadU.tB.value);
  bgQuadU.uQSize.value.set(w, h);
  const tm = renderer.toneMapping, rt = renderer.getRenderTarget();
  const oc = renderer.getClearColor(new THREE.Color()), oa = renderer.getClearAlpha();
  renderer.toneMapping = THREE.NoToneMapping;   // the pane's own output tone-maps once
  renderer.setRenderTarget(bgRT);
  renderer.setClearColor(BG_CLEAR, 1);
  renderer.render(scene, camera);
  renderer.setRenderTarget(rt);
  renderer.setClearColor(oc, oa);
  renderer.toneMapping = tm;
  gate.root.visible = true; gate.mirror.visible = true;
  bgQuad.visible = false;
  frostU.bg.value = bgRT.texture;
  frostU.size.value.set(sz.x, sz.y);
}
/* the DOM backdrop lives OUTSIDE the GL scene, so the frost prepass used to
   transmit only the dark studio — over the house shots the panes read as flat
   gray cards. This quad reproduces the DOM compositing (cover fit, Ken Burns
   zoom, day/night crossfade, nightfall dip, the CSS grade) INSIDE the prepass,
   so frosted panes transmit genuinely blurred house light. It is visible only
   while bgRT renders — the main pass still composites over the real DOM. */
const bgQuadU = {
  tA: { value: null }, tB: { value: null },
  uQSize: { value: new THREE.Vector2(1, 1) },   // the PREPASS viewport (half-res)
  uKB: { value: 0 }, uDip: { value: 0 }, uPhotoK: { value: 0 },
  /* band-aware sampling, computed on the CPU (see the uniform update in the
     render loop): uv = 0.5 + (frag - uC) * uK, uFeather softens the band's
     top/bottom into the studio base on portrait */
  uK: { value: new THREE.Vector2(1, 1) }, uC: { value: new THREE.Vector2(0.5, 0.5) },
  uFeather: { value: 0 },
};
function textureFromBackdropImage(image) {
  /* The DOM photograph and WebGL frost prepass share one decoded image. This
     avoids a second HTTP request while preserving the original pixels. */
  const texture = new THREE.Texture(image);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}
function loadBackdropImage(image, url, complete, failed) {
  let settled = false;
  const cleanup = () => {
    image.removeEventListener('load', loaded);
    image.removeEventListener('error', errored);
  };
  const loaded = async () => {
    if (settled) return;
    settled = true;
    cleanup();
    try { await image.decode?.(); } catch (_) { /* load already succeeded */ }
    complete(textureFromBackdropImage(image));
  };
  const errored = error => {
    if (settled) return;
    settled = true;
    cleanup();
    failed(error);
  };
  image.addEventListener('load', loaded);
  image.addEventListener('error', errored);
  image.src = url;
  if (image.complete && image.naturalWidth) queueMicrotask(loaded);
}
let dayAssetRequested = false, dayTextureLoaded = false;
let nightAssetRequested = false, nightTextureLoaded = false;
function requestDayAsset() {
  if (dayAssetRequested) return;
  dayAssetRequested = true;
  const url = bdA.dataset.src || 'assets/installed-coastal.webp';
  loadBackdropImage(bdA, url, texture => {
    bgQuadU.tA.value = texture;
    /* Until the deferred night plate arrives, frosted glass transmits the day
       plate instead of dropping to a gray prepass on an unusually slow link. */
    if (!bgQuadU.tB.value) bgQuadU.tB.value = texture;
    dayTextureLoaded = true;
    invalidate();
  }, error => {
    console.warn('Installation photograph failed to load.', error);
    window.__showGateNotice?.('The installation photograph could not load. The gate presentation remains available.');
  });
}
function requestNightAsset() {
  if (nightAssetRequested) return;
  nightAssetRequested = true;
  const url = bdB.dataset.src || 'assets/coastal-night.webp';
  loadBackdropImage(bdB, url, texture => {
    bgQuadU.tB.value = texture;
    nightTextureLoaded = true;
    invalidate();
  }, error => {
    console.warn('Night photograph failed to load; retaining the daytime view.', error);
    window.__showGateNotice?.('The night photograph could not load. The daytime presentation remains available.');
  });
}
window.__dayAsset = {
  get requested() { return dayAssetRequested; },
  get loaded() { return dayTextureLoaded; },
};
window.__nightAsset = {
  get requested() { return nightAssetRequested; },
  get loaded() { return nightTextureLoaded; },
};
const bgQuad = new THREE.Mesh(
  new THREE.PlaneGeometry(2, 2),
  new THREE.ShaderMaterial({
    uniforms: bgQuadU, depthTest: false, depthWrite: false,
    vertexShader: 'void main(){ gl_Position = vec4(position.xy, 0.99999, 1.0); }',
    fragmentShader: `
      uniform sampler2D tA, tB; uniform vec2 uQSize, uK, uC;
      uniform float uKB, uDip, uPhotoK, uFeather;
      void main(){
        vec2 f = gl_FragCoord.xy / uQSize;
        vec2 uv = 0.5 + (f - uC) * uK;
        vec3 col = mix(texture2D(tA, uv).rgb, texture2D(tB, uv).rgb, uKB);
        col = mix(vec3(dot(col, vec3(0.2126, 0.7152, 0.0722))), col, 0.78) * 0.76;
        col = (col - 0.5) * 1.05 + 0.5;
        vec3 base = vec3(0.002, 0.0025, 0.004);      // the studio clear, linear-ish
        if (uFeather > 0.0)                          // the portrait band's soft edges
          col = mix(base, col, smoothstep(0.0, uFeather, uv.y) * smoothstep(1.0, 1.0 - uFeather, uv.y));
        col = mix(col, base, uDip);
        col = mix(base, max(col, 0.0), uPhotoK);
        gl_FragColor = vec4(col, 1.0);
      }`,
  })
);
bgQuad.frustumCulled = false; bgQuad.renderOrder = -10; bgQuad.visible = false;
scene.add(bgQuad);

function makeFrostedMat(base) {
  const m = base.clone();
  m.map = null;
  m.color.setHex(0x373c43);            // satin scatter body — thin, so transmission leads
  m.transparent = false; m.opacity = 1; m.depthWrite = true;
  m.roughness = 0.85; m.roughnessMap = MICRO.rough;   // ~0.5 after the noise map
  m.normalMap = MICRO.normal; m.normalScale.set(0.5, 0.5);
  m.envMapIntensity = 0.45;
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uBg = frostU.bg; sh.uniforms.uBgSize = frostU.size;
    sh.uniforms.uLod = frostU.lod; sh.uniforms.uTransmit = frostU.transmit;
    sh.fragmentShader = 'uniform sampler2D uBg; uniform vec2 uBgSize; uniform float uLod, uTransmit;\n'
      + sh.fragmentShader.replace('#include <opaque_fragment>',
        'outgoingLight += textureLod(uBg, gl_FragCoord.xy / uBgSize, uLod).rgb * uTransmit;\n#include <opaque_fragment>');
  };
  m.customProgramCacheKey = () => 'frostblur';
  m.needsUpdate = true;
  return m;
}

function installGate(rec) {
  if (gate) { scene.remove(gate.root); scene.remove(gate.mirror); }
  gate = rec;
  scene.add(rec.root); scene.add(rec.mirror);
  leaf = rec.leaf; leafBaseX = rec.leafBaseX; leafBaseY = rec.leafBaseY;
  mirror = rec.mirror; mirrorLeaf = rec.mirror.getObjectByName('GateLeaf');
  frameMat = rec.frameMat;
  mirrorFrameMats.length = 0; mirrorFrameMats.push(...rec.mirrorMats);
  applyFinish();                       // the live finish follows the geometry
  applyGlass();                        // ...and so does the chosen glass
  for (const m of rec.mirrorAllMats) m.opacity = (m.userData.baseOp ?? m.opacity);
  window.__mirror = mirror;   // perf A/B handle
  pool.position.x = leafBaseX + 0.2;   // stage centre: midpoint of closed and slid-open extents
  glowAnchor.x = leafBaseX + 0.2;
  caustic.position.x = leafBaseX + 0.2;
  window.__clearGateNotice?.();
  invalidate();          // the model landed after the scene had settled
}

function reportCompLoadError(i, error) {
  console.error(`Gate composition failed to load: ${COMPS[i][0]}`, error);
  if (i === 0 && !gate) {
    window.__showGateFallback?.('The interactive 3D gate could not load. The static site and contact information remain available.');
  } else {
    window.__showGateNotice?.(`The ${COMPS[i][0]} gate could not load. The current composition remains available.`);
  }
}
function loadComp(i, done, failed = error => reportCompLoadError(i, error)) {
  const url = COMPS[i][1], hit = gateCache.get(url);
  if (hit && hit.root) { done(hit); return; }
  if (hit) { hit.then(done).catch(failed); return; }    // already in flight
  const pr = new Promise((res, reject) => new GLTFLoader().load(url, (g) => {
    const rec = buildGateRecord(g.scene);
    rec.compIndex = i;
    gateCache.set(url, rec); res(rec);
  }, undefined, error => {
    gateCache.delete(url);                              // a later click can retry
    reject(error);
  }));
  gateCache.set(url, pr); pr.then(done).catch(failed);
}
loadComp(0, (rec) => {
  installGate(rec); buildChips(); buildCompChips(); buildGlassChips();
  window.__syncChipLang?.();
  presentFirstGate();
});

/* ---- bloom: glow only on the brightest specular hits ---- */
const composer = new EffectComposer(renderer);
const COMPOSER_SAMPLES = MOBILE_RENDER_BUDGET ? 2 : 4;
composer.renderTarget1.samples = COMPOSER_SAMPLES;
composer.renderTarget2.samples = COMPOSER_SAMPLES;
window.__renderProfile = {
  mobile: MOBILE_RENDER_BUDGET, dprCap: RENDER_DPR_CAP, samples: COMPOSER_SAMPLES,
  quality: MOBILE_RENDER_BUDGET ? (MOBILE_QUALITY_BASELINE ? 'baseline' : 'midpoint') : 'desktop',
  idleAtmosphereFps: MOBILE_RENDER_BUDGET ? MOBILE_IDLE_ATMOSPHERE_FPS : 60,
};
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(1,1), 0.16, 0.45, 0.95);
composer.addPass(bloom);
composer.addPass(new OutputPass());
/* the unifier: fine animated grain + a gentle vignette, applied after tone
   mapping so every layer — sharp product, soft smoke, flat UI-adjacent black —
   picks up the same photographic texture and the corners lean the eye inward. */
const grade = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    varying vec2 vUv; uniform sampler2D tDiffuse; uniform float uTime;
    float gr(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      float v = smoothstep(0.62, 1.08, length((vUv - 0.5) * vec2(1.15, 1.0)));
      c.rgb *= 1.0 - 0.20 * v;
      c.rgb += (gr(vUv * 917.0 + fract(uTime * 0.613) * 7.3) - 0.5) * 0.028;
      gl_FragColor = c;
    }`,
});
composer.addPass(grade);
/* nightfall on the gate itself: the aluminum takes a warm kiss from the
   landscape uplights and bloom opens up so the highlights carry. The glass
   keeps its tint — a dark pane at night IS dark; the story lives in the
   frame's specular and what shows through the panes. Keyed to the same kB
   as the photo crossfade. */
let nightKCur = -1;
/* Bloom thresholds in LINEAR pre-tonemap light: a white powder-coat frame's
   whole diffuse surface sits at ~1.3-1.8 under the key — far over 0.95 — so
   on White the entire gate feeds the bloom pass and fogs the frame (severity
   varies by GPU; headless under-reports it). Per-finish base: White lets only
   true speculars through — painted white metal doesn't glow. */
function applyBloomBase() {
  bloom.threshold = FINISHES[finishIdx][0] === 'White' ? 1.60 : 0.95;
  invalidate();
}
window.__applyBloomBase = applyBloomBase;   // runs via applyFinish on every install/pick
function setNightGlow(k) {
  nightUpL.intensity = 0.55 * k;
  nightUpR.intensity = 0.35 * k;
  bloom.strength  = 0.16 + 0.08 * k;
}

/* render-loop state — declared before anything can call invalidate() */
let mobileIdleAtmosphereAt = 0;
let cueVis = null, lastHeroUI = -1, lastStuck = null, renderFor = 90;
const ndip = document.getElementById('nightdip');
const dock = document.getElementById('dock');
const dtog = document.getElementById('docktoggle');
function setDockOpen(open) {
  dock.classList.toggle('open', open);
  dtog.setAttribute('aria-expanded', String(open));
}
dtog.addEventListener('click', () => setDockOpen(!dock.classList.contains('open')));
/* On compact layouts the dock behaves like a popover: an outside touch/click
   and Escape both return the visitor to the scene. */
document.addEventListener('pointerdown', event => {
  if (dock.classList.contains('open') && !dock.contains(event.target)) setDockOpen(false);
}, { passive:true });
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && dock.classList.contains('open')) {
    setDockOpen(false);
    dtog.focus({ preventScroll:true });
  }
});
let lastDock = -1;
const gateclose = document.getElementById('gateclose'),
      leafL = document.getElementById('leafL'), leafR = document.getElementById('leafR'),
      sealpane = document.getElementById('sealpane'), frostBlob = document.getElementById('frostblob'),
      closecap = document.getElementById('closecap');
let lastClose = -1, lastNavLight = null, sealedCur = false, closeKCur = 0;
/* the journey bar: chapter bounds in p-space and the two label sets */
const ST_SECT = [[0, 0.64], [0.64, 0.948], [0.948, 1.0001]];
const ST_EN = ['Presentation', 'Demonstration', 'Contact'];
const ST_ES = ['Presentación', 'Demostración', 'Contacto'];
const sheetglow = document.getElementById('sheetglow'),
      blueprint = document.querySelector('#closecap .blueprint'),
      countEls = [...document.querySelectorAll('#closecap .snum[data-count]')];
const revealEls = Object.fromEntries(
  [...document.querySelectorAll('#closecap .arr[data-reveal]')]
    .map(el => [el.dataset.reveal, el])
);
/* Change only this value to restore the previous transition. Its DOM, styles,
   and frame branch remain intact so comparison/revert does not require a
   reconstruction. */
const CONTACT_TRANSITION = 'frost-blob'; // alternative: 'gate-close'
const USING_FROST_BLOB = CONTACT_TRANSITION === 'frost-blob';
const CONTACT_START = 0.989;
const CONTACT_RANGE = 1 - CONTACT_START;
gateclose.classList.toggle('frost-blob', USING_FROST_BLOB);
/* Each range is a slice of the final sealed-gate scroll. The content now has
   the same deterministic clock as the rest of the film: stop scrolling and it
   stops; reverse and it reverses. Overflowing sheets add a viewport gate so
   below-fold mobile content cannot reveal before it is actually reached. */
const REVEAL_RANGES = {
  eyebrow:[0.00,0.20], title:[0.04,0.32], body:[0.12,0.42], stamp:[0.18,0.50],
  dealer:[0.22,0.58], owner:[0.42,0.76], blueprint:[0.48,0.82],
  details:[0.65,0.93], footer:[0.78,1.00],
};
const REVEAL_NAMES = Object.keys(REVEAL_RANGES);
const VIEWPORT_REVEALS = new Set(['owner','blueprint','details','footer']);
/* Only the non-interactive masthead overlaps the circle expansion. It shares
   the remaining radial travel after the glass first reaches that region, and
   closecap is clipped to the glass edge so no dark type escapes onto the night
   scene. Routes, links, drawing, and details keep the post-cover clock. */
const SURFACE_REVEAL_RANGES = {
  eyebrow:[0.00,0.42], title:[0.08,0.68], body:[0.28,1.00],
};
const SURFACE_REVEAL_NAMES = Object.keys(SURFACE_REVEAL_RANGES);
const revealLast = Object.create(null);
let lastRuleReveal = -1, lastArr = null, countT0 = 0, countsPlayed = false;
const revealEase = t => { t = Math.min(1, Math.max(0, t)); return t*t*(3-2*t); };
const revealRange = (v, a, b) => revealEase((v - a) / (b - a));
let frostTextEntryK = 1;
function measureFrostTextEntry() {
  if (!USING_FROST_BLOB) { frostTextEntryK = 1; return; }
  const sr = stage.getBoundingClientRect();
  const cx = sr.left + sr.width * 0.5, cy = sr.top + sr.height;
  const maxRadius = Math.hypot(sr.width * 0.5, sr.height) * 1.04;
  const margin = 18;
  let entryRadius = Infinity;
  for (const name of SURFACE_REVEAL_NAMES) {
    const el = revealEls[name];
    if (!el) continue;
    const r = el.getBoundingClientRect();
    /* getBoundingClientRect includes this reveal's own translateY. Remove it
       so the cached layout threshold is independent of current reveal state. */
    const inlineRy = parseFloat(el.style.getPropertyValue('--ry'));
    const revealShift = Number.isFinite(inlineRy) ? inlineRy : 14;
    const left = r.left - margin, right = r.right + margin;
    /* Adding scrollTop recovers the masthead's stage position even if a resize
       or language change happens while the mobile sheet is at its tail. */
    const top = r.top + closecap.scrollTop - revealShift - margin;
    const bottom = r.bottom + closecap.scrollTop - revealShift + margin;
    const nearestX = Math.max(left, Math.min(cx, right));
    const nearestY = Math.max(top, Math.min(cy, bottom));
    entryRadius = Math.min(entryRadius, Math.hypot(nearestX - cx, nearestY - cy));
  }
  frostTextEntryK = Number.isFinite(entryRadius)
    ? Math.min(1, Math.max(0, entryRadius / maxRadius))
    : 1;
}
window.__measureFrostTextEntry = measureFrostTextEntry;
function frostTextSurfaceProgress(radius, maxRadius) {
  if (!USING_FROST_BLOB || radius <= 0 || maxRadius <= 0) return 0;
  const entryRadius = maxRadius * frostTextEntryK;
  /* The text clock starts as the glass first reaches the masthead. closecap is
     clipped to the same radius, so only text already over frost can be seen. */
  return Math.min(1, Math.max(0,
    (radius - entryRadius) / Math.max(1, maxRadius - entryRadius)
  ));
}
function viewportReveal(el) {
  const r = el.getBoundingClientRect();
  /* Short items (notably the footer) should finish while they are still on
     screen; large items get a longer, calmer entrance. */
  const travel = Math.min(innerHeight * 0.18, Math.max(48, r.height * 0.55));
  return revealEase((innerHeight - r.top) / travel);
}
function updateContactReveals(progress, enabled, surfaceProgress = 0) {
  const contactP = Math.min(1, Math.max(0, (progress - CONTACT_START) / CONTACT_RANGE));
  const viewportGated = sheetTail > 0;
  let detailsReveal = 0;
  for (const name of REVEAL_NAMES) {
    const range = REVEAL_RANGES[name];
    const el = revealEls[name];
    if (!el) continue;
    let v = enabled ? revealRange(contactP, range[0], range[1]) : 0;
    const surfaceRange = SURFACE_REVEAL_RANGES[name];
    if (surfaceRange)
      v = Math.max(v, revealRange(surfaceProgress, surfaceRange[0], surfaceRange[1]));
    if (viewportGated && v > 0 && VIEWPORT_REVEALS.has(name))
      v = Math.min(v, viewportReveal(el));
    v = Math.round(v * 1000) / 1000;
    if (name === 'details') detailsReveal = v;
    if (v === revealLast[name]) continue;
    revealLast[name] = v;
    el.style.setProperty('--rv', v.toFixed(3));
    el.style.setProperty('--ry', ((1 - v) * 14).toFixed(2) + 'px');
  }
  let ruleV = enabled ? revealRange(contactP, 0.12, 0.52) : 0;
  ruleV = Math.round(ruleV * 1000) / 1000;
  if (ruleV !== lastRuleReveal) {
    lastRuleReveal = ruleV;
    closecap.style.setProperty('--rule-rv', ruleV.toFixed(3));
  }
  return detailsReveal;
}
const bpTry = () => {   // the drawing draws only once it is actually SEEN
  if (lastArr && (revealLast.blueprint || 0) > 0.15 &&
      !blueprint.classList.contains('bpin') &&
      blueprint.getBoundingClientRect().top < innerHeight * 0.85)
    blueprint.classList.add('bpin');
};
document.getElementById('closecap').addEventListener('scroll', bpTry, { passive: true });
const stl = document.getElementById('stimeline'),
      stLabel = document.getElementById('stlabel'),
      stSegs = [...document.querySelectorAll('#stimeline .stseg')],
      stFills = stSegs.map(el => el.firstElementChild);
let lastStOn = null, lastStKey = -1;
document.querySelectorAll('#stimeline .stseg').forEach(el =>
  el.addEventListener('click', () => {
    const y = parseFloat(el.dataset.goto) * (track.offsetHeight - innerHeight);
    if (lenis) lenis.scrollTo(y, { duration: 1.4 }); else scrollTo({ top: y, behavior: 'smooth' });
  }));
const bdrop = document.getElementById('backdrop'),
      bdA = document.getElementById('bd-a'), bdB = document.getElementById('bd-b');
let lastBd = -1, lastTr = '';
/* the studio's own furniture, faded out under the photographs. Bases are the
   tuned values above; envKCur scales them (and the mirror) live. */
let envKCur = 1;
const POOL_A0 = pool.material.uniforms.uP.value.x, POOL_A1 = pool.material.uniforms.uP.value.z;
const GLOW_A0 = glow.material.uniforms.uP.value.x, GLOW_A1 = glow.material.uniforms.uP.value.z;
function invalidate(){ renderFor = Math.max(renderFor, 45); }

/* ---- finishes ---- */
/* All Glass Garage's real frame palette. Black leads: closest to the physical
   gate, and its cool near-black sits naturally in the site's cold grade.
   White is powder-coat, not bare metal — a metalness override keeps it reading
   as coated aluminium instead of chrome. */
const FINISHES = [['Black',0x23262a],['Bronze',0x473c2f],
                  ['Silver',0xa6a9a6],['White',0xe1ded7,0.10]];
function buildChips() {
  const wrap = document.getElementById('chips');
  FINISHES.forEach(([name,hex,metal],i) => {
    const b = document.createElement('button');
    b.className = 'chip'; b.type = 'button';
    b.title = name; b.setAttribute('aria-label', name);
    b.setAttribute('aria-pressed', i===0 ? 'true':'false');
    b.innerHTML = `<span class="sw" style="background:#${hex.toString(16).padStart(6,'0')}"></span>${name}`;
    b.onclick = () => {
      finishIdx = i;
      applyFinish();
      invalidate();
      wrap.querySelectorAll('.chip').forEach(c => c.setAttribute('aria-pressed','false'));
      b.setAttribute('aria-pressed','true');
    };
    wrap.appendChild(b);
  });
}

/* the glass picker lives in the beat-04 composer, beside composition and finish.
   Same chip grammar; the swatch is a rendered-in-CSS coupon of each glass.
   Picking one also rewrites the beat heading/body and the schedule row, in
   their own catalogue language (clear "for a wide-open view", frosted for
   privacy with natural light). */
const GLASS_SW = [
  'linear-gradient(150deg, rgba(255,255,255,.36), rgba(255,255,255,0) 45%), #131417',
  'linear-gradient(150deg, rgba(255,255,255,.55), rgba(255,255,255,.10) 60%), rgba(214,221,228,.52)',
  'linear-gradient(150deg, rgba(255,255,255,.5), rgba(255,255,255,0) 40%), rgba(236,242,248,.14)',
];
function buildGlassChips() {
  const wrap = document.getElementById('glasschips');
  GLASSES.forEach(([name], i) => {
    const b = document.createElement('button');
    b.className = 'chip'; b.type = 'button';
    b.title = name; b.setAttribute('aria-label', name);
    b.setAttribute('aria-pressed', i === 0 ? 'true' : 'false');
    b.innerHTML = `<span class="sw" style="background:${GLASS_SW[i]}"></span>${name}`;
    b.onclick = () => {
      glassIdx = i;
      applyGlass(); invalidate();
      wrap.querySelectorAll('.chip').forEach(c => c.setAttribute('aria-pressed', 'false'));
      b.setAttribute('aria-pressed', 'true');
    };
    wrap.appendChild(b);
  });
}

/* the composition picker: the same chip grammar as the finishes, but the
   swatch is a one-line elevation diagram of each archetype. Picking one also
   rewrites the schedule's Composition and Open-slots rows below the film. */
const COMP_ICONS = [
  '<svg class="cw" viewBox="0 0 18 18" fill="none" aria-hidden="true"><rect x="1.5" y="3.5" width="15" height="11" stroke="currentColor" stroke-width="1.2"/><path d="M6.5 3.5v11M11.5 3.5v11" stroke="currentColor" stroke-width="1.2"/></svg>',
  '<svg class="cw" viewBox="0 0 18 18" fill="none" aria-hidden="true"><rect x="1.5" y="3.5" width="15" height="11" stroke="currentColor" stroke-width="1.2"/><path d="M1.5 7.2h15M1.5 10.8h15" stroke="currentColor" stroke-width="1.2"/></svg>',
  '<svg class="cw" viewBox="0 0 18 18" fill="none" aria-hidden="true"><path d="M1.5 3.5h15M1.5 14.5h15" stroke="currentColor" stroke-width="1.2"/><path d="M2.4 3.5v11M15.6 3.5v11" stroke="currentColor" stroke-width="1.2"/><path d="M7.2 11.6l4.6-4.6" stroke="currentColor" stroke-width="1" opacity=".45"/></svg>',
];
const SPEC_COMP = [
  'Drawn to the opening — a single sheet, horizontal bands, or a vertical rhythm (shown)',
  'Drawn to the opening — a single sheet, a vertical rhythm, or horizontal bands (shown)',
  'Drawn to the opening — horizontal bands, a vertical rhythm, or one uninterrupted sheet (shown)',
];
const SPEC_SLOTS = [
  'Optional — 500 × 90 mm, alternating head and sill as shown',
  'Optional — full-height 90 mm slits on a running bond, framed both sides',
  'None — one uninterrupted pane',
];
function syncCompChoice(i) {
  const sc = document.getElementById('spec-comp'), ss = document.getElementById('spec-slots');
  if (sc) sc.textContent = SPEC_COMP[i];
  if (ss) ss.textContent = SPEC_SLOTS[i];
  document.querySelectorAll('#compchips .chip').forEach((c, n) =>
    c.setAttribute('aria-pressed', String(n === i)));
}
function buildCompChips() {
  const wrap = document.getElementById('compchips');
  COMPS.forEach(([name], i) => {
    const b = document.createElement('button');
    b.className = 'chip'; b.type = 'button';
    b.title = name; b.setAttribute('aria-label', name);
    b.setAttribute('aria-pressed', i === 0 ? 'true' : 'false');
    b.innerHTML = COMP_ICONS[i] + name;
    b.onclick = () => {
      compIdx = i;
      syncCompChoice(i);
      loadComp(i, (rec) => {
        if (compIdx === i) installGate(rec);
      }, error => {
        if (compIdx === i) {
          compIdx = gate?.compIndex ?? 0;
          syncCompChoice(compIdx);
        }
        reportCompLoadError(i, error);
      });
    };
    wrap.appendChild(b);
  });
}

/* ---- the score: [p, azimuth°, polar°, dist, targetX, targetY, open] ---- */
/* tx/ty are the camera's look point: they place the product in the frame
   around the copy. Negative tx pushes the product right; higher ty drops it lower. */
/* ONE POSE PER BEAT. The camera holds NEAR-still while a beat is on screen
   (see BREATHE below) and MOVES only between them, so every transition has the
   same shape. Interpolating
   straight through keyframes (the old way) made speed vary 17x between segments
   and eased the camera to a near-stop at every key — that read as inconsistent.
   tx/ty are the look point: negative tx pushes the product right, higher ty drops it.
   Last column: on portrait, 1 = fit the whole leaf in frame, 0 = keep the crop. */
/* Columns 6-10 are the ATMOSPHERE GRADE for the beat — the smoke is keyframed
   per shot exactly like the camera, because a balance tuned for a 90%-footprint
   close crop is wrong for a 25%-footprint wide shot. aura/mid/far are layer
   strengths; feather is how deep wisps lap the silhouette; inside is the film
   over the product's faces. */
/* THE WALK, RE-CHOREOGRAPHED: every move has ONE dominant axis — truck, dolly
   or pedestal — never the old arc+dolly+pan compound (that read as a drone).
   Distance runs in three motivated phrases instead of a sawtooth: step OUT to
   the reveal (3.0->6.4), close IN on the parked leaf (->5.6->3.5), then OUT to the finale
   (->6.8). Azimuth still walks the length without crossing the line; the finale
   arcs back to a dead-frontal of the CLOSED gate (the leaf shuts on camera
   during the pull-back) under the centred CTA. */
const POSES = [
  //  az  alt  dist     tx    ty  fit  aura   mid   far  feath inside
  [ -50,  92, 3.90, -1.35, 0.90, 1,   0.48, 0.58, 1.00, 0.19, 0.12],  // arrival — low at the left end, down the length
  [ -34,  86, 3.40, -0.70, 0.82, 0,   0.32, 0.45, 0.87, 0.13, 0.07],  // colonnade — TRUCK along the bays + PEDESTAL to eye level
  [  -8,  84, 6.40, -1.60, 0.72, 1,   0.16, 0.22, 0.75, 0.11, 0.03],  // frontal — DOLLY OUT to the reveal; the leaf slides; near smoke
                                                                      // thinned: the transmissive panes show the mid bank through
                                                                      // themselves, so at full mid the gate reads veiled
  [  22,  83, 3.80, -4.30, 0.62, 1,   0.20, 0.34, 0.88, 0.11, 0.04],  // the guard — in tight and low on the parked leaf's shoulder
  [   0,  88, 6.80,  0.00, 0.95, 1,   0.24, 0.26, 0.85, 0.13, 0.05],  // the composer finale — the grand pull-back to the FULL FRONTAL; the
                                                                      // leaf shuts on camera and is composed head-on in the dock
];
/* Hold window per beat. The gaps are the moves, and their durations are
   PROPORTIONAL TO HOW FAR THE CAMERA TRAVELS (weights: 1/deg of arc,
   100/log-unit of dolly, 12/m of truck) — so every move runs at the same
   perceived speed. Text windows tile at the gap midpoints. */
const HOLDS = [[0.00,0.080],[0.129,0.209],[0.326,0.406],[0.495,0.575],[0.700,1.20]];

/* ---- two clocks ----
   The track is 1000vh: the first 640vh are the film, unchanged to the pixel —
   POSES/HOLDS and the leaf's timeline all run on the film's own clock
   pf = p/FILM_FRAC. Everything past the finale is the INSTALLED SHOWCASE:
   the composed gate stays on camera, frontal and closed, while the studio
   (smoke, floor pool, horizon ember, mirror) dissolves out and photographed
   projects dissolve in behind it. */
const FILM_FRAC = 0.64;
const OVERSCAN = 1.02;   // hides the blur's soft edge at zoom 1 — the solve must use it too
const SHOW = {
  photoIn: [0.660, 0.728],   // the scene resolves AFTER the studio has dimmed and the camera has mostly settled
  /* ONE estate, two exposures: the night plate is the SAME photograph relit,
     so the change of shot is a slow lighting dissolve over identical
     geometry — the gate holds perfectly still while night falls around it. */
  nightX:  [0.763, 0.903],
};

/* ---- fitting the leaf into the photographs ----
   Each backdrop is calibrated by hand: the opening's pier inner edges (xL,xR)
   and the ground line at the pier plane (yG), in image UV of the 1536x1024
   originals. shotPose() maps them through object-fit:cover + the Ken Burns
   zoom into screen fractions, then solves the frontal camera (az 0, alt 88)
   so the leaf spans the opening pier-to-pier — ends tucked just over the
   pier faces, sill on the ground line. Solved per frame: the pose then rides
   the zoom, so gate and photograph stay locked together. */
/* Measured on ZOOMED per-pier ruler crops (gridL_/gridR_ recipe) — full-frame
   grids kept mis-reading edges by ±0.02, which is a visible seam. yTL/yTR are
   the two pier tops (they differ); xL/xR are the inner edges at their WIDEST
   (the base), so the mask always covers the whole pier body. */
/* coastal6A native plate; night relight matches within 2 px, dusk yG serves both
   (the night scanner reads low — it catches the uplight pools, not the bases) */
const CAL = { xL: 0.192, xR: 0.807, yG: 0.807 };   // nudged from render crops; +0.002 re-centers the leaf (right gap was wider than left)
/* the backdrop's on-screen rectangle. Landscape: the full viewport (cover).
   Portrait: cover of a landscape plate would show a ~30% slice of the estate
   at enormous scale, so the photograph becomes a full-width BAND instead —
   sized so the pier opening spans most of the screen, placed so its ground
   line sits at a fixed screen height, feathered top and bottom into the
   page's dark. CSS layout, the frost-prepass quad and the camera solve all
   read THIS one function. */
const BAND_Q = 0.70;       // fraction of the plate's width visible on portrait
const BAND_GROUND = 0.56;  // the opening's ground line, as a screen fraction
function bdGeom() {
  const W = stage.clientWidth, H = stage.clientHeight;
  if (W >= H) return { by: 0, bw: W, bh: H };
  const bh = W * (1024 / 1536) / BAND_Q;      // band aspect: full plate height visible
  return { by: BAND_GROUND * H - CAL.yG * bh, bw: W, bh };
}
function shotPose(cal, zoom) {
  const W = stage.clientWidth, H = stage.clientHeight;
  const g = bdGeom();
  const sc = Math.max(g.bw / 1536, g.bh / 1024);      // the backdrop's object-fit:cover, in its band
  const iw = 1536 * sc, ih = 1024 * sc, ox = (iw - g.bw) / 2, oy = (ih - g.bh) / 2;
  const cy = (g.by + g.bh / 2) / H;                   // Ken Burns scales about the BAND's centre
  const zf = f => 0.5 + (f - 0.5) * zoom;
  const zfy = f => cy + (f - cy) * zoom;
  const xsL = zf((cal.xL * iw - ox) / W), xsR = zf((cal.xR * iw - ox) / W);
  const ysG = zfy((cal.yG * ih - oy + g.by) / H);
  const tanV = Math.tan(camera.fov * Math.PI / 360), tanH = tanV * camera.aspect;
  /* staged, not composited: the 4.16 m leaf (caps included) spans the full
     opening — flush against both piers. */
  const GW = 4.16;
  const wT = xsR - xsL, cxT = (xsL + xsR) / 2;
  const d = GW / (2 * tanH * wT);
  const tx = (leafBaseX + 2.05) - (cxT - 0.5) * 2 * d * tanH;
  /* LEVEL camera: the photographs are one-point frontals with plumb piers, so
     the shot view must be level too — the film's 2° down-tilt keystoned the
     gate's verticals against the columns (touching at the cap, open at the
     base). Level, ty lands ~1.2 m: the plates' own stated eye height. */
  const k = (ysG - 0.5) * 2 * tanV;                   // ground line's screen offset as a view tangent
  const ty = d * k;
  return { d, tx, ty };
}


/* Beat windows in TOTAL scroll (film windows x FILM_FRAC; b6 trimmed so the
   CTA dissolves exactly as the first project materialises). */
const BEATS = [['b1',-0.032,0.0666],['b2',0.0666,0.1715],['b3',0.1715,0.288],
               ['b4',0.288,0.3994],['b5',0.460,0.600],
               ['s1',0.700,0.782],['s2',0.888,0.980]];

/* Beat offsets come from CSS, but reading them per frame (getComputedStyle × 12)
   forces a style recalc every frame — that was the jank. Read once, cache, and
   refresh only on resize. Each entry also remembers its last written values so
   we only touch the DOM when something actually changed. */
const beatState = BEATS.map(([id, f0, f1]) => ({
  el: document.getElementById(id), f0, f1, fw: id[0] === 's' ? 0.016 : 0.0224,
  tx:'0px', ty:'0px', lastVis:-1, live:false
}));
function cacheBeatOffsets() {
  for (const b of beatState) {
    const cs = getComputedStyle(b.el);
    b.tx = cs.getPropertyValue('--tx').trim() || '0px';
    b.ty = cs.getPropertyValue('--ty').trim() || '0px';
  }
}

const smooth = t => t*t*(3-2*t);
const clamp01 = t => Math.min(1, Math.max(0, t));

/* BREATHE: holds are not frozen — a barely-perceptible dolly creep (±1.4% of
   the shot's distance) runs through every hold, so the frame always carries
   motion and each move accelerates out of a creep instead of lurching from a
   standstill. Dolly only: the product never slides laterally under the copy. */
const BREATHE = 0.014;
function score(p){
  let i = HOLDS.length - 1;
  while (i > 0 && p < HOLDS[i][0]) i--;
  const h0 = HOLDS[i][0], h1 = HOLDS[i][1];
  // inside a hold the pose is exact but for the breathing creep on distance
  if (p <= h1 || i === POSES.length - 1) {
    const out = POSES[i].slice();
    const t = clamp01((p - h0) / (h1 - h0));
    out[2] *= 1 + BREATHE * (1 - 2 * t);
    return out;
  }
  const a = POSES[i], b = POSES[i+1];
  const t = smooth(clamp01((p - h1) / (HOLDS[i+1][0] - h1)));
  const out = a.map((v, k) => v + (b[k] - v) * t);
  // distance interpolates in LOG space: a linear dolly from 9.2 m to 3.3 m appears
  // to accelerate wildly, because apparent size goes as 1/d. The endpoints carry
  // the breathing offsets so hold creep and move meet with no step.
  out[2] = Math.exp(Math.log(a[2] * (1 - BREATHE)) +
                   (Math.log(b[2] * (1 + BREATHE)) - Math.log(a[2] * (1 - BREATHE))) * t);
  // out[5] ('fit') rides the default interpolation: the portrait camera
  // BLENDS crop and fit framing by it, so snapping it mid-move would pop
  return out;
}

/* The leaf has its OWN timeline, decoupled from the camera: it slides while beat 3
   arrives and settles, so you watch it move instead of it jumping during a move. */
function leafOpenAt(p){
  if (p < 0.30) return 0;
  if (p < 0.45) return smooth((p - 0.30) / 0.15);     // slides through the frontal hold
  if (p < 0.60) return 1;                             // parked through the guard
  return 1 - smooth(clamp01((p - 0.60) / 0.09));      // shuts on camera during the pull-back
}

const qp = new URLSearchParams(location.search);
const forced = qp.has('p') ? parseFloat(qp.get('p')) : null;
let target = forced ?? (reduced ? 0.02 : 0), p = target, mx=0, my=0, smx=0, smy=0;
window.__state = {
  get p() { return p; }, get target() { return target; },
  get closeK() { return closeKCur; }, get contactTransition() { return CONTACT_TRANSITION; }
};   // test probe, like __mirror/__smoke
addEventListener('mousemove', e => { mx=(e.clientX/innerWidth-.5)*2; my=(e.clientY/innerHeight-.5)*2; });

/* ---- drag-orbit on the composer beat ----
   The drag never places the camera: it feeds an angle offset ON TOP of the
   scored pose, armed by a gain window that rises with the dock and unwinds
   inside the scored pull-back — so the photo solve is never disturbed.
   touch-action pan-y keeps vertical touch drags as page scroll; horizontal
   drags turn the gate (the embedded-viewer convention). A released drag
   keeps its pose while the beat holds. */
let dragAzT = 0, dragAltT = 0, sDragAz = 0, sDragAlt = 0, dragGain = 0;
let dragging = false, dragPX = 0, dragPY = 0, dragTravel = 0, lastHint = -1, grabCur = null;
let dragCandidate = null, dragPointerType = '';
let touchDragStartX = 0, touchDragStartAz = 0;
const draghint = document.getElementById('draghint');
const dhHand = draghint.querySelector('.dh-hand');
const dhAmp = matchMedia('(pointer:coarse)').matches ? 13 : 9;
let swayK = 1, swayCur = 0;
function beginDrag(e, x = e.clientX, y = e.clientY) {
  dragging = true; dragPointerType = e.pointerType;
  dragPX = x; dragPY = y;
  if (e.pointerType === 'touch') {
    touchDragStartX = x;
    touchDragStartAz = sDragAz;
  }
  stage.setPointerCapture(e.pointerId);
  stage.style.cursor = 'grabbing';
  e.preventDefault();
}
stage.addEventListener('pointerdown', e => {
  if (dragGain < 0.05 || dock.classList.contains('open') || e.target.closest('#dock')) return;
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  if (e.pointerType === 'touch') {
    /* Do not claim a finger until its intent is clearly horizontal. Vertical
       movement remains native page scrolling, which removes the old tug-of-war. */
    dragCandidate = { id:e.pointerId, x:e.clientX, y:e.clientY };
    return;
  }
  beginDrag(e);
});
stage.addEventListener('pointermove', e => {
  if (!dragging && dragCandidate?.id === e.pointerId) {
    const totalX = e.clientX - dragCandidate.x;
    const totalY = e.clientY - dragCandidate.y;
    if (Math.hypot(totalX, totalY) < 9) return;
    if (Math.abs(totalY) >= Math.abs(totalX) * 0.9) {
      dragCandidate = null;             // native pan-y keeps ownership
      return;
    }
    const start = dragCandidate;
    dragCandidate = null;
    beginDrag(e, start.x, start.y);
  }
  if (!dragging) return;
  const dx = e.clientX - dragPX, dy = e.clientY - dragPY;
  dragPX = e.clientX; dragPY = e.clientY;
  /* grab metaphor: the surface follows the pointer, so both angles run
     against the drag. Clamps keep the smoke planes and floor honest. */
  const touch = dragPointerType === 'touch';
  if (touch) {
    /* Touch must be genuinely direct-manipulation. Previously the finger
       advanced dragAzT while the visible sDragAz eased behind it; reversing
       first had to consume that hidden backlog, so the gate kept moving the
       wrong way. Move both angles together so the next signed delta always
       reverses the visible gate immediately. */
    const directAz = touchDragStartAz - (e.clientX - touchDragStartX) * 0.34;
    dragAzT = sDragAz = Math.min(55, Math.max(-55, directAz));
  } else {
    dragAzT = Math.min(55, Math.max(-55, dragAzT - dx * 0.22));
  }
  /* A touch swipe owns only the horizontal orbit; pitch remains a mouse/pen
     refinement so diagonal fingers do not fight vertical page movement. */
  if (!touch) dragAltT = Math.min(6, Math.max(-28, dragAltT - dy * 0.16));
  dragTravel += Math.abs(dx) + Math.abs(dy);
});
const endDrag = e => {
  if (dragCandidate?.id === e.pointerId) dragCandidate = null;
  if (!dragging) return;
  dragging = false;
  dragPointerType = '';
  try { stage.releasePointerCapture(e.pointerId); } catch {}
  stage.style.cursor = grabCur ? 'grab' : '';
};
stage.addEventListener('pointerup', endDrag);
stage.addEventListener('pointercancel', endDrag);
window.__drag = {
  get az(){ return sDragAz; }, get alt(){ return sDragAlt; },
  get gain(){ return dragGain; }, get sway(){ return swayCur; },
  get active(){ return dragging; }, get pending(){ return !!dragCandidate; },
};

const nav = document.getElementById('nav'), cue = document.getElementById('cue');
const standfirst = document.getElementById('standfirst'), pcard = document.getElementById('pcard');
for (const el of [standfirst, pcard]) el.style.transition = 'opacity .5s';
const track = document.getElementById('track');

function resize(){
  const w = stage.clientWidth, h = stage.clientHeight;
  renderer.setSize(w,h); composer.setSize(w,h);
  bloom.resolution.set(w/2, h/2);   // bloom is a blur; half res is free quality
  camera.aspect = w/h;
  camera.fov = w < h ? FOV_PORTRAIT : FOV_LANDSCAPE;
  camera.updateProjectionMatrix();
  fitSmoke();
  layoutBackdrop();
  cacheBeatOffsets();
  measureSheetTail();
  measureFrostTextEntry();
  lastClose = -1;   // the blob's far-corner radius is viewport-measured
  invalidate();
}
/* Lenis hijacks wheel/touch document-wide, so a nested scroller never gets
   them. The portrait sheet IS one (it holds the blueprint below the fold) —
   hand those events back natively there, and ONLY there: on desktop the sheet
   doesn't overflow and must keep the film's smooth scrolling. Re-checked
   whenever the layout can change, since fonts land after the first measure. */
/* The sheet is taller than a phone. It used to be a NESTED SCROLLER, which
   made the way back out feel broken: on a 375x667 handset ~590px of the ~900px
   journey up was the sheet unwinding inside itself — the frost behind it frozen,
   the page scrollbar not moving because the page was already at its end, and the
   sheet's own bar suppressed. It read as the page being stuck.
   Its overflow is appended to the TRACK instead: the sheet scrolls with the page
   in one continuous motion, the browser's own scroll indicator keeps moving
   through it. On overflowing layouts a short handoff runway sits between the
   sheet tail and the film, so reversing out of Contact is deliberate rather
   than an accidental one-tick cut back to the night scene.
   Driven by MEASUREMENT (it must follow the real content), but only ever read
   after layout — see the call sites below. */
let sheetTail = 0, sheetY = 0, lastSheetY = -1,
    contactRunway = 0, contactRunwayExtra = 0;
function measureSheetTail() {
  if (!closecap) return;
  /* Recover the unextended film length even when this is a resize remeasure
     and the track still contains the previous tail/runway additions. */
  const baseFilmMax = Math.max(
    1, track.offsetHeight - innerHeight - sheetTail - contactRunwayExtra
  );
  /* only where the CSS actually CLIPS the sheet — an overflow:visible box
     reports its overflow inconsistently, and desktop is tuned to fit anyway */
  const clipped = getComputedStyle(closecap).overflowY !== 'visible';
  const over = clipped ? Math.max(0, closecap.scrollHeight - closecap.clientHeight) : 0;
  /* Replace the film's very short native CONTACT_RANGE with a useful physical
     gesture: about 36vh, capped so tall tablets do not feel laborious. */
  const runway = over
    ? Math.round(Math.min(340, Math.max(220, innerHeight * 0.36)))
    : 0;
  const runwayExtra = over
    ? Math.max(0, runway - baseFilmMax * CONTACT_RANGE)
    : 0;
  if (Math.abs(over - sheetTail) < 1 &&
      Math.abs(runway - contactRunway) < 1 &&
      Math.abs(runwayExtra - contactRunwayExtra) < 1) return;
  sheetTail = over;
  contactRunway = runway;
  contactRunwayExtra = runwayExtra;
  track.style.height = over
    ? `calc(1000vh + ${over + runwayExtra}px)`
    : '';
  if (!over) { closecap.scrollTop = 0; sheetY = 0; lastSheetY = -1; }
}
window.__measureSheetTail = measureSheetTail;
measureSheetTail();
measureFrostTextEntry();
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => {
  measureSheetTail();
  measureFrostTextEntry();
  lastClose = -1;
  invalidate();
});
/* portrait turns #backdrop into the photo band (see bdGeom); landscape
   restores the full-bleed cover. Feathered into the page dark on portrait. */
function layoutBackdrop() {
  const g = bdGeom(), H = stage.clientHeight;
  if (g.bh < H) {
    bdrop.style.top = g.by + 'px'; bdrop.style.height = g.bh + 'px'; bdrop.style.bottom = 'auto';
    const m = 'linear-gradient(180deg, transparent, #000 34px, #000 calc(100% - 30px), transparent)';
    bdrop.style.webkitMaskImage = m; bdrop.style.maskImage = m;
  } else {
    bdrop.style.top = '0'; bdrop.style.height = '100%'; bdrop.style.bottom = 'auto';
    bdrop.style.webkitMaskImage = ''; bdrop.style.maskImage = '';
  }
}
addEventListener('resize', resize); cacheBeatOffsets(); resize();

let lastT = performance.now();
function frame(now){
  if (lenis) lenis.raf(now);
  /* Smoothing was a fixed fraction PER FRAME, so it ran at different speeds on
     60 Hz vs 120 Hz and hitched whenever a frame was dropped. Now it is solved
     against elapsed time, so the glide is identical on any display. */
  const dt = Math.min(0.05, ((now || performance.now()) - lastT) / 1000);
  lastT = now || performance.now();
  const ease = r => 1 - Math.exp(-r * dt);

  let sheetTarget = 0;
  if (forced === null && !reduced) {
    /* Preserve the original film mapping through CONTACT_START, then stretch
       only its last sliver into a mobile handoff runway. The sheet tail starts
       after that runway, keeping both directions deterministic and symmetric. */
    const filmMax = Math.max(
      1, track.offsetHeight - innerHeight - sheetTail - contactRunwayExtra
    );
    if (contactRunway) {
      const contactStartY = filmMax * CONTACT_START;
      const contactEndY = contactStartY + contactRunway;
      if (scrollY <= contactStartY) {
        target = Math.min(1, Math.max(0, scrollY / filmMax));
      } else {
        const handoffK = Math.min(1, Math.max(0,
          (scrollY - contactStartY) / contactRunway
        ));
        target = CONTACT_START + CONTACT_RANGE * handoffK;
      }
      sheetTarget = Math.min(sheetTail, Math.max(0, scrollY - contactEndY));
    } else {
      target = Math.min(1, Math.max(0, scrollY / filmMax));
      sheetTarget = Math.min(sheetTail, Math.max(0, scrollY - filmMax));
    }
  }
  p += (target - p) * ease(5.0);   // heavier glide: scroll flicks land as one motion, not a lurch
  sheetY += (sheetTarget - sheetY) * ease(5.0);   // the sheet rides the same glide
  if (sheetTail) {
    const sy = Math.round(sheetY);
    if (sy !== lastSheetY) { lastSheetY = sy; closecap.scrollTop = sy; }
  }
  const me = ease(2.1);
  smx += (mx-smx)*me; smy += (my-smy)*me;
  /* drag offset: tight under the pointer, damped settle after release;
     the gain rises with the dock and is gone before the photo resolves */
  dragGain = smooth(clamp01((p - 0.452) / 0.03)) *
             (1 - smooth(clamp01((p - 0.600) / 0.060)));
  const de = ease(dragging ? 14 : 3.2);
  sDragAz += (dragAzT - sDragAz) * de; sDragAlt += (dragAltT - sDragAlt) * de;
  /* idle sway: the gate stirs with the hint hand until the first real drag,
     then eases out for good (the model-viewer "wiggle" recipe) */
  swayK += ((dragTravel <= 6 ? 1 : 0) - swayK) * ease(6.0);
  const sway = swayK > 0.003 ? 2.5 * Math.cos((now || performance.now()) * 6.2832 / 2400) * swayK : 0;
  swayCur = sway * dragGain;
  const wantGrab = dragGain > 0.5;
  if (wantGrab !== grabCur) { grabCur = wantGrab; if (!dragging) stage.style.cursor = wantGrab ? 'grab' : ''; }

  const pf = Math.min(1, p / FILM_FRAC);              // the film's clock
  const ps = clamp01((p - FILM_FRAC) / (1 - FILM_FRAC)); // the showcase's clock
  /* Start the night download shortly before the installed photograph enters.
     It gets a long scroll runway, but no longer competes with the initial GLB. */
  if (!nightAssetRequested && p >= SHOW.photoIn[0] - 0.04) requestNightAsset();
  const photoK = smooth(clamp01((p - SHOW.photoIn[0]) / (SHOW.photoIn[1] - SHOW.photoIn[0])));
  const envK   = 1 - smooth(clamp01((p - 0.650) / 0.070));
  const kBt = clamp01((p - SHOW.nightX[0]) / (SHOW.nightX[1] - SHOW.nightX[0]));
  const kB = smooth(kBt);
  const dip = Math.sin(Math.PI * kBt) * 0.55;
  /* 06 — Contact. The active frost-blob grows linearly from the bottom centre,
     matching Noa's scroll geometry while sampling the live night scene through
     milk glass. The dormant gate-close branch retains its original eased leaf
     travel and hard sealed-pane swap for one-line rollback. In both modes the
     sheet starts at CONTACT_START, after the transition surface covers the
     viewport; the mobile runway expands only the content portion that follows. */
  const closeK  = reduced ? 0 : USING_FROST_BLOB
    ? clamp01((p - 0.948) / (CONTACT_START - 0.948))
    : smooth(clamp01((p - 0.948) / 0.037));
  const stileK  = reduced ? 0 : smooth(clamp01((p - 0.9855) / 0.0035));
  const swapped = !reduced && p > CONTACT_START;
  closeKCur = closeK;
  const zoom = 1.02 + 0.08 * ps;
  let [az, alt, dist, tx0, ty, fit, gAura, gMid, gFar, gFeather, gInside] = score(pf);
  const open = leafOpenAt(pf);
  const W = stage.clientWidth, H = stage.clientHeight;
  const blobRadiusMax = Math.hypot(W * 0.5, H) * 1.04;
  const blobRadius = blobRadiusMax * closeK;
  const mastheadSurfaceP = frostTextSurfaceProgress(blobRadius, blobRadiusMax);
  const blobNavK = Math.hypot(W * 0.5, Math.max(0, H - 70)) / blobRadiusMax;
  const portrait = W < H;
  let d = dist, tx = tx0;

  if (portrait) {
    /* A 4.1 m leaf shown square-on simply cannot be large in a narrow frame —
       the horizontal field of view is a fraction of the desktop's. So on portrait
       we swing toward an end-on angle: perspective foreshortens the length, the
       leaf fits, and it reads far bigger. Distance is then SOLVED to fit rather
       than guessed, so it frames correctly at any phone size. */
    /* the composer is the exception: panels are composed FACE-ON, and the
       fixed-32% placement solved the camera under the floor at composer
       distance. The beat blends to a frontal, eye-level framing inside the
       scored move that arrives at it. */
    const fK = smooth(clamp01((pf - 0.64) / 0.06));
    /* the guard close-up's weight. NOT the scored 'fit' column: the portrait
       dolly-in is far bigger than the desktop move sharing the same gap, so it
       gets a wider window - it starts as a creep inside the hero's hold and
       settles just after arriving; the exit rides the full b2->b3 gap. */
    const cropK = smooth(clamp01((pf - 0.058) / 0.077))
                * (1 - smooth(clamp01((pf - 0.209) / 0.117)));
    const fitK = 1 - cropK;
    az += 34 * Math.tanh(az / 10) * (1 - fK) * (1 - 0.65 * cropK);  // CONTINUOUS through az=0; the close-up swings less
    az = Math.max(-62, Math.min(62, az));       // three-quarter view at most - the face must stay readable
    const hFov = 2 * Math.atan(Math.tan(camera.fov * Math.PI / 360) * camera.aspect);
    const sinA = Math.abs(Math.sin(az * Math.PI / 180));
    const seen = 4.1 * Math.abs(Math.cos(az * Math.PI / 180))
               + 0.25 + 0.65 * sinA;            // apparent length + angle-dependent depth
    const fitD = (seen * (1.0 - 0.26 * sinA + 0.10 * open)) / (2 * Math.tan(hFov / 2));
    /* squarer portraits (tablets) width-fit so close the gate tops out of the
       frame - floor the distance so the gate never exceeds ~64% of the height */
    const tanV = Math.tan(camera.fov * Math.PI / 360);
    const dMin = 4.3 / (2 * tanV);
    /* a fit=0 pose is a CLOSE-UP on portrait: panel detail bleeding both
       edges. fit interpolates through the score, so the dolly between a crop
       beat and its fit neighbours stays one continuous move. */
    const dCrop = dist * 1.75;
    d = dCrop + (Math.max(fitD, dMin) - dCrop) * fitK;
    tx = -3.7 * open;               // track the leaf CONTINUOUSLY through its slide
    /* at a three-quarter angle the NEAR end projects far wider than the far
       end, so centring the look point on the gate's middle crops the near end
       off one edge and leaves the other quarter empty. Bias the look point
       toward the near end to balance the span across the width. */
    tx += 0.52 * Math.sin(az * Math.PI / 180);
    // put the leaf at a FIXED screen position so the copy below it always
    // clears, whatever the phone size
    const visH = 2 * d * tanV;
    // short screens give the copy a bigger share, so lift the product further
    const lift = H < 720 ? 0.15 : 0.10;
    const tyFit = 0.65 - lift * visH;
    // crop framing sits high enough that the top rail clears the header hairline
    const tyCrop = ty - 0.45;
    ty = tyCrop + ((tyFit + (0.82 - tyFit) * fK) - tyCrop) * fitK;
  }
  /* the showcase camera: blend from the finale pose to the SOLVED pose that
     registers the leaf into the current photograph's opening. The solve rides
     the zoom and the shot crossfades, so the gate stays locked to the piers,
     reframing gently as one project dissolves into the next. */
  let pK = 1;
  if (ps > 0 && leaf) {
    const wS = smooth(Math.min(1, ps / 0.27));   // slower reframe: mostly settled before the photo resolves
    const pose = shotPose(CAL, zoom * OVERSCAN);
    d  += (pose.d  - d)  * wS;
    tx += (pose.tx - tx) * wS;
    ty += (pose.ty - ty) * wS;
    alt += (90 - alt) * wS;            // level out: match the photograph's one-point perspective
    if (portrait) az *= (1 - wS);      // no end-on swing over a frontal photograph
    pK = 1 - 0.85 * wS;                // the photo is flat: parallax would slide the gate off it
  }
  const azr = (az + (smx*3.0 + (sDragAz + sway)*dragGain)*pK) * Math.PI/180;
  let altr = (alt + (smy*2.2 + sDragAlt*dragGain)*pK) * Math.PI/180;
  /* floor guard on the APPLIED angle, not the drag target: the same angular
     dip is metres of drop at portrait's long fit distance, so clamp the
     camera's height (>= 0.32 m) instead of the degrees */
  const altrMax = Math.acos(Math.max(-1, Math.min(1, (0.32 - ty) / d)));
  if (altr > altrMax) altr = altrMax;
  camera.position.set(tx + d*Math.sin(altr)*Math.sin(azr), ty + d*Math.cos(altr), d*Math.sin(altr)*Math.cos(azr));
  camera.lookAt(tx, ty, 0);

  _gv.copy(glowAnchor).sub(camera.position).normalize();
  glow.position.copy(glowAnchor).addScaledVector(_gv, 9);
  glow.lookAt(camera.position);
  glow.updateMatrixWorld();

  if (leaf) {
    leaf.position.x = leafBaseX - 3.7 * open;
    contact.position.x = leaf.position.x + 2.05;
    if (mirrorLeaf) { mirrorLeaf.position.x = leaf.position.x; mirrorLeaf.position.y = leaf.position.y; }
    // near edge-on in the close crop this reads as a light leak — fade it in with distance
    const grounded = Math.min(1, Math.max(0, (d - 3.7) / 1.7));
    contact.material.opacity = grounded;
    contact.visible = grounded > 0.01;
  }
  for (const b of beatState) {
    const vis = (p>b.f0 && p<b.f1) ? Math.min((p-b.f0)/b.fw,(b.f1-p)/b.fw,1) : 0;
    if (Math.abs(vis - b.lastVis) > 0.002) {
      b.el.style.opacity = vis;
      b.el.style.transform = `translate(${b.tx}, calc(${b.ty} + ${(1-vis)*18}px))`;
      b.lastVis = vis;
    }
    const live = vis > .6;
    if (live !== b.live) { b.el.classList.toggle('live', live); b.live = live; }
  }
  /* The sticky track IS the hero, so smoke holds the whole way through to the
     closing beat rather than clearing once the camera pulls back. It eases off
     only slightly mid-story so the leaf stays readable when fully in frame. */
  /* the atmosphere stirs briefly over the film->showcase seam: the scene
     change arrives in the film's own language, without hiding the gate */
  const seam = reduced ? 0 : Math.sin(Math.PI * clamp01((p - 0.652) / 0.078)) * 0.30;
  /* portrait's photo is a BAND: dead black letterboxes above and below read
     as a layout gap, so the studio fog stays alive there through the showcase
     (masked off the photograph itself below). Landscape keeps the clear. */
  const bandFog = (portrait && !reduced) ? 0.50 * photoK : 0;
  const smokeTarget = Math.min(1,
    (reduced ? 0 : (1 - 0.22 * Math.sin(Math.PI * Math.min(1, Math.max(0, (pf - 0.10) / 0.85))))) * envK
    + seam + bandFog) * (1 - closeK);   /* the sealed pane hides the studio */
  smokeAlpha += (smokeTarget - smokeAlpha) * ease(3.0);
  smokeTime += dt;
  grade.uniforms.uTime.value = smokeTime;
  const live = smokeAlpha > 0.004;
  for (const L of smokeLayers) L.visible = live;
  if (live) {
    const hv = _mv.set(tx, FLOOR_Y, 0).project(camera).y * 0.5 + 0.5;
    const horizon = Math.min(0.85, Math.max(-0.35, hv));
    const gp = _mv.copy(glow.position).project(camera);
    const gu = gp.x * 0.5 + 0.5, gv = gp.y * 0.5 + 0.5;
    _ax.setFromMatrixColumn(glow.matrixWorld, 0);
    const grx = Math.min(1.5, Math.abs(_mv.copy(glow.position).addScaledVector(_ax, 22).project(camera).x * 0.5 + 0.5 - gu));
    _ax.setFromMatrixColumn(glow.matrixWorld, 1);
    const gry = Math.min(1.0, Math.abs(_mv.copy(glow.position).addScaledVector(_ax, 4).project(camera).y * 0.5 + 0.5 - gv));
    for (const L of smokeLayers) {
      const u = L.material.uniforms;
      u.uHorizon.value = horizon;
      u.uGlowPos.value.set(gu, gv);
      u.uGlowRad.value.set(grx, gry);
    }
    smokeFar.material.uniforms.uTime.value = smokeTime;
    smokeMid.material.uniforms.uTime.value = smokeTime * 1.18 + 40.0;
    smokeFar.material.uniforms.uAlpha.value = smokeAlpha * gFar;
    smokeMid.material.uniforms.uAlpha.value = smokeAlpha * gMid;
    /* the top letterbox sits high above the projected floor line, where the
       altitude stratification thins the fog to near-black. On portrait the
       showcase raises that ceiling so the upper haze reads against the band;
       the film (photoK 0) and landscape keep the studio's stratification. */
    const liftUp = portrait ? photoK : 0;
    smokeFar.material.uniforms.uLift.value = 0.45 + 0.50 * liftUp;
    smokeMid.material.uniforms.uLift.value = 0.32 + 0.48 * liftUp;
    { /* the same rect mask the aura uses for the leaf, aimed at the photo
         band: full fog in the letterboxes, wisps lapping the band's edges,
         near-none over the photograph. uInside 1 makes it an identity, so
         the film (photoK 0) and landscape (mask off) render as before. */
      const g2 = bdGeom();
      const bLo = 0.5 + (0.5 - (g2.by + g2.bh) / H) / 1.04;   // vUv spans 1.04x the view
      const bHi = 0.5 + (0.5 - g2.by / H) / 1.04;
      for (const L of [smokeFar, smokeMid]) {
        const u = L.material.uniforms;
        u.uMaskOn.value = portrait ? 1 : 0;
        u.uFeather.value = 0.10;
        u.uInside.value = 1 - 0.96 * photoK;
        u.uTopBoost.value = portrait ? photoK : 0;
        u.uMaskMin.value.set(-0.25, bLo);
        u.uMaskMax.value.set(1.25, bHi);
      }
    }
    // keep the mid bank 3.5 m beyond wherever the product currently is
    const midD = d + 3.5;
    if (Math.abs(midD - smokeMid.userData.dist) > 0.05) {
      smokeMid.userData.dist = midD;
      smokeMid.position.z = -midD;
      const vh = 2 * Math.tan(camera.fov * Math.PI / 360) * midD;
      smokeMid.scale.set(vh * camera.aspect * 1.04, vh * 1.04, 1);
    }
    smokeAura.material.uniforms.uTime.value = smokeTime * 1.5 + 140.0;
    smokeAura.material.uniforms.uAlpha.value = smokeAlpha * gAura * (portrait ? envK : 1);
    smokeAura.material.uniforms.uFeather.value = gFeather;
    smokeAura.material.uniforms.uInside.value = gInside;
    if (leaf) {
      const [ax, ay, bx, by] = leafMaskUv();
      smokeAura.material.uniforms.uMaskMin.value.set(ax, ay);
      smokeAura.material.uniforms.uMaskMax.value.set(bx, by);
    }
    caustic.material.uniforms.uTime.value = smokeTime;
    caustic.material.uniforms.uAlpha.value = smokeAlpha * 0.28 * (portrait ? envK : 1);
    caustic.visible = true;
  }
  if (!live) caustic.visible = false;

  if (Math.abs(envK - envKCur) > 0.002) {
    envKCur = envK;
    const pu = pool.material.uniforms.uP.value, gu2 = glow.material.uniforms.uP.value;
    /* the showroom lighting survives at 35% behind the photographs: the glass
       keeps its sheen and the staged gate separates from the backdrop */
    const ek = 0.35 + 0.65 * envK;
    pu.x = POOL_A0 * ek; pu.z = POOL_A1 * ek;
    gu2.x = GLOW_A0 * ek; gu2.z = GLOW_A1 * ek;
  }
  if (Math.abs(kB - nightKCur) > 0.002) { nightKCur = kB; setNightGlow(kB); }

  /* the backdrop: the stack fades in once, then B and C dissolve over A.
     One shared slow push-in keeps the photographs alive and lets the gate's
     own dolly parallax read against them. */
  const bdKey = photoK * 7 + kB * 13 + dip * 5;
  if (Math.abs(bdKey - lastBd) > 0.003) {
    lastBd = bdKey;
    bdrop.style.opacity = photoK;
    bdB.style.opacity = kB;                        // night falls over the same scene
    ndip.style.opacity = dip;
  }
  /* the Ken Burns transform tracks the camera solve EVERY frame — stepping it
     through a change-key made the photo judder against the smooth gate */
  if (photoK > 0.003) {
    const tr = `translate3d(0,0,0) scale(${(zoom * OVERSCAN).toFixed(5)})`;
    if (tr !== lastTr) { lastTr = tr; for (const el of [bdA, bdB]) el.style.transform = tr; }
  }

  {  // the prepass quad reproduces the DOM band: gl_FragCoord runs bottom-up
    const g = bdGeom(), zc = zoom * OVERSCAN;
    const sc = Math.max(g.bw / 1536, g.bh / 1024);
    bgQuadU.uK.value.set(W / (1536 * sc * zc), H / (1024 * sc * zc));
    bgQuadU.uC.value.set(0.5, g.bh < H ? 1 - (g.by + g.bh / 2) / H : 0.5);
    bgQuadU.uFeather.value = g.bh < H ? 32 / g.bh : 0;
  }
  bgQuadU.uKB.value = kB; bgQuadU.uDip.value = dip; bgQuadU.uPhotoK.value = photoK;
  const dockK = smooth(clamp01((p - 0.452) / 0.03)) * (1 - smooth(clamp01((p - 0.935) / 0.045)));
  if (Math.abs(dockK - lastDock) > 0.004) {
    lastDock = dockK;
    dock.style.opacity = dockK;
    dock.style.pointerEvents = dockK > 0.5 ? 'auto' : 'none';
  }
  const hintK = dragTravel > 6 ? 0 : dragGain;
  if (Math.abs(hintK - lastHint) > 0.004) { lastHint = hintK; draghint.style.opacity = hintK; }
  if (hintK > 0.004) dhHand.style.transform =
    `translateX(${(-dhAmp * Math.cos((now || performance.now()) * 6.2832 / 2400)).toFixed(2)}px)`;
  if (cueVis !== (pf < 0.05)) { cueVis = pf < 0.05; cue.style.opacity = cueVis ? 1 : 0; }
  const heroUI = pf < 0.14 ? Math.min(1, (0.14 - pf) / 0.04) : 0;
  if (Math.abs(heroUI - lastHeroUI) > 0.002) {
    standfirst.style.opacity = heroUI; pcard.style.opacity = heroUI;
    lastHeroUI = heroUI;
  }
  const stuck = scrollY > 40;
  if (stuck !== lastStuck) { nav.classList.toggle('stuck', stuck); lastStuck = stuck; }
  const closeKey = USING_FROST_BLOB
    ? closeK * 10 + (swapped ? 1 : 0)
    : closeK * 7 + stileK * 3 + (swapped ? 1 : 0);   // the guard must see ALL the clocks
  if (Math.abs(closeKey - lastClose) > 0.002) {
    lastClose = closeKey;
    gateclose.style.visibility = closeK > 0.001 ? 'visible' : 'hidden';
    /* Blob mode exposes the container once its masthead is safely over frost;
       every other child is still at opacity 0 until the full-cover clock. */
    closecap.style.opacity = swapped || mastheadSurfaceP > 0 ? 1 : 0;
    if (USING_FROST_BLOB) {
      frostBlob.style.opacity = closeK > 0.0005 ? 1 : 0;
      gateclose.style.setProperty('--blob-r', blobRadius.toFixed(2) + 'px');
      leafL.style.visibility = leafR.style.visibility = 'hidden';
      sealpane.style.opacity = 0;
      stage.style.setProperty('--fz', '1');
      stage.classList.remove('closing', 'frosted');
    } else {
      frostBlob.style.opacity = 0;
      const lt = (102 * (1 - closeK)).toFixed(3);
      leafL.style.transform = `translateX(-${lt}%)`;
      leafR.style.transform = `translateX(${lt}%)`;
      /* the pane firms up a little as it closes — enough ground for dark type,
         still translucent: the estate's uplights keep ghosting through */
      const lo = 0.55 + 0.17 * smooth(clamp01((closeK - 0.72) / 0.28));
      leafL.style.setProperty('--lo', lo.toFixed(3));
      leafR.style.setProperty('--lo', lo.toFixed(3));
      gateclose.style.setProperty('--stile', (1 - stileK).toFixed(3));
      sealpane.style.opacity = swapped ? 1 : 0;
      /* the push reaches its full 1.05 by the time the leaves meet, so the hard
         frame swap changes nothing but the blur's source */
      stage.style.setProperty('--fz', (1 + 0.05 * closeK).toFixed(4));
      stage.classList.toggle('closing', closeK > 0.0005);
      stage.classList.toggle('frosted', swapped);
      leafL.style.visibility = leafR.style.visibility = swapped ? 'hidden' : '';
    }
    sheetglow.style.opacity = swapped ? 0.6 : 0;
  }
  const arrOn = swapped;
  if (arrOn !== lastArr) {
    lastArr = arrOn;
    countT0 = 0;
    countsPlayed = false;
    if (arrOn) measureSheetTail();
    else { for (const el of countEls) el.textContent = '0';
           blueprint.classList.remove('bpin'); }   /* the tail owns scrollTop */
  }
  const detailsReveal = updateContactReveals(p, arrOn, mastheadSurfaceP);
  bpTry();
  /* The counters remain a small time-based flourish, but their clock now starts
     only when the details block has actually entered the viewport. */
  if (arrOn && !countsPlayed && detailsReveal > 0.55) {
    countsPlayed = true;
    countT0 = performance.now();
  }
  if (countT0) {
    const t = Math.min(1, (performance.now() - countT0) / 1300);
    const e = 1 - Math.pow(1 - t, 3);   // ease-out cubic: fast spin, soft landing
    for (const el of countEls)
      el.textContent = Math.round(+el.dataset.count * e).toLocaleString('en-US');
    if (t >= 1) countT0 = 0;
  }
  const sealedNow = swapped;
  if (sealedNow !== sealedCur) { sealedCur = sealedNow; gateclose.classList.toggle('sealed', sealedNow); }
  /* the light surfaces (sealing pane, contact band) need the inverted nav;
     the track-bottom test also covers reduced motion, where closeK stays 0 */
  const trackBottom = track.getBoundingClientRect().bottom;
  const navLight = (USING_FROST_BLOB ? closeK > blobNavK : closeK > 0.55) || trackBottom < 70;
  if (navLight !== lastNavLight) {
    nav.classList.toggle('light', navLight);
    lastNavLight = navLight;
  }
  const stOn = p > 0.02;
  if (stOn !== lastStOn) { lastStOn = stOn; stl.classList.toggle('on', stOn); }
  const stKey = Math.round(p * 600) * 2 + (document.documentElement.lang === 'es' ? 1 : 0);
  if (stKey !== lastStKey) {
    lastStKey = stKey;
    /* the label sits at the FILL FRONT (where white meets gray) — overall
       p% would drift, since segment heights are weighted, not proportional */
    let active = 0, front = 0;
    for (let i = 0; i < ST_SECT.length; i++) {
      const f = clamp01((p - ST_SECT[i][0]) / (ST_SECT[i][1] - ST_SECT[i][0]));
      stFills[i].style.height = (f * 100).toFixed(1) + '%';
      if (p >= ST_SECT[i][0]) { active = i; front = stSegs[i].offsetTop + f * stSegs[i].offsetHeight; }
    }
    stLabel.textContent = (document.documentElement.lang === 'es' ? ST_ES : ST_EN)[active];
    stLabel.style.top = (front - 5).toFixed(1) + 'px';
  }

  // Interactive motion renders at display cadence. Desktop atmosphere remains
  // continuous; idle mobile atmosphere is deliberately capped at 24 fps so the
  // smoke stays alive without returning to a permanent full-rate GPU workload.
  const onScreen = trackBottom > 0;
  const moving = dragging || Math.abs(swayCur) > 0.01 || Math.abs(target - p) > 1e-4 ||
                 Math.abs(mx - smx) > 1e-3 || Math.abs(my - smy) > 1e-3 ||
                 Math.abs(dragAzT - sDragAz) > 0.02 || Math.abs(dragAltT - sDragAlt) > 0.02 ||
                 (smokeAlpha > 0.004 && onScreen && !MOBILE_RENDER_BUDGET);
  if (moving) renderFor = 45;
  const renderNow = now || performance.now();
  const mobileAtmosphereDue = MOBILE_RENDER_BUDGET && live && onScreen &&
    renderNow - mobileIdleAtmosphereAt >= MOBILE_IDLE_ATMOSPHERE_MS;
  if (mobileAtmosphereDue) {
    mobileIdleAtmosphereAt = renderNow;
    renderFor = Math.max(renderFor, 1);
  }
  if (renderFor > 0) {
    if (gate && GLASSES[glassIdx][2].blur) renderBg();
    composer.render(); renderFor--;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
} catch (error) {
  console.error('Interactive 3D initialization failed.', error);
  window.__showGateFallback?.();
}

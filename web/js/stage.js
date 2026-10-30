/**
 * EchoStage · 3D 舞台
 * 灰色摄影棚、顶光/地面灯、体积光束、尘埃、音符粒子、电影感后期。
 */

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { createBand } from './instruments.js';
import { createDirector } from './director.js';

const ACCENT = new THREE.Color('#ff4f8b');
const RING_HOT = new THREE.Color('#ffd166');
const SOFTWARE_RE = /swiftshader|llvmpipe|software|basic render|mesa offscreen/i;

const QUALITY_PRESETS = {
  high: { pixelBudget: 3_600_000, dprCap: 1.35, bloom: true, shadowEvery: 2, shadowSize: 1024, grain: 0.015 },
  medium: { pixelBudget: 2_200_000, dprCap: 1.15, bloom: true, shadowEvery: 3, shadowSize: 512, grain: 0.008 },
  low: { pixelBudget: 1_400_000, dprCap: 0.9, bloom: false, shadowEvery: 0, shadowSize: 256, grain: 0.004 },
};

function targetPixelRatio(quality, width, height) {
  const preset = QUALITY_PRESETS[quality] || QUALITY_PRESETS.high;
  const budgetDpr = Math.sqrt(preset.pixelBudget / Math.max(1, width * height));
  return Math.max(0.65, Math.min(window.devicePixelRatio || 1, preset.dprCap, budgetDpr));
}

const FilmShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uRes: { value: new THREE.Vector2(1, 1) },
    uGrain: { value: 0.015 },
    uAberration: { value: 0.0012 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uTime; uniform vec2 uRes;
    uniform float uGrain; uniform float uAberration; varying vec2 vUv;
    void main(){
      vec2 d = vUv - 0.5;
      float r2 = dot(d, d);
      vec2 off = d * uAberration * (0.35 + r2 * 3.0);
      float cr = texture2D(tDiffuse, vUv + off).r;
      float cg = texture2D(tDiffuse, vUv).g;
      float cb = texture2D(tDiffuse, vUv - off).b;
      vec3 color = vec3(cr, cg, cb);
      float vig = smoothstep(0.92, 0.18, length(d));
      color *= mix(0.5, 1.0, vig);
      float n = fract(sin(dot(vUv * uRes + uTime * 17.0, vec2(12.9898, 78.233))) * 43758.5453);
      color += (n - 0.5) * uGrain;
      color *= 0.985 + 0.015 * sin(vUv.y * uRes.y * 1.6 + uTime * 2.0);
      gl_FragColor = vec4(color, 1.0);
    }
  `,
};

function gradientTexture(stops, w = 256, h = 256, radial = true) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (radial) {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    for (const [p, c] of stops) g.addColorStop(p, c);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  } else {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    for (const [p, c] of stops) g.addColorStop(p, c);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function buildRoom(scene) {
  const room = new THREE.Group();
  scene.add(room);

  // 无缝背景墙
  const wallGeo = new THREE.CylinderGeometry(26, 26, 26, 96, 1, true, 0, Math.PI * 2);
  const pos = wallGeo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const bottom = new THREE.Color(0x50525a);
  const top = new THREE.Color(0x17181c);
  for (let i = 0; i < pos.count; i++) {
    const t = THREE.MathUtils.clamp((pos.getY(i) + 13) / 26, 0, 1);
    const c = bottom.clone().lerp(top, Math.pow(t, 0.9));
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  wallGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const wall = new THREE.Mesh(wallGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: true }));
  wall.position.y = 12;
  room.add(wall);

  // 背景柔光，像摄影棚里被灯光洗过的一面墙
  const wallGlowTex = gradientTexture([
    [0, 'rgba(255,240,220,0.42)'],
    [0.45, 'rgba(230,180,160,0.12)'],
    [1, 'rgba(0,0,0,0)'],
  ], 512, 512, false);
  const wallGlow = new THREE.Mesh(
    new THREE.PlaneGeometry(30, 12),
    new THREE.MeshBasicMaterial({ map: wallGlowTex, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  wallGlow.position.set(0, 4.4, -19.5);
  room.add(wallGlow);

  // 舞台后方的“回声环”，填补背景并随音乐呼吸
  const halo = new THREE.Group();
  halo.position.set(0, 3.4, -10.5);
  const haloMats = [];
  for (const [r, opacity] of [[1.6, 0.22], [2.7, 0.14], [3.8, 0.09], [5.0, 0.05]]) {
    const mat = new THREE.MeshBasicMaterial({ color: 0xff8aa9, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.012, 6, 96), mat);
    halo.add(ring);
    haloMats.push(mat);
  }
  const haloDiscTex = gradientTexture([
    [0, 'rgba(255,150,180,0.22)'],
    [0.55, 'rgba(255,100,150,0.06)'],
    [1, 'rgba(0,0,0,0)'],
  ], 512, 512, true);
  const haloDisc = new THREE.Mesh(
    new THREE.CircleGeometry(5.4, 64),
    new THREE.MeshBasicMaterial({ map: haloDiscTex, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  haloDisc.position.z = -0.05;
  halo.add(haloDisc);
  room.add(halo);

  // 地面
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(30, 80),
    new THREE.MeshStandardMaterial({ color: 0x141518, roughness: 0.86, metalness: 0.12 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.045;
  floor.receiveShadow = true;
  room.add(floor);

  // 圆形舞台
  const stageSide = new THREE.MeshStandardMaterial({ color: 0x16171a, roughness: 0.6, metalness: 0.35 });
  const stageTop = new THREE.MeshStandardMaterial({ color: 0x2a2b2f, roughness: 0.62, metalness: 0.22 });
  const platform = new THREE.Mesh(new THREE.CylinderGeometry(8.05, 8.35, 0.24, 90), [stageSide, stageTop, stageSide]);
  platform.position.y = -0.12;
  platform.receiveShadow = true;
  room.add(platform);

  // 舞台边缘的 LED 环
  const ringMat = new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(7.95, 0.022, 8, 160), ringMat);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.008;
  room.add(ring);
  const innerRingMat = new THREE.MeshBasicMaterial({ color: 0xf0e7d6, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending });
  const innerRing = new THREE.Mesh(new THREE.TorusGeometry(7.2, 0.01, 6, 120), innerRingMat);
  innerRing.rotation.x = Math.PI / 2;
  innerRing.position.y = 0.006;
  room.add(innerRing);

  // 地面灯池
  const poolTex = gradientTexture([[0, 'rgba(255,240,220,0.55)'], [0.5, 'rgba(255,210,180,0.16)'], [1, 'rgba(0,0,0,0)']]);
  const pools = [];
  for (const [x, z, r, color] of [[-5, -2, 4.2, 0xffb08a], [5, -2, 4.2, 0xff7aa5], [0, -5.5, 3.5, 0x8fa6ff]]) {
    const mesh = new THREE.Mesh(
      new THREE.CircleGeometry(r, 40),
      new THREE.MeshBasicMaterial({ map: poolTex, color, transparent: true, opacity: 0.24, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, 0.012, z);
    room.add(mesh);
    pools.push(mesh);
  }

  // 背景一条极细的灯带
  const stripMat = new THREE.MeshBasicMaterial({ color: 0xff4f8b, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending });
  const strip = new THREE.Mesh(new THREE.BoxGeometry(26, 0.012, 0.012), stripMat);
  strip.position.set(0, 0.02, -13);
  room.add(strip);

  return { room, ring, ringMat, innerRingMat, pools, stripMat, halo, haloDisc, haloMats };
}

class SparkSystem {
  constructor(scene, count = 420) {
    this.count = count;
    this.cursor = 0;
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(count * 3);
    this.color = new Float32Array(count * 3);
    this.size = new Float32Array(count);
    this.alpha = new Float32Array(count);
    this.vel = new Float32Array(count * 3);
    this.life = new Float32Array(count);
    this.maxLife = new Float32Array(count);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.color, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
    this.geo = geo;
    const mat = new THREE.ShaderMaterial({
      uniforms: { uPixelRatio: { value: Math.min(2, window.devicePixelRatio || 1) } },
      vertexShader: `
        attribute vec3 aColor; attribute float aSize; attribute float aAlpha;
        varying vec3 vColor; varying float vAlpha; uniform float uPixelRatio;
        void main(){
          vColor = aColor; vAlpha = aAlpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * uPixelRatio * (240.0 / max(0.2, -mv.z));
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        varying vec3 vColor; varying float vAlpha;
        void main(){
          vec2 p = gl_PointCoord - 0.5;
          float d = length(p);
          if (d > 0.5) discard;
          float a = smoothstep(0.5, 0.05, d);
          gl_FragColor = vec4(vColor, vAlpha * a);
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }
  spawn(pos, color, strength = 0.6) {
    const n = 3 + Math.floor(strength * 6);
    const c = new THREE.Color(color);
    for (let k = 0; k < n; k++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.count;
      this.pos[i * 3] = pos.x + (Math.random() - 0.5) * 0.2;
      this.pos[i * 3 + 1] = pos.y + (Math.random() - 0.5) * 0.1;
      this.pos[i * 3 + 2] = pos.z + (Math.random() - 0.5) * 0.2;
      this.vel[i * 3] = (Math.random() - 0.5) * 0.9;
      this.vel[i * 3 + 1] = 0.5 + Math.random() * 1.4;
      this.vel[i * 3 + 2] = (Math.random() - 0.5) * 0.9;
      this.color[i * 3] = c.r; this.color[i * 3 + 1] = c.g; this.color[i * 3 + 2] = c.b;
      this.size[i] = 0.018 + Math.random() * 0.045;
      this.alpha[i] = 0.9;
      this.maxLife[i] = 0.7 + Math.random() * 1.1;
      this.life[i] = this.maxLife[i];
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aColor.needsUpdate = true;
    this.geo.attributes.aSize.needsUpdate = true;
    this.geo.attributes.aAlpha.needsUpdate = true;
  }
  update(dt) {
    let dirty = false;
    for (let i = 0; i < this.count; i++) {
      if (this.life[i] <= 0) continue;
      dirty = true;
      this.life[i] -= dt;
      const t = Math.max(0, this.life[i] / this.maxLife[i]);
      this.alpha[i] = t * t * 0.9;
      this.vel[i * 3 + 1] -= dt * 2.2;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      if (this.life[i] <= 0) this.alpha[i] = 0;
    }
    if (dirty) {
      this.geo.attributes.position.needsUpdate = true;
      this.geo.attributes.aAlpha.needsUpdate = true;
    }
  }
}

function buildDust(scene) {
  const count = 520;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const r = 3 + Math.random() * 15;
    const a = Math.random() * Math.PI * 2;
    pos[i * 3] = Math.cos(a) * r;
    pos[i * 3 + 1] = Math.random() * 8;
    pos[i * 3 + 2] = Math.sin(a) * r - 2;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({
    color: 0xd9cdbb, size: 0.022, transparent: true, opacity: 0.35,
    depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true,
  });
  const points = new THREE.Points(geo, mat);
  scene.add(points);
  return points;
}

export function createStage(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  const gl = renderer.getContext();
  const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
  const rendererName = debugInfo ? String(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) || '') : '';
  const forcedQuality = new URLSearchParams(location.search).get('quality');
  const softwareRenderer = SOFTWARE_RE.test(rendererName);
  const smallScreen = window.matchMedia?.('(max-width: 900px)').matches || false;
  const lowCore = (navigator.hardwareConcurrency || 8) <= 4;
  let quality = ['high', 'medium', 'low'].includes(forcedQuality)
    ? forcedQuality
    : softwareRenderer
      ? 'low'
      : smallScreen || lowCore
        ? 'medium'
        : 'high';
  let qualityChangedAt = performance.now();
  let perfAccum = 0;
  let perfFrames = 0;
  let downgradeLocked = Boolean(forcedQuality);
  let dprScale = 1;

  const initialW = canvas.clientWidth || 1280;
  const initialH = canvas.clientHeight || 800;
  renderer.setPixelRatio(targetPixelRatio(quality, initialW, initialH));
  renderer.setSize(initialW, initialH, false);
  renderer.shadowMap.enabled = quality === 'high';
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;
  renderer.shadowMap.type = quality === 'high' ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.86;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0c0e);
  scene.fog = new THREE.FogExp2(0x0b0c0e, 0.017);

  const camera = new THREE.PerspectiveCamera(34, (canvas.clientWidth || 1280) / (canvas.clientHeight || 800), 0.1, 90);
  camera.position.set(0, 4.2, 13.6);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new RoomEnvironment();
  scene.environment = pmrem.fromScene(envScene, 0.03).texture;
  scene.environmentIntensity = 0.45;
  envScene.dispose?.();
  pmrem.dispose();

  const room = buildRoom(scene);
  const band = createBand(scene);
  const dust = buildDust(scene);
  const sparks = new SparkSystem(scene);

  // 灯光
  scene.add(new THREE.HemisphereLight(0x6a7590, 0x0b0b0d, 0.38));
  const key = new THREE.SpotLight(0xfff2df, 130, 34, 0.62, 0.9, 2);
  key.position.set(0.5, 10, 8);
  key.target.position.set(0, 1.2, -0.5);
  key.castShadow = quality === 'high';
  key.shadow.mapSize.set(QUALITY_PRESETS[quality].shadowSize, QUALITY_PRESETS[quality].shadowSize);
  key.shadow.bias = -0.0004;
  key.shadow.camera.near = 2;
  key.shadow.camera.far = 30;
  scene.add(key, key.target);

  const rimL = new THREE.SpotLight(0xff5f8f, 65, 26, 0.7, 0.9, 2);
  rimL.position.set(-9, 5.5, 5);
  rimL.target.position.set(-2, 1.2, 0);
  scene.add(rimL, rimL.target);
  const rimR = new THREE.SpotLight(0x6f8fff, 60, 26, 0.7, 0.9, 2);
  rimR.position.set(9, 5.2, 4);
  rimR.target.position.set(2, 1.2, 0);
  scene.add(rimR, rimR.target);
  const back = new THREE.SpotLight(0xffb27a, 85, 30, 0.55, 0.95, 2);
  back.position.set(0, 6, -10);
  back.target.position.set(0, 1.2, 0);
  scene.add(back, back.target);

  const practicals = room.room && [];
  for (const l of band.extras.lights) {
    const world = l.group.position.clone().add(new THREE.Vector3(0, 2.55, 0.08));
    const spot = new THREE.SpotLight(l.color, 55, 24, 0.52, 0.9, 2);
    spot.position.copy(world);
    spot.target.position.copy(l.target);
    scene.add(spot, spot.target);
    practicals.push(spot);
  }

  // 后期
  const composer = new EffectComposer(renderer);
  composer.setPixelRatio(renderer.getPixelRatio());
  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);
  const bloom = new UnrealBloomPass(
    new THREE.Vector2(initialW * 0.5, initialH * 0.5),
    0.2, 0.4, 1.02,
  );
  bloom.enabled = QUALITY_PRESETS[quality].bloom;
  composer.addPass(bloom);
  const film = new ShaderPass(FilmShader);
  film.uniforms.uRes.value.set(initialW, initialH);
  film.uniforms.uGrain.value = QUALITY_PRESETS[quality].grain;
  composer.addPass(film);
  const output = new OutputPass();
  composer.addPass(output);

  const director = createDirector(camera, canvas, band.positions);
  let score = null;
  let lastTime = -1;
  let pausedEnergy = 0;
  let shadowTick = 0;
  let renderedFrames = 0;

  // 小部件不投影：减少阴影 pass 的 draw call，同时保留大件阴影
  const detailMeshes = [];
  band.root.traverse((obj) => {
    if (!obj.isMesh) return;
    if (obj.userData.detail) detailMeshes.push(obj);
    obj.geometry.computeBoundingSphere?.();
    const radius = obj.geometry.boundingSphere?.radius || 0;
    if (radius < 0.085) obj.castShadow = false;
  });
  function setDetailVisible(visible) {
    for (const mesh of detailMeshes) mesh.visible = visible;
  }

  function applyResize(force = false) {
    const w = canvas.clientWidth || 1280;
    const h = canvas.clientHeight || 800;
    const dpr = Math.max(0.6, targetPixelRatio(quality, w, h) * dprScale);
    const targetW = Math.floor(w * dpr);
    const targetH = Math.floor(h * dpr);
    if (!force && canvas.width === targetW && canvas.height === targetH) {
      return;
    }
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    composer.setPixelRatio(dpr);
    composer.setSize(w, h);
    // Bloom 内部用半分辨率，成本约降为 1/4；最终合成仍按全分辨率。
    bloom.setSize(Math.max(1, Math.floor(targetW * 0.5)), Math.max(1, Math.floor(targetH * 0.5)));
    film.uniforms.uRes.value.set(w, h);
  }

  function setQuality(next, reason = 'auto') {
    if (!QUALITY_PRESETS[next] || next === quality) return;
    quality = next;
    dprScale = 1;
    qualityChangedAt = performance.now();
    const preset = QUALITY_PRESETS[next];
    bloom.enabled = preset.bloom;
    renderer.shadowMap.enabled = next === 'high';
    key.castShadow = next === 'high';
    renderer.shadowMap.type = next === 'high' ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    key.shadow.mapSize.set(preset.shadowSize, preset.shadowSize);
    if (key.shadow.map) {
      key.shadow.map.dispose();
      key.shadow.map = null;
    }
    for (const light of practicals) light.visible = next !== 'low';
    rimL.visible = next !== 'low';
    rimR.visible = next !== 'low';
    back.visible = next !== 'low';
    for (const light of band.extras.lights) light.beam.visible = next !== 'low';
    dust.visible = next !== 'low';
    setDetailVisible(next !== 'low');
    film.uniforms.uGrain.value = preset.grain;
    document.body.classList.toggle('perf-low', next === 'low');
    document.body.classList.toggle('perf-medium', next === 'medium');
    shadowTick = 0;
    renderer.shadowMap.needsUpdate = true;
    applyResize(true);
    window.dispatchEvent(new CustomEvent('echostage:quality', { detail: { quality: next, reason } }));
  }

  function trackPerformance(dt) {
    if (downgradeLocked || performance.now() - qualityChangedAt < 3500) return;
    perfAccum += dt;
    perfFrames++;
    if (perfAccum < 2) return;
    const fps = perfFrames / perfAccum;
    perfAccum = 0;
    perfFrames = 0;
    if (quality === 'high' && fps < 46) {
      setQuality('medium', `fps=${fps.toFixed(0)}`);
    } else if (quality === 'medium' && fps < 38) {
      setQuality('low', `fps=${fps.toFixed(0)}`);
    } else if (quality === 'low' && fps < 24) {
      // 已经到最低档，进一步降低像素比；不再触发材质/灯光重建
      dprScale = Math.max(0.65, dprScale * 0.85);
      applyResize(true);
      downgradeLocked = true;
    }
  }

  function update(time, dt, levels = null) {
    applyResize();
    dt = Math.min(0.05, Math.max(0.001, dt));
    const advancing = time - lastTime > 0.002;
    if (advancing) trackPerformance(dt);
    const hits = band.update(time, dt, levels);
    if (quality !== 'low') {
      for (const h of hits) sparks.spawn(h.pos, h.color, h.strength);
    }
    sparks.update(dt);

    const activities = ['drums', 'bass', 'guitar', 'keys', 'lead'].map((id) => band.getActivity(id));
    const activity = Math.max(...activities, 0);
    pausedEnergy += (activity - pausedEnergy) * (1 - Math.exp(-dt * 5));

    // 灯光呼吸
    key.intensity = 85 + pausedEnergy * 80;
    rimL.intensity = 40 + (band.getActivity('guitar') || 0) * 70;
    rimR.intensity = 36 + (band.getActivity('keys') || 0) * 70;
    for (let i = 0; i < practicals.length; i++) {
      practicals[i].intensity = 28 + activity * 42 + Math.sin(time * 1.7 + i) * 4;
      const beam = band.extras.lights[i];
      if (beam) {
        const targetOpacity = 0.055 + activity * 0.07 + (i === 0 ? band.getActivity('bass') * 0.04 : 0);
        beam.beamMat.uniforms.uOpacity.value += (targetOpacity - beam.beamMat.uniforms.uOpacity.value) * (1 - Math.exp(-dt * 3));
      }
    }
    room.ringMat.color.copy(ACCENT).lerp(RING_HOT, Math.min(0.6, activity * 0.5));
    room.ring.scale.setScalar(1 + activity * 0.012);
    room.innerRingMat.opacity = 0.06 + activity * 0.14;
    for (let i = 0; i < room.pools.length; i++) {
      room.pools[i].material.opacity = 0.12 + activity * 0.16 + Math.sin(time * 0.7 + i) * 0.02;
    }
    room.stripMat.opacity = 0.18 + activity * 0.28;
    room.halo.rotation.z = time * 0.03;
    room.halo.scale.setScalar(1 + activity * 0.025);
    for (let i = 0; i < room.haloMats.length; i++) {
      room.haloMats[i].opacity = (0.1 + activity * 0.12) * (1 - i * 0.16);
    }
    room.haloDisc.material.opacity = 0.25 + activity * 0.16;

    dust.rotation.y = time * 0.006;
    dust.position.y = Math.sin(time * 0.1) * 0.1;

    const shot = director.update(score, time, dt, activity);
    film.uniforms.uTime.value = time;
    bloom.strength = 0.16 + pausedEnergy * 0.22;
    lastTime = time;
    return { shot, activity };
  }

  function render() {
    renderedFrames++;
    if (quality === 'low') {
      renderer.render(scene, camera);
    } else {
      if (quality === 'high') {
        renderer.shadowMap.needsUpdate = (shadowTick % 2 === 0);
        shadowTick++;
      } else {
        renderer.shadowMap.needsUpdate = false;
      }
      composer.render();
    }
  }

  function setScore(next) {
    score = next;
    band.setScore(next);
    band.seek(0);
    director.state.auto = true;
    director.state.shotName = 'wide';
    lastTime = -1;
  }

  function warmUp(time) {
    const from = Math.max(0, time - 1.8);
    band.seek(from);
    for (let t = from; t < time; t += 1 / 60) {
      band.update(t, 1 / 60, null);
    }
  }

  function resize() {
    applyResize(true);
  }

  applyResize(true);
  if (quality === 'low') {
    for (const light of practicals) light.visible = false;
    rimL.visible = false;
    rimR.visible = false;
    back.visible = false;
    for (const light of band.extras.lights) light.beam.visible = false;
    dust.visible = false;
    setDetailVisible(false);
  }
  document.body.classList.toggle('perf-low', quality === 'low');
  document.body.classList.toggle('perf-medium', quality === 'medium');

  return {
    canvas, scene, camera, renderer, composer, band, director, sparks,
    setScore, update, render, resize, warmUp, setQuality,
    rendererName,
    get quality() { return quality; },
    get frames() { return renderedFrames; },
    focus(id) { director.focus(id); },
    setAuto(on) { director.setAuto(on); },
    get shot() { return director.shot; },
    get score() { return score; },
  };
}

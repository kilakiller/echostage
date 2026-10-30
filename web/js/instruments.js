/**
 * EchoStage · 乐器组
 * 全部由几何体程序化建模，无外部模型文件。
 * 视觉语言：灰色摄影棚 + 塑料/金属玩具质感 + 粉橙蓝点缀。
 */

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const UP = new THREE.Vector3(0, 1, 0);
const TAU = Math.PI * 2;

const C = {
  charcoal: 0x1b1c1f,
  stage: 0x292a2e,
  cream: 0xf0e7d6,
  paper: 0xf6f0e5,
  chrome: 0xcfc9bd,
  brass: 0xd8b56b,
  pink: 0xff4f8b,
  orange: 0xff6b4a,
  blue: 0x4d7cff,
  mint: 0x79f2c0,
  gold: 0xffd166,
  wood: 0x6b4630,
  drumBlue: 0x1c2f8f,
  guitarOrange: 0xd9542b,
  guitarBlue: 0x2f8ed6,
  bassWine: 0x8f2f3f,
};

const std = (color, opts = {}) => new THREE.MeshStandardMaterial({
  color, roughness: 0.48, metalness: 0.08, ...opts,
});
const paint = (color, opts = {}) => new THREE.MeshPhysicalMaterial({
  color, roughness: 0.3, metalness: 0.45, clearcoat: 0.9, clearcoatRoughness: 0.12, ...opts,
});
const chrome = () => new THREE.MeshStandardMaterial({ color: C.chrome, roughness: 0.2, metalness: 1 });
const darkMetal = () => new THREE.MeshStandardMaterial({ color: 0x3b3d42, roughness: 0.4, metalness: 0.9 });
const brass = () => new THREE.MeshStandardMaterial({ color: 0xb98f47, roughness: 0.44, metalness: 0.78, envMapIntensity: 1.1 });

const hitEnv = (age, decay = 9) => (age < 0 ? 0 : Math.exp(-age * decay));

function shadow(mesh, cast = true, receive = false) {
  mesh.castShadow = cast;
  mesh.receiveShadow = receive;
  return mesh;
}

function rounded(w, h, d, r, material) {
  const mesh = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 4, r), material);
  return shadow(mesh);
}

function cyl(rTop, rBottom, h, material, seg = 24) {
  return shadow(new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBottom, h, seg), material));
}

function torus(r, tube, material, seg = 32) {
  return shadow(new THREE.Mesh(new THREE.TorusGeometry(r, tube, 10, seg), material));
}

function makeCanvasTexture(draw, w = 512, h = 256) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  draw(ctx, w, h);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function labelSprite(text, color = '#f4efe6') {
  const tex = makeCanvasTexture((ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(10,10,12,0.55)';
    ctx.beginPath();
    ctx.roundRect(10, 46, w - 20, 150, 20);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.font = '600 58px "Segoe UI", "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, w / 2, h / 2);
  }, 512, 256);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.85 });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(1.5, 0.75, 1);
  return sprite;
}

function contactShadow(radius = 1.2, opacity = 0.55) {
  const tex = makeCanvasTexture((ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, `rgba(0,0,0,${opacity})`);
    g.addColorStop(0.45, `rgba(0,0,0,${opacity * 0.5})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }, 256, 256);
  const mesh = new THREE.Mesh(
    new THREE.CircleGeometry(radius, 40),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.8 }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.015;
  mesh.renderOrder = 1;
  return mesh;
}

class Player {
  constructor(notes = []) {
    this.notes = [];
    this.setNotes(notes);
  }
  setNotes(notes) {
    this.notes = [...notes].sort((a, b) => a.t - b.t);
    this.i = 0;
    this.last = -Infinity;
  }
  reset(time = 0) {
    this.last = time - 0.35;
    this.i = 0;
    while (this.i < this.notes.length && this.notes[this.i].t < this.last) this.i++;
  }
  poll(time) {
    if (time < this.last - 0.25) this.reset(time);
    const hits = [];
    while (this.i < this.notes.length && this.notes[this.i].t <= time + 0.008) {
      const n = this.notes[this.i++];
      if (n.t >= this.last - 0.02) hits.push(n);
    }
    this.last = time;
    return hits;
  }
}

/* ------------------------------------------------------------------ */
/* 鼓组                                                                */
/* ------------------------------------------------------------------ */

function buildDrumKit() {
  const group = new THREE.Group();
  const parts = {
    kick: { pos: new THREE.Vector3(0, 0.62, -0.15), side: 0 },
    snare: { pos: new THREE.Vector3(0.78, 1.02, 0.48), side: 1 },
    tom1: { pos: new THREE.Vector3(-0.38, 1.18, 0.08), side: 0 },
    tom2: { pos: new THREE.Vector3(0.4, 1.14, -0.04), side: 1 },
    floor: { pos: new THREE.Vector3(1.0, 0.78, -0.42), side: 1 },
    hihat: { pos: new THREE.Vector3(-0.92, 1.16, 0.46), side: 0 },
    crashL: { pos: new THREE.Vector3(-1.28, 1.72, -0.18), side: 0 },
    crashR: { pos: new THREE.Vector3(1.4, 1.78, -0.34), side: 1 },
    ride: { pos: new THREE.Vector3(1.16, 1.5, -0.68), side: 1 },
  };
  const shells = {};
  const heads = {};
  const cymbals = {};
  const rims = {};
  const anim = {};
  for (const key of Object.keys(parts)) anim[key] = { t: -9, vel: 0 };
  const shellMat = new THREE.MeshPhysicalMaterial({
    color: 0x14206a, roughness: 0.34, metalness: 0.35, clearcoat: 1, clearcoatRoughness: 0.12,
    sheen: 0.4, sheenColor: new THREE.Color(0x6f8dff),
  });
  const headMat = std(C.cream, { roughness: 0.72 });

  // 底鼓
  const kick = new THREE.Group();
  kick.position.copy(parts.kick.pos);
  const kickShell = cyl(0.66, 0.66, 0.52, shellMat, 48);
  kickShell.rotation.x = Math.PI / 2;
  kick.add(kickShell);
  const frontHead = new THREE.Mesh(new THREE.CircleGeometry(0.63, 48), headMat.clone());
  frontHead.position.z = 0.265;
  shadow(frontHead, false, true);
  kick.add(frontHead);
  const kickRim = torus(0.64, 0.018, chrome(), 48);
  kickRim.position.z = 0.272;
  kick.add(kickRim);
  const kickLogo = new THREE.Mesh(
    new THREE.PlaneGeometry(0.52, 0.26),
    new THREE.MeshBasicMaterial({
      map: makeCanvasTexture((ctx, w, h) => {
        ctx.clearRect(0, 0, w, h);
        ctx.strokeStyle = '#1c2f8f';
        ctx.lineWidth = 8;
        ctx.beginPath(); ctx.arc(w / 2, h / 2, 86, 0, TAU); ctx.stroke();
        ctx.fillStyle = '#1c2f8f';
        ctx.font = '800 78px "Arial Black", "Microsoft YaHei", sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('ECHO', w / 2, h / 2 - 4);
        ctx.font = '600 30px "Segoe UI", sans-serif';
        ctx.fillText('STAGE', w / 2, h / 2 + 66);
      }, 512, 256),
      transparent: true, opacity: 0.9,
    }),
  );
  kickLogo.position.z = 0.278;
  kick.add(kickLogo);
  // 鼓腿
  for (const x of [-0.5, 0.5]) {
    const leg = cyl(0.018, 0.022, 0.45, darkMetal());
    leg.position.set(x, -0.4, 0.1);
    leg.rotation.z = x < 0 ? 0.5 : -0.5;
    kick.add(leg);
  }
  // 踏板 + 槌
  const beater = new THREE.Group();
  beater.position.set(0, -0.34, 0.52);
  const beaterRod = cyl(0.012, 0.012, 0.42, chrome());
  beaterRod.position.y = 0.21;
  beater.add(beaterRod);
  const beaterHead = new THREE.Mesh(new THREE.SphereGeometry(0.055, 16, 12), std(0xf0e7d6, { roughness: 0.8 }));
  beaterHead.position.y = 0.44;
  beater.add(beaterHead);
  beater.rotation.x = -0.3;
  kick.add(beater);
  group.add(kick);
  shells.kick = kickShell;
  heads.kick = frontHead;
  rims.kick = kickRim;

  // 军鼓 / 嗵鼓 / 落地嗵
  const buildDrum = (name, r, h, y, x, z, tilt = 0.16) => {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    g.rotation.x = tilt;
    const shell = cyl(r, r, h, shellMat, 32);
    g.add(shell);
    const head = new THREE.Mesh(new THREE.CircleGeometry(r * 0.96, 32), headMat.clone());
    head.rotation.x = -Math.PI / 2;
    head.position.y = h / 2 + 0.004;
    shadow(head, false, true);
    g.add(head);
    const rim = torus(r * 0.97, 0.012, chrome(), 40);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = h / 2;
    g.add(rim);
    // 鼓耳
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU;
      const lug = rounded(0.035, 0.06, 0.035, 0.008, darkMetal());
      lug.position.set(Math.cos(a) * r * 0.98, 0, Math.sin(a) * r * 0.98);
      lug.userData.detail = true;
      g.add(lug);
    }
    // 支架
    if (name !== 'floor') {
      const rodH = Math.max(0.1, y - h / 2);
      const rod = cyl(0.014, 0.014, rodH, chrome());
      rod.position.set(0, -h / 2 - rodH / 2, 0);
      g.add(rod);
      const foot = cyl(0.24, 0.26, 0.02, darkMetal(), 24);
      foot.position.set(0, -y + 0.01, 0);
      g.add(foot);
    } else {
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * TAU + 0.4;
        const leg = cyl(0.012, 0.012, 0.48, chrome());
        leg.position.set(Math.cos(a) * 0.25, -h / 2 - 0.2, Math.sin(a) * 0.25);
        leg.rotation.z = Math.cos(a) * 0.35;
        leg.rotation.x = -Math.sin(a) * 0.35;
        g.add(leg);
      }
    }
    group.add(g);
    shells[name] = shell;
    heads[name] = head;
    rims[name] = rim;
    return g;
  };
  buildDrum('snare', 0.29, 0.24, 1.0, 0.78, 0.48);
  buildDrum('tom1', 0.23, 0.25, 1.2, -0.38, 0.08, 0.22);
  buildDrum('tom2', 0.26, 0.27, 1.16, 0.4, -0.04, 0.2);
  buildDrum('floor', 0.34, 0.42, 0.8, 1.0, -0.42, 0.06);

  // 踩镲
  const hihat = new THREE.Group();
  hihat.position.set(-0.92, 0, 0.46);
  const hhRod = cyl(0.012, 0.012, 1.25, chrome());
  hhRod.position.y = 0.62;
  hihat.add(hhRod);
  const hhFoot = cyl(0.28, 0.3, 0.03, darkMetal(), 24);
  hhFoot.position.y = 0.02;
  hihat.add(hhFoot);
  const hhBottom = new THREE.Mesh(new THREE.LatheGeometry(cymbalProfile(0.33), 40), brass());
  hhBottom.material.side = THREE.DoubleSide;
  hhBottom.position.y = 1.04;
  hihat.add(hhBottom);
  const hhTop = new THREE.Mesh(new THREE.LatheGeometry(cymbalProfile(0.33), 40), brass());
  hhTop.material.side = THREE.DoubleSide;
  hhTop.position.y = 1.11;
  hihat.add(hhTop);
  group.add(hihat);
  cymbals.hihat = hhTop;
  parts.hihat.pos.set(-0.92, 1.12, 0.46);
  const hihatBase = 1.11;

  // 吊镲 / 叮叮镲
  const buildCymbal = (name, r, x, y, z, tiltX = 0.14, tiltZ = 0.1) => {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    const rod = cyl(0.012, 0.014, y, chrome());
    rod.position.y = y / 2;
    g.add(rod);
    const foot = cyl(0.26, 0.28, 0.025, darkMetal(), 24);
    foot.position.y = 0.012;
    g.add(foot);
    const cym = new THREE.Mesh(new THREE.LatheGeometry(cymbalProfile(r), 48), brass());
    cym.material.side = THREE.DoubleSide;
    cym.position.set(0, y, 0);
    cym.rotation.x = tiltX;
    cym.rotation.z = tiltZ;
    g.add(cym);
    // 镲帽
    const bell = new THREE.Mesh(new THREE.SphereGeometry(r * 0.22, 20, 12, 0, TAU, 0, Math.PI / 2), brass());
    bell.position.set(0, y + 0.02, 0);
    g.add(bell);
    group.add(g);
    cymbals[name] = cym;
    parts[name].pos.set(x, y, z);
    return cym;
  };
  buildCymbal('crashL', 0.46, -1.28, 1.72, -0.18, 0.18, 0.08);
  buildCymbal('crashR', 0.5, 1.4, 1.78, -0.34, 0.2, -0.12);
  buildCymbal('ride', 0.54, 1.16, 1.5, -0.68, 0.12, -0.08);

  // 悬浮鼓棒（无人乐队）
  const sticks = [];
  for (const side of [0, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(side ? 0.62 : -0.62, 1.95, 0.92);
    const stick = cyl(0.012, 0.017, 0.72, std(0xe4cfa8, { roughness: 0.6 }));
    stick.position.y = 0.36;
    pivot.add(stick);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.028, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffd9a8 }));
    tip.position.y = 0.72;
    pivot.add(tip);
    group.add(pivot);
    sticks.push({ pivot, side, rest: new THREE.Vector3(side ? 0.45 : -0.45, 1.3, 0.7), target: new THREE.Vector3() });
  }

  group.add(contactShadow(2.1, 0.45));
  const labels = { material: { opacity: 1 } };

  const state = {
    group, parts, anim, shells, heads, cymbals, rims, sticks,
    hihatTop: hhTop, hihatBase, beater,
    player: new Player(),
    last: -1,
    level: 0,
    hits: [],
  };

  function trigger(note, time) {
    const part = note.drum === 'hat' ? 'hihat' : note.drum === 'kick' ? 'kick' : note.drum === 'snare' ? 'snare' : note.drum === 'tom' ? (note.midi === 45 ? 'floor' : note.midi === 47 ? 'tom2' : 'tom1') : note.drum === 'crash' ? (note.t % 8 < 4 ? 'crashL' : 'crashR') : note.drum === 'openhat' ? 'hihat' : 'snare';
    if (!parts[part]) return;
    anim[part] = { t: note.t, vel: note.velocity ?? 0.7, open: note.drum === 'openhat' };
    if (part !== 'kick' && part !== 'hihat' && sticks[parts[part].side]) {
      const s = sticks[parts[part].side];
      s.target.copy(parts[part].pos);
      s.hitAt = note.t;
    }
    state.hits.push({
      pos: parts[part].pos.clone().add(new THREE.Vector3(part === 'kick' ? 0 : 0, 0.15, 0.2)),
      color: part === 'kick' ? C.orange : part === 'snare' ? C.pink : C.gold,
      strength: note.velocity ?? 0.7,
    });
    if (part === 'kick') state.level = Math.max(state.level, note.velocity ?? 0.7);
  }

  function update(time, dt, levels) {
    const hits = state.player.poll(time);
    for (const n of hits) trigger(n, time);
    state.level *= Math.exp(-dt * 3.5);

    const env = (p, decay = 9) => {
      const a = anim[p];
      return a ? hitEnv(time - a.t, decay) * a.vel : 0;
    };

    // 底鼓
    const ke = env('kick', 8);
    heads.kick.scale.set(1 + ke * 0.02, 1 + ke * 0.02, 1);
    kickLogo.material.opacity = 0.9 + ke * 0.1;
    beater.rotation.x = -0.3 + ke * 0.5;
    shells.kick.scale.set(1 + ke * 0.012, 1, 1 + ke * 0.012);

    // 鼓面
    for (const p of ['snare', 'tom1', 'tom2', 'floor']) {
      const e = env(p, 11);
      const head = heads[p];
      head.scale.set(1 + e * 0.025, 1 + e * 0.025, 1);
      head.material.emissive.setHex(0x000000);
      head.material.emissiveIntensity = e * 0.4;
    }
    // 踩镲开合
    const hh = anim.hihat;
    const hhEnv = hh ? Math.exp(-(time - hh.t) * (hh.open ? 3 : 12)) : 0;
    hhTop.position.y = hihatBase + (hh && hh.open ? 0.05 + (1 - hhEnv) * 0.06 : hhEnv * 0.03);
    hhTop.rotation.z = Math.sin((time - (hh?.t || 0)) * 30) * 0.02 * hhEnv;

    // 镲片晃动
    for (const p of ['crashL', 'crashR', 'ride']) {
      const e = env(p, 4.5);
      const cym = cymbals[p];
      const baseX = parts[p].pos.x > 0 ? 0.2 : 0.18;
      cym.rotation.x = baseX + Math.sin((time - anim[p].t) * 18) * 0.05 * e;
      cym.rotation.z = (p === 'crashR' ? -0.12 : p === 'ride' ? -0.08 : 0.08) + Math.sin((time - anim[p].t) * 14 + 1) * 0.04 * e;
    }

    // 鼓棒跟随最近敲击
    for (const s of sticks) {
      if (s.hitAt && time - s.hitAt > 0.26) {
        s.target.set(0, 0, 0);
        s.hitAt = 0;
      }
      const target = s.target.lengthSq() > 0 ? s.target : s.rest;
      const dir = target.clone().sub(s.pivot.position).normalize();
      const q = new THREE.Quaternion().setFromUnitVectors(UP, dir);
      s.pivot.quaternion.slerp(q, 1 - Math.exp(-dt * 16));
    }
    labels.material.opacity = 0.55 + state.level * 0.45;
    state.level = Math.max(state.level, ...Object.keys(anim).map((k) => env(k, 6)));
    return state.hits.splice(0);
  }

  return {
    ...state,
    update,
    setNotes(notes) { state.player.setNotes(notes); },
    seek(t) { state.player.reset(t); },
  };
}

function cymbalProfile(radius) {
  const pts = [];
  for (let i = 0; i <= 14; i++) {
    const t = i / 14;
    const r = t * radius;
    const y = 0.012 + Math.pow(t, 2.4) * 0.02 + (t < 0.22 ? (0.22 - t) * 0.18 : 0);
    pts.push(new THREE.Vector2(r, y));
  }
  return pts;
}

/* ------------------------------------------------------------------ */
/* 吉他 / 贝斯                                                          */
/* ------------------------------------------------------------------ */

function guitarBodyShape(scale = 1) {
  const s = new THREE.Shape();
  const k = scale;
  s.moveTo(-0.17 * k, 0.24 * k);
  s.bezierCurveTo(-0.25 * k, 0.24 * k, -0.27 * k, 0.14 * k, -0.245 * k, 0.04 * k);
  s.bezierCurveTo(-0.225 * k, -0.02 * k, -0.18 * k, -0.05 * k, -0.175 * k, -0.1 * k);
  s.bezierCurveTo(-0.2 * k, -0.2 * k, -0.12 * k, -0.28 * k, 0, -0.28 * k);
  s.bezierCurveTo(0.12 * k, -0.28 * k, 0.2 * k, -0.2 * k, 0.175 * k, -0.1 * k);
  s.bezierCurveTo(0.18 * k, -0.05 * k, 0.225 * k, -0.02 * k, 0.245 * k, 0.04 * k);
  s.bezierCurveTo(0.27 * k, 0.14 * k, 0.25 * k, 0.24 * k, 0.17 * k, 0.24 * k);
  s.closePath();
  return s;
}

function buildStrings(count, length, radius = 0.0016) {
  const strings = [];
  for (let i = 0; i < count; i++) {
    const x = (i / (count - 1) - 0.5) * 0.044;
    const geo = new THREE.BufferGeometry();
    const pts = [];
    for (let k = 0; k < 12; k++) pts.push(x, (k / 11) * length, 0);
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const mat = new THREE.LineBasicMaterial({ color: 0xe8e2d4, transparent: true, opacity: 0.9 });
    const line = new THREE.Line(geo, mat);
    line.userData.baseX = x;
    strings.push(line);
  }
  return strings;
}

function buildGuitar(opts) {
  const {
    color = C.guitarOrange, count = 6, tuning = [40, 45, 50, 55, 59, 64], scale = 1,
    bodyY = 1.02, stringStart = 1.06, stringEnd = 1.87, bodyShapeScale = 1, name = 'guitar',
  } = opts;
  const group = new THREE.Group();
  const bodyMat = paint(color, { metalness: 0.18, roughness: 0.32 });
  bodyMat.emissive = new THREE.Color(opts.sparkColor || C.pink);
  bodyMat.emissiveIntensity = 0;
  const neckMat = std(0xb98a5a, { roughness: 0.55 });
  const fretMat = std(0x2a2522, { roughness: 0.7 });
  const boardMat = std(0x3b2b25, { roughness: 0.85 });

  const body = new THREE.Mesh(
    new THREE.ExtrudeGeometry(guitarBodyShape(bodyShapeScale), {
      depth: 0.06, bevelEnabled: true, bevelSize: 0.01, bevelThickness: 0.012, bevelSegments: 3, curveSegments: 18,
    }),
    bodyMat,
  );
  body.position.set(0, bodyY, 0);
  group.add(body);

  // 护板
  const guardShape = guitarBodyShape(bodyShapeScale * 0.82);
  const guard = new THREE.Mesh(
    new THREE.ExtrudeGeometry(guardShape, { depth: 0.008, bevelEnabled: false, curveSegments: 16 }),
    std(C.cream, { roughness: 0.5 }),
  );
  guard.position.set(0, bodyY - 0.03, 0.066);
  guard.scale.set(0.66, 0.62, 1);
  group.add(guard);

  // 琴颈
  const neckLen = stringEnd - stringStart - 0.02;
  const neck = rounded(0.058, neckLen + 0.12, 0.032, 0.008, neckMat);
  neck.position.set(0, (stringStart + stringEnd) / 2 - 0.01, 0.02);
  group.add(neck);
  const board = rounded(0.062, neckLen, 0.012, 0.004, boardMat);
  board.position.set(0, (stringStart + stringEnd) / 2 - 0.005, 0.044);
  group.add(board);

  // 品丝
  for (let f = 1; f <= 22; f++) {
    const frac = (1 - Math.pow(2, -f / 12)) / (1 - Math.pow(2, -22 / 12));
    const y = stringEnd - frac * (stringEnd - stringStart - 0.04) - 0.02;
    const fret = new THREE.Mesh(new THREE.BoxGeometry(0.058, 0.003, 0.004), std(0xd8d3c8, { metalness: 0.9, roughness: 0.3 }));
    fret.position.set(0, y, 0.051);
    fret.userData.detail = true;
    group.add(fret);
  }
  // 品位点
  for (const f of [3, 5, 7, 9, 12, 15, 17, 19, 21]) {
    const frac = (1 - Math.pow(2, -f / 12)) / (1 - Math.pow(2, -22 / 12));
    const y = stringEnd - frac * (stringEnd - stringStart - 0.04) - 0.02;
    const dot = new THREE.Mesh(new THREE.CircleGeometry(0.008, 12), std(0xf0e7d6));
    dot.position.set(0, y, 0.057);
    dot.userData.detail = true;
    group.add(dot);
  }

  // 琴头
  const head = rounded(0.075, 0.16, 0.028, 0.012, bodyMat);
  head.position.set(0, stringEnd + 0.08, 0.015);
  head.rotation.z = 0.08;
  group.add(head);
  for (let i = 0; i < count; i++) {
    const x = (i / (count - 1) - 0.5) * 0.07;
    const tuner = cyl(0.012, 0.012, 0.035, chrome(), 12);
    tuner.rotation.z = Math.PI / 2;
    tuner.position.set(x * 1.2, stringEnd + 0.05, 0.035);
    tuner.userData.detail = true;
    group.add(tuner);
  }

  // 弦
  const strings = buildStrings(count, stringEnd - stringStart);
  for (let i = 0; i < count; i++) {
    const line = strings[i];
    line.position.set(0, stringStart, 0.058);
    line.userData.baseX = (i / (count - 1) - 0.5) * 0.044;
    group.add(line);
  }

  // 拾音器 / 琴桥 / 旋钮
  for (const y of [bodyY + 0.06, bodyY + 0.13, bodyY + 0.2]) {
    const pu = rounded(0.13, 0.028, 0.018, 0.006, std(0x191a1c, { roughness: 0.6 }));
    pu.position.set(0, y, 0.075);
    group.add(pu);
  }
  const bridge = rounded(0.11, 0.035, 0.018, 0.004, chrome());
  bridge.position.set(0, bodyY - 0.035, 0.078);
  group.add(bridge);
  for (let i = 0; i < 3; i++) {
    const knob = cyl(0.018, 0.018, 0.014, std(0x191a1c, { roughness: 0.4 }), 16);
    knob.position.set(0.09 + (i % 2) * 0.045, bodyY - 0.13 - Math.floor(i / 2) * 0.05, 0.072);
    knob.rotation.x = Math.PI / 2;
    knob.userData.detail = true;
    group.add(knob);
  }
  // 拨片扫弦光
  const pick = new THREE.Mesh(
    new THREE.PlaneGeometry(0.07, 0.02),
    new THREE.MeshBasicMaterial({ color: C.gold, transparent: true, opacity: 0, side: THREE.DoubleSide }),
  );
  pick.position.set(0, bodyY + 0.01, 0.09);
  group.add(pick);

  // 发光品位标记
  const fretGlow = new THREE.Mesh(
    new THREE.RingGeometry(0.02, 0.032, 24),
    new THREE.MeshBasicMaterial({ color: C.gold, transparent: true, opacity: 0, side: THREE.DoubleSide }),
  );
  fretGlow.position.set(0, stringStart + 0.2, 0.06);
  group.add(fretGlow);

  // 琴架
  const stand = new THREE.Group();
  for (const x of [-0.16, 0.16]) {
    const leg = cyl(0.012, 0.014, 1.0, darkMetal(), 8);
    leg.position.set(x, 0.5, -0.02);
    leg.rotation.z = x < 0 ? 0.16 : -0.16;
    stand.add(leg);
  }
  const standBase = rounded(0.42, 0.025, 0.28, 0.01, darkMetal());
  standBase.position.y = 0.015;
  stand.add(standBase);
  const yoke = rounded(0.26, 0.035, 0.05, 0.01, std(0x222326, { roughness: 0.5 }));
  yoke.position.set(0, bodyY - 0.2, -0.07);
  stand.add(yoke);
  group.add(stand);
  group.add(contactShadow(0.75, 0.4));

  group.rotation.x = -0.12;
  group.position.y = 0.02;

  const stringsState = new Array(count).fill(null).map(() => ({ t: -9, amp: 0, midi: 0 }));
  const state = {
    group, player: new Player(), strings, stringsState, fretGlow, pick, bodyMat,
    tuning, count, stringStart, stringEnd, bodyY,
    hits: [], last: -1, activity: 0,
  };

  function stringForMidi(midi) {
    let best = null;
    for (let i = 0; i < count; i++) {
      const fret = midi - tuning[i];
      if (fret >= 0 && fret <= 22 && (!best || fret < best.fret)) best = { index: i, fret };
    }
    if (!best) {
      // 音域外：折叠到最近弦
      let closest = 0;
      let diff = Infinity;
      for (let i = 0; i < count; i++) {
        const d = Math.abs(midi - tuning[i]);
        if (d < diff) { diff = d; closest = i; }
      }
      best = { index: closest, fret: Math.max(0, Math.min(22, midi - tuning[closest])) };
    }
    return best;
  }

  function update(time, dt) {
    const hits = state.player.poll(time);
    for (const n of hits) {
      const s = stringForMidi(n.midi);
      stringsState[s.index] = { t: n.t, amp: 0.018 + (n.velocity ?? 0.6) * 0.02, midi: n.midi };
      const frac = (1 - Math.pow(2, -s.fret / 12)) / (1 - Math.pow(2, -22 / 12));
      fretGlow.position.y = stringEnd - frac * (stringEnd - stringStart - 0.04) - 0.02;
      fretGlow.material.opacity = 0.9;
      pick.material.opacity = 0.9;
      pick.userData.t = n.t;
      state.activity = Math.max(state.activity, n.velocity ?? 0.6);
      state.hits.push({
        pos: new THREE.Vector3((Math.random() - 0.5) * 0.4, bodyY + 0.1 + Math.random() * 0.3, 0.2),
        color: opts.sparkColor || C.pink,
        strength: n.velocity ?? 0.6,
      });
    }
    state.activity *= Math.exp(-dt * 2.5);

    // 弦振动
    for (let i = 0; i < count; i++) {
      const line = strings[i];
      const s = stringsState[i];
      const age = time - s.t;
      if (age > 1.2) {
        if (line.material.opacity !== 0.9) line.material.opacity = 0.9;
        continue;
      }
      const amp = s.amp * Math.exp(-age * 5.5);
      const pos = line.geometry.attributes.position;
      for (let k = 0; k < 12; k++) {
        const u = k / 11;
        pos.setZ(k, Math.sin(Math.PI * u) * Math.sin(age * TAU * 13 + u * 6) * amp);
      }
      pos.needsUpdate = true;
    }
    fretGlow.material.opacity *= Math.exp(-dt * 4.2);
    pick.material.opacity *= Math.exp(-dt * 8);
    if (pick.userData.t) {
      const age = time - pick.userData.t;
      pick.position.x = -0.04 + Math.min(1, age / 0.09) * 0.08;
    }
    state.bodyMat.emissiveIntensity = state.activity * 0.08;
    return state.hits.splice(0);
  }

  return {
    ...state, update,
    setNotes(notes) { state.player.setNotes(notes); },
    seek(t) { state.player.reset(t); },
  };
}

/* ------------------------------------------------------------------ */
/* 键盘                                                                */
/* ------------------------------------------------------------------ */

function buildKeyboardTier(startMidi, endMidi, width = 1.33) {
  const group = new THREE.Group();
  const keyCount = endMidi - startMidi + 1;
  const whiteIdx = [];
  for (let m = startMidi; m <= endMidi; m++) {
    const pc = ((m % 12) + 12) % 12;
    if (![1, 3, 6, 8, 10].includes(pc)) whiteIdx.push(m);
  }
  const whiteW = width / whiteIdx.length;
  const keybed = rounded(width + 0.08, 0.055, 0.24, 0.02, std(0x1a1b1d, { roughness: 0.45 }));
  keybed.position.set(0, -0.01, 0);
  group.add(keybed);
  const keys = new Map();
  whiteIdx.forEach((midi, i) => {
    const x = -width / 2 + whiteW * (i + 0.5);
    const pivot = new THREE.Group();
    pivot.position.set(x, 0.03, -0.09);
    const key = rounded(whiteW * 0.92, 0.026, 0.165, 0.006, std(0xf2ecdf, { roughness: 0.3 }));
    key.position.set(0, 0, 0.082);
    pivot.add(key);
    group.add(pivot);
    keys.set(midi, { pivot, mesh: key, black: false, base: 0 });
  });
  for (let m = startMidi; m <= endMidi; m++) {
    const pc = ((m % 12) + 12) % 12;
    if (![1, 3, 6, 8, 10].includes(pc)) continue;
    const prevWhite = whiteIdx.filter((w) => w < m).length;
    const x = -width / 2 + whiteW * prevWhite;
    const pivot = new THREE.Group();
    pivot.position.set(x, 0.045, -0.06);
    const key = rounded(whiteW * 0.52, 0.03, 0.1, 0.006, std(0x17181a, { roughness: 0.25 }));
    key.position.set(0, 0, 0.05);
    pivot.add(key);
    group.add(pivot);
    keys.set(m, { pivot, mesh: key, black: true, base: 0.02 });
  }
  return { group, keys, width, keyCount };
}

function buildKeyboard() {
  const group = new THREE.Group();
  const tierA = buildKeyboardTier(48, 84, 1.5);
  const tierB = buildKeyboardTier(48, 84, 1.5);
  tierA.group.position.y = 1.02;
  tierA.group.rotation.x = -0.1;
  tierB.group.position.y = 1.38;
  tierB.group.position.z = -0.03;
  tierB.group.rotation.x = -0.1;
  tierB.group.scale.setScalar(0.92);
  group.add(tierA.group, tierB.group);

  const panel = rounded(0.62, 0.17, 0.1, 0.02, std(0x26272a, { roughness: 0.4 }));
  panel.position.set(0.38, 1.58, -0.02);
  group.add(panel);
  const screenTex = makeCanvasTexture((ctx, w, h) => {
    ctx.fillStyle = '#0c1713'; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#79f2c0'; ctx.lineWidth = 3;
    ctx.beginPath();
    for (let x = 0; x < w; x += 6) {
      const y = h / 2 + Math.sin(x * 0.04) * 22;
      x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.fillStyle = '#79f2c0'; ctx.font = '600 40px "Cascadia Mono", monospace';
    ctx.fillText('ECHO', 22, 52);
  }, 512, 192);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.13), new THREE.MeshBasicMaterial({ map: screenTex }));
  screen.position.set(0.38, 1.585, 0.035);
  group.add(screen);
  for (let i = 0; i < 4; i++) {
    const knob = cyl(0.014, 0.014, 0.02, darkMetal(), 12);
    knob.rotation.x = Math.PI / 2;
    knob.position.set(0.15 + i * 0.055, 1.5, 0.02);
    knob.userData.detail = true;
    group.add(knob);
  }

  // X 架
  for (const dir of [1, -1]) {
    const leg = cyl(0.017, 0.02, 1.7, darkMetal(), 8);
    leg.position.set(0, 0.76, dir * 0.22);
    leg.rotation.x = dir * 0.32;
    group.add(leg);
  }
  const cross = cyl(0.015, 0.015, 0.9, darkMetal(), 8);
  cross.rotation.z = Math.PI / 2;
  cross.position.y = 0.45;
  group.add(cross);
  const pedal = rounded(0.13, 0.03, 0.09, 0.01, darkMetal());
  pedal.position.set(0.2, 0.03, 0.28);
  group.add(pedal);
  group.add(contactShadow(1.0, 0.38));
  const labels = { material: { opacity: 1 } };

  const state = {
    group, tiers: [tierA, tierB], player: new Player(),
    press: new Map(), last: -1, activity: 0, hits: [], labels,
  };

  function noteAt(midi) {
    const m = Math.max(48, Math.min(84, midi));
    return state.tiers[0].keys.get(m) || state.tiers[0].keys.get(48);
  }

  function update(time, dt) {
    const hits = state.player.poll(time);
    for (const n of hits) {
      const key = noteAt(n.midi);
      if (!key) continue;
      state.press.set(n.midi, 1);
      state.activity = Math.max(state.activity, n.velocity ?? 0.6);
      state.hits.push({
        pos: new THREE.Vector3((Math.random() - 0.5) * 1.2, 1.2 + Math.random() * 0.2, 0.15),
        color: C.mint, strength: n.velocity ?? 0.6,
      });
    }
    state.activity *= Math.exp(-dt * 2.4);
    for (const [midi, v] of state.press) {
      const next = v - dt * 7;
      if (next <= 0) state.press.delete(midi);
      else state.press.set(midi, next);
    }
    for (const [midi, key] of state.tiers[0].keys) {
      const v = state.press.get(midi) || 0;
      key.pivot.rotation.x = v * 0.085;
      key.mesh.material.emissive.setHex(C.mint);
      key.mesh.material.emissiveIntensity = v * 0.6;
    }
    for (const [midi, key] of state.tiers[1].keys) {
      const v = state.press.get(midi) || 0;
      key.pivot.rotation.x = v * 0.075;
      key.mesh.material.emissive.setHex(C.mint);
      key.mesh.material.emissiveIntensity = v * 0.35;
    }
    labels.material.opacity = 0.55 + state.activity * 0.4;
    return state.hits.splice(0);
  }

  return {
    ...state, update,
    setNotes(notes) { state.player.setNotes(notes); },
    seek(t) { state.player.reset(t); },
  };
}

/* ------------------------------------------------------------------ */
/* 人声麦克风                                                          */
/* ------------------------------------------------------------------ */

function buildMic() {
  const group = new THREE.Group();
  const standMat = darkMetal();
  const base = cyl(0.3, 0.34, 0.03, standMat, 32);
  base.position.y = 0.015;
  group.add(base);
  const pole = cyl(0.02, 0.022, 1.62, standMat, 16);
  pole.position.y = 0.83;
  group.add(pole);
  const boom = cyl(0.016, 0.016, 0.62, standMat, 12);
  boom.position.set(0.24, 1.62, 0);
  boom.rotation.z = -1.15;
  group.add(boom);
  const shock = torus(0.13, 0.008, chrome(), 32);
  shock.position.set(0.5, 1.72, 0);
  shock.rotation.x = Math.PI / 2;
  group.add(shock);
  const mic = new THREE.Group();
  mic.position.set(0.5, 1.72, 0.02);
  mic.rotation.z = -0.15;
  const micBody = cyl(0.045, 0.05, 0.16, std(0xd8cfbd, { roughness: 0.32, metalness: 0.5 }), 20);
  micBody.position.y = 0.05;
  mic.add(micBody);
  const grille = new THREE.Mesh(
    new THREE.SphereGeometry(0.075, 24, 16, 0, TAU, 0, Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0xd8d3c8, metalness: 0.95, roughness: 0.32 }),
  );
  grille.position.y = 0.16;
  mic.add(grille);
  group.add(mic);

  // 防喷罩
  const popRing = torus(0.11, 0.007, chrome(), 32);
  popRing.position.set(0.44, 1.72, 0.25);
  group.add(popRing);
  const popMesh = new THREE.Mesh(
    new THREE.CircleGeometry(0.105, 32),
    new THREE.MeshBasicMaterial({ color: 0x0e0f11, transparent: true, opacity: 0.35, side: THREE.DoubleSide }),
  );
  popMesh.position.set(0.44, 1.72, 0.25);
  group.add(popMesh);
  const cable = new THREE.Mesh(
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.5, 1.62, -0.02),
      new THREE.Vector3(0.44, 1.2, -0.04),
      new THREE.Vector3(0.3, 0.2, 0.16),
      new THREE.Vector3(0.9, 0.03, 0.55),
    ]), 40, 0.008, 6, false),
    std(0x141416, { roughness: 0.8 }),
  );
  group.add(cable);

  // 麦克风的舞台光环，让主唱位置在远景里也能被看见
  const micHalo = new THREE.Mesh(
    new THREE.TorusGeometry(0.46, 0.006, 8, 64),
    new THREE.MeshBasicMaterial({ color: C.gold, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending }),
  );
  micHalo.position.set(0.42, 1.85, 0.02);
  micHalo.rotation.x = Math.PI / 2;
  group.add(micHalo);

  // 音高丝带
  const ribbonCount = 80;
  const ribbonGeo = new THREE.BufferGeometry();
  ribbonGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Array(ribbonCount * 3).fill(0), 3));
  const ribbonColors = new Float32Array(ribbonCount * 3);
  for (let i = 0; i < ribbonCount; i++) {
    const t = i / (ribbonCount - 1);
    const c = new THREE.Color(C.gold).lerp(new THREE.Color(C.pink), t);
    ribbonColors[i * 3] = c.r; ribbonColors[i * 3 + 1] = c.g; ribbonColors[i * 3 + 2] = c.b;
  }
  ribbonGeo.setAttribute('color', new THREE.BufferAttribute(ribbonColors, 3));
  const ribbon = new THREE.Line(ribbonGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9 }));
  ribbon.position.set(0, 0, 0);
  group.add(ribbon);

  // 颤音环
  const rings = [];
  for (let i = 0; i < 4; i++) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.12, 0.005, 8, 40),
      new THREE.MeshBasicMaterial({ color: C.gold, transparent: true, opacity: 0 }),
    );
    ring.position.set(0.5, 1.8, 0);
    ring.rotation.x = Math.PI / 2;
    group.add(ring);
    rings.push({ mesh: ring, t: -9 });
  }

  // 频谱条
  const bars = [];
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * TAU;
    const bar = new THREE.Mesh(
      new THREE.BoxGeometry(0.025, 0.1, 0.025),
      new THREE.MeshBasicMaterial({ color: C.gold, transparent: true, opacity: 0.65 }),
    );
    bar.position.set(Math.cos(a) * 0.55, 0.08, Math.sin(a) * 0.55);
    group.add(bar);
    bars.push({ mesh: bar, a, base: 0.1 });
  }
  group.add(contactShadow(0.75, 0.4));
  const labels = { material: { opacity: 1 } };

  const state = {
    group, player: new Player(), notes: [], ribbon, rings, bars, micHalo,
    activity: 0, hits: [], lastLead: null, lastVibrato: -9, labels,
  };

  function pitchAt(time) {
    const notes = state.notes;
    let lo = 0;
    let hi = notes.length - 1;
    let found = null;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (notes[mid].t <= time) { found = notes[mid]; lo = mid + 1; }
      else hi = mid - 1;
    }
    return found && time <= found.t + found.dur + 0.05 ? found : null;
  }

  function update(time, dt, levels) {
    const hits = state.player.poll(time);
    for (const n of hits) {
      state.activity = Math.max(state.activity, n.velocity ?? 0.6);
      state.hits.push({
        pos: new THREE.Vector3((Math.random() - 0.5) * 0.5, 2.0 + Math.random() * 0.4, 0.1),
        color: C.gold, strength: n.velocity ?? 0.6,
      });
      state.lastLead = n;
    }
    state.activity *= Math.exp(-dt * 2.2);

    const active = pitchAt(time);
    const pos = ribbon.geometry.attributes.position;
    for (let i = 0; i < ribbonCount; i++) {
      const u = i / (ribbonCount - 1);
      const sampleT = time - (1 - u) * 1.7;
      const n = pitchAt(sampleT);
      let y = 1.95;
      let x = (u - 1) * 1.25;
      let z = 0.04;
      if (n) {
        const local = sampleT - n.t;
        const vib = n.fx?.vibrato ? Math.sin(local * TAU * (n.fx.vibrato.rate || 5.4)) * (n.fx.vibrato.depth || 0.2) * 0.04 : 0;
        y = 1.95 + (n.midi - 69) * 0.022 + vib;
        z = 0.12 + Math.sin(u * 10 + time * 2) * 0.012;
      }
      pos.setXYZ(i, x, y, z);
    }
    pos.needsUpdate = true;
    ribbon.material.opacity = active ? 0.85 : Math.max(0, ribbon.material.opacity - dt * 1.5);

    // 颤音环
    if (active && active.fx?.vibrato && time - state.lastVibrato > 0.16) {
      state.lastVibrato = time;
      const ring = rings.find((r) => time - r.t > 0.9) || rings[0];
      ring.t = time;
      ring.mesh.position.set(0.5, 1.8 + (active.midi - 69) * 0.01, 0.02);
      ring.mesh.scale.setScalar(1);
      ring.mesh.material.opacity = 0.65;
    }
    for (const r of rings) {
      const age = time - r.t;
      if (age < 1.4) {
        r.mesh.scale.setScalar(1 + age * 2.2);
        r.mesh.material.opacity = Math.max(0, 0.55 * (1 - age / 1.4));
      } else r.mesh.material.opacity = 0;
    }

    // 频谱环
    const levelArr = levels && levels.length ? levels : null;
    for (let i = 0; i < bars.length; i++) {
      const b = bars[i];
      const v = levelArr ? levelArr[Math.floor((i / bars.length) * Math.min(levelArr.length, 64))] || 0 : (0.2 + state.activity * 0.3);
      const s = 0.3 + Math.min(1, v * 2.2) * 1.8;
      b.mesh.scale.y = s;
      b.mesh.position.y = 0.06 + 0.05 * s;
      b.mesh.material.opacity = 0.3 + Math.min(0.7, v);
    }
    labels.material.opacity = 0.55 + state.activity * 0.4;
    micHalo.rotation.z = time * 0.4;
    micHalo.material.opacity = 0.16 + state.activity * 0.5;
    micHalo.scale.setScalar(1 + state.activity * 0.12);
    return state.hits.splice(0);
  }

  return {
    ...state, update,
    setNotes(notes) { state.notes = notes; state.player.setNotes(notes); },
    seek(t) { state.player.reset(t); },
  };
}

/* ------------------------------------------------------------------ */
/* 音箱 / 舞台灯                                                       */
/* ------------------------------------------------------------------ */

function buildAmp(color = 0x2c2d31) {
  const group = new THREE.Group();
  const box = rounded(0.86, 0.72, 0.42, 0.03, std(color, { roughness: 0.55 }));
  box.position.y = 0.38;
  group.add(box);
  const grilleTex = makeCanvasTexture((ctx, w, h) => {
    ctx.fillStyle = '#1a1b1d'; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(240,231,214,0.12)'; ctx.lineWidth = 2;
    for (let x = -h; x < w + h; x += 10) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + h, h); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x + h, 0); ctx.lineTo(x, h); ctx.stroke();
    }
  }, 512, 512);
  const grille = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 0.5), new THREE.MeshStandardMaterial({ map: grilleTex, roughness: 0.9 }));
  grille.position.set(0, 0.36, 0.216);
  group.add(grille);
  const cone = new THREE.Mesh(
    new THREE.CircleGeometry(0.17, 32),
    new THREE.MeshStandardMaterial({ color: 0x101012, roughness: 0.85 }),
  );
  cone.position.set(0, 0.36, 0.222);
  group.add(cone);
  const dust = new THREE.Mesh(new THREE.CircleGeometry(0.06, 24), std(0x3a3b3e, { roughness: 0.9 }));
  dust.position.set(0, 0.36, 0.226);
  group.add(dust);
  const logo = new THREE.Mesh(
    new THREE.PlaneGeometry(0.24, 0.06),
    new THREE.MeshBasicMaterial({
      map: makeCanvasTexture((ctx, w, h) => {
        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = '#f0e7d6'; ctx.font = '800 44px "Arial Black", sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('ECHO', w / 2, h / 2);
      }, 256, 64),
      transparent: true,
    }),
  );
  logo.position.set(0, 0.6, 0.228);
  group.add(logo);
  for (let i = 0; i < 4; i++) {
    const knob = cyl(0.02, 0.02, 0.02, darkMetal(), 12);
    knob.rotation.x = Math.PI / 2;
    knob.position.set(-0.25 + i * 0.12, 0.66, 0.225);
    knob.userData.detail = true;
    group.add(knob);
  }
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 8), new THREE.MeshBasicMaterial({ color: 0xff4f8b }));
  led.position.set(0.38, 0.68, 0.225);
  group.add(led);
  const handle = torus(0.12, 0.015, darkMetal(), 24);
  handle.rotation.x = Math.PI / 2;
  handle.position.set(0, 0.76, 0);
  group.add(handle);
  group.add(contactShadow(0.7, 0.45));
  return { group, cone, dust };
}

function buildStageLight(color, target, height = 2.5, position = [0, 0, 0]) {
  const group = new THREE.Group();
  group.position.set(...position);
  const stand = new THREE.Group();
  const base = cyl(0.34, 0.38, 0.04, darkMetal(), 24);
  base.position.y = 0.02;
  stand.add(base);
  const pole = cyl(0.022, 0.026, height, darkMetal(), 12);
  pole.position.y = height / 2;
  stand.add(pole);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * TAU;
    const leg = cyl(0.012, 0.012, 0.5, darkMetal(), 8);
    leg.position.set(Math.cos(a) * 0.2, 0.14, Math.sin(a) * 0.2);
    leg.rotation.z = Math.cos(a) * 0.5;
    leg.rotation.x = -Math.sin(a) * 0.5;
    stand.add(leg);
  }
  group.add(stand);
  const yoke = new THREE.Group();
  yoke.position.y = height;
  yoke.rotation.y = Math.atan2(target[0] - position[0], target[2] - position[2]);
  const canBody = cyl(0.1, 0.13, 0.26, std(0x202124, { roughness: 0.4, metalness: 0.5 }), 20);
  canBody.rotation.x = Math.PI / 2;
  canBody.position.z = 0.0;
  yoke.add(canBody);
  const lens = new THREE.Mesh(
    new THREE.CircleGeometry(0.095, 24),
    new THREE.MeshBasicMaterial({ color }),
  );
  lens.position.z = 0.14;
  yoke.add(lens);
  const ring = torus(0.11, 0.012, darkMetal(), 24);
  ring.position.z = 0.14;
  yoke.add(ring);
  yoke.rotation.x = -0.5;
  group.add(yoke);

  const start = new THREE.Vector3(...position).add(new THREE.Vector3(0, height, 0.08));
  const beamDir = new THREE.Vector3(...target).sub(start);
  const len = beamDir.length();
  const beamGeo = new THREE.CylinderGeometry(0.85, 0.09, len, 24, 1, true);
  const beamMat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uOpacity: { value: 0.08 }, uTime: { value: 0 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `varying vec2 vUv; uniform vec3 uColor; uniform float uOpacity; uniform float uTime;
      void main(){ float edge = smoothstep(0.0,0.18,vUv.x)*smoothstep(1.0,0.82,vUv.x);
        float fade = pow(1.0-vUv.y, 1.5)*smoothstep(0.0,0.08,vUv.y);
        float flick = 0.9+0.1*sin(uTime*8.0+vUv.y*20.0);
        gl_FragColor=vec4(uColor, uOpacity*edge*fade*flick); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  const beam = new THREE.Mesh(beamGeo, beamMat);
  const mid = start.clone().add(beamDir.clone().multiplyScalar(0.5));
  beam.position.copy(mid).sub(new THREE.Vector3(...position));
  beam.quaternion.setFromUnitVectors(UP, beamDir.clone().normalize());
  beam.renderOrder = 2;
  group.add(beam);

  return { group, beam, beamMat, lens, color, target: new THREE.Vector3(...target) };
}

/* ------------------------------------------------------------------ */
/* 乐队总装                                                            */
/* ------------------------------------------------------------------ */

export function createBand(scene) {
  const root = new THREE.Group();
  scene.add(root);

  const drums = buildDrumKit();
  drums.group.position.set(0, 0.02, -2.3);
  root.add(drums.group);

  const bass = buildGuitar({
    color: C.bassWine, count: 4, tuning: [28, 33, 38, 43], bodyShapeScale: 1.06,
    stringStart: 1.02, stringEnd: 1.92, bodyY: 0.98, sparkColor: C.blue, name: 'bass',
  });
  bass.group.position.set(-3.05, 0.02, -0.3);
  bass.group.rotation.y = 0.34;
  bass.group.scale.setScalar(1.16);
  root.add(bass.group);

  const guitar = buildGuitar({
    color: C.guitarOrange, count: 6, tuning: [40, 45, 50, 55, 59, 64],
    sparkColor: C.pink, name: 'guitar',
  });
  guitar.group.position.set(3.0, 0.02, -0.25);
  guitar.group.rotation.y = -0.34;
  guitar.group.scale.setScalar(1.18);
  root.add(guitar.group);

  const keys = buildKeyboard();
  keys.group.position.set(-3.55, 0.02, 1.35);
  keys.group.rotation.y = 0.5;
  keys.group.scale.setScalar(0.96);
  root.add(keys.group);

  const mic = buildMic();
  mic.group.position.set(2.7, 0.02, 1.8);
  mic.group.rotation.y = -0.72;
  mic.group.scale.setScalar(1.34);
  root.add(mic.group);

  const ampBass = buildAmp(0x26272b);
  ampBass.group.position.set(-5.0, 0.02, -2.1);
  ampBass.group.rotation.y = 0.5;
  root.add(ampBass.group);
  const ampGuitar = buildAmp(0x2b2624);
  ampGuitar.group.position.set(5.0, 0.02, -2.0);
  ampGuitar.group.rotation.y = -0.5;
  root.add(ampGuitar.group);

  const lights = [
    buildStageLight(0xff7a4a, [-5.2, 1.2, 0.2], 2.7, [-6.6, 0, -3.0]),
    buildStageLight(0xff4f8b, [4.6, 1.2, 0.4], 2.7, [6.6, 0, -3.0]),
    buildStageLight(0x6a8cff, [-1.5, 1.4, -1.8], 3.0, [-3.0, 0, -6.2]),
    buildStageLight(0xffd166, [1.8, 1.3, -1.5], 3.0, [3.0, 0, -6.2]),
  ];
  for (const l of lights) root.add(l.group);

  const instruments = { drums, bass, guitar, keys, lead: mic };
  const positions = {
    drums: new THREE.Vector3(0, 1.4, -2.3),
    bass: new THREE.Vector3(-3.05, 1.2, -0.3),
    guitar: new THREE.Vector3(3.0, 1.2, -0.25),
    keys: new THREE.Vector3(-3.55, 1.2, 1.35),
    lead: new THREE.Vector3(2.7, 1.4, 1.8),
  };
  const extras = { amps: [ampBass, ampGuitar], lights };

  let activeIds = new Set(['drums', 'bass', 'guitar', 'keys', 'lead']);
  let bandTime = 0;

  function setScore(score) {
    for (const track of score.tracks) {
      const inst = instruments[track.id];
      if (!inst) continue;
      inst.setNotes(track.notes);
      inst.seek(0);
    }
    activeIds = new Set(score.tracks.filter((t) => t.notes.length > 0).map((t) => t.id));
  }

  function update(time, dt, levels) {
    bandTime = time;
    const hits = [];
    for (const id of activeIds) {
      const inst = instruments[id];
      if (!inst) continue;
      const h = inst.update(time, dt, levels);
      if (h && h.length) {
        for (const item of h) {
          if (item.pos) item.pos.applyMatrix4(inst.group.matrixWorld);
        }
        hits.push(...h);
      }
    }
    // 音箱随演奏起伏
    const bassAct = instruments.bass.activity || 0;
    const guitarAct = instruments.guitar.activity || 0;
    ampBass.cone.scale.setScalar(1 + bassAct * 0.08);
    ampBass.dust.scale.setScalar(1 + bassAct * 0.16);
    ampGuitar.cone.scale.setScalar(1 + guitarAct * 0.09);
    ampGuitar.dust.scale.setScalar(1 + guitarAct * 0.18);
    for (const l of lights) {
      l.beamMat.uniforms.uTime.value = time;
    }
    return hits;
  }

  function seek(time) {
    for (const inst of Object.values(instruments)) inst.seek(time);
    bandTime = time;
  }

  function setActive(id, on) {
    if (on) activeIds.add(id);
    else activeIds.delete(id);
    instruments[id].group.visible = on;
  }

  function getActivity(id) {
    return instruments[id]?.activity || 0;
  }

  root.updateMatrixWorld(true);

  return {
    root, instruments, positions, extras,
    setScore, update, seek, setActive, getActivity,
    bands: { drums: drums.group, bass: bass.group, guitar: guitar.group, keys: keys.group, lead: mic.group },
  };
}

export { C as COLORS, makeCanvasTexture };

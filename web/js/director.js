/**
 * EchoStage · 导演系统
 * 根据段落自动切换机位；同时支持鼠标自由环绕。
 */

import * as THREE from 'three';

const SHOTS = {
  wide: { pos: [0, 3.65, 13.6], look: [0, 1.35, 0], fov: 34 },
  drums: { pos: [2.9, 3.2, 5.0], look: [0, 1.25, -2.3], fov: 35 },
  bass: { pos: [-6.1, 2.7, 4.0], look: [-3.25, 1.2, -0.35], fov: 33 },
  guitar: { pos: [6.1, 2.6, 3.9], look: [3.2, 1.2, -0.3], fov: 33 },
  keys: { pos: [-5.6, 2.9, 5.4], look: [-3.55, 1.25, 1.35], fov: 33 },
  lead: { pos: [5.2, 3.0, 5.0], look: [2.7, 1.45, 1.8], fov: 32 },
  overhead: { pos: [0, 9.8, 5.2], look: [0, 0.65, -0.8], fov: 38 },
  low: { pos: [-1.2, 1.05, 11.6], look: [0, 2.0, -1.6], fov: 36 },
  side: { pos: [10.4, 3.4, 6.2], look: [0, 1.3, -0.6], fov: 34 },
};

const toVec = (a) => new THREE.Vector3(...a);

export function createDirector(camera, dom, positions) {
  const state = {
    auto: true,
    shotName: 'wide',
    shotTime: -99,
    lastSection: '',
    manualUntil: 0,
    yaw: 0.0,
    pitch: 0.16,
    radius: 13.6,
    dragging: false,
    pointer: { x: 0, y: 0 },
    target: new THREE.Vector3(0, 1.3, 0),
    pos: new THREE.Vector3(0, 4.2, 13.6),
    fov: 34,
    shake: 0,
  };

  function enterManual() {
    state.auto = false;
    state.holdShot = null;
    state.manualUntil = performance.now() + 9000;
    dom.style.cursor = 'grab';
  }

  dom.addEventListener('pointerdown', (e) => {
    state.dragging = true;
    state.pointer.x = e.clientX;
    state.pointer.y = e.clientY;
    enterManual();
    dom.setPointerCapture?.(e.pointerId);
    dom.style.cursor = 'grabbing';
  });
  dom.addEventListener('pointermove', (e) => {
    if (!state.dragging) return;
    const dx = e.clientX - state.pointer.x;
    const dy = e.clientY - state.pointer.y;
    state.pointer.x = e.clientX;
    state.pointer.y = e.clientY;
    state.yaw -= dx * 0.005;
    state.pitch = THREE.MathUtils.clamp(state.pitch + dy * 0.003, -0.05, 0.75);
    state.manualUntil = performance.now() + 9000;
  });
  const stopDrag = (e) => {
    if (!state.dragging) return;
    state.dragging = false;
    dom.style.cursor = 'grab';
    dom.releasePointerCapture?.(e.pointerId);
  };
  dom.addEventListener('pointerup', stopDrag);
  dom.addEventListener('pointercancel', stopDrag);
  dom.addEventListener('wheel', (e) => {
    e.preventDefault();
    enterManual();
    state.radius = THREE.MathUtils.clamp(state.radius + e.deltaY * 0.01, 8, 26);
    state.manualUntil = performance.now() + 9000;
  }, { passive: false });

  function sectionAt(score, time) {
    if (!score?.sections?.length) return null;
    for (const s of score.sections) if (time >= s.t && time < s.end) return s;
    return score.sections[score.sections.length - 1];
  }

  function chooseShot(score, time) {
    const section = sectionAt(score, time);
    if (!section) return 'wide';
    const rel = time - section.t;
    const label = section.label || 'VERSE';
    if (label === 'INTRO') {
      return rel > 4 && rel < 7 ? 'keys' : 'wide';
    }
    if (label === 'VERSE') {
      const idx = Math.floor(rel / 4) % 3;
      return ['keys', 'drums', 'bass'][idx];
    }
    if (label === 'CHORUS') {
      const idx = Math.floor(rel / 2) % 6;
      return ['wide', 'drums', 'guitar', 'lead', 'keys', 'overhead'][idx];
    }
    if (label === 'BREAK') return rel % 6 < 3 ? 'drums' : 'low';
    return rel < 5 ? 'wide' : 'side';
  }

  function computeAuto(score, time, dt) {
    const desired = chooseShot(score, time);
    const section = sectionAt(score, time);
    if (desired !== state.shotName) {
      state.shotName = desired;
      state.shotTime = time;
      // 段落切换时硬切，段落内部轻微过渡
      if (section && section.t > time - 0.3) {
        state.pos.set(...SHOTS[desired].pos);
        state.target.set(...SHOTS[desired].look);
        state.fov = SHOTS[desired].fov;
      }
    }
    let shot = SHOTS[state.shotName] || SHOTS.wide;
    let pos = toVec(shot.pos);
    const look = toVec(shot.look);
    if (state.shotName === 'wide') {
      const a = time * 0.075 + 0.35;
      pos = new THREE.Vector3(Math.sin(a) * 13.7, 3.55 + Math.sin(time * 0.23) * 0.3, Math.cos(a) * 13.7);
      look.set(0, 1.3 + Math.sin(time * 0.31) * 0.1, -0.2);
      shot = { ...shot, fov: 34 + Math.sin(time * 0.19) * 1.2 };
    } else if (state.shotName === 'overhead') {
      pos.x += Math.sin(time * 0.4) * 0.4;
      pos.z += Math.cos(time * 0.33) * 0.3;
    }
    // 手持感
    const hand = 0.012;
    pos.x += Math.sin(time * 1.7) * hand;
    pos.y += Math.cos(time * 1.3) * hand;
    const k = 1 - Math.exp(-dt * (state.shotName === 'wide' ? 1.5 : 4.2));
    state.pos.lerp(pos, k);
    state.target.lerp(look, 1 - Math.exp(-dt * 4));
    state.fov += (shot.fov - state.fov) * (1 - Math.exp(-dt * 3));
  }

  function update(score, time, dt, energy = 0) {
    const now = performance.now();
    if (state.holdShot && now > state.holdUntil) state.holdShot = null;
    if (!state.auto && !state.holdShot && now > state.manualUntil && !state.dragging) {
      state.auto = true;
      state.cameraInitialized = false;
    }
    if (state.holdShot) {
      const shot = SHOTS[state.holdShot] || SHOTS.wide;
      const pos = toVec(shot.pos);
      const look = toVec(shot.look);
      state.pos.lerp(pos, 1 - Math.exp(-dt * 5));
      state.target.lerp(look, 1 - Math.exp(-dt * 5));
      state.fov += (shot.fov - state.fov) * (1 - Math.exp(-dt * 4));
      state.shotName = state.holdShot;
    } else if (state.auto) {
      computeAuto(score, time, dt);
    } else {
      const target = positions?.drums?.clone() || new THREE.Vector3(0, 1.2, 0);
      target.y = 1.1;
      state.target.lerp(target, 1 - Math.exp(-dt * 2));
      const r = state.radius;
      const cp = Math.cos(state.pitch);
      const p = new THREE.Vector3(
        Math.sin(state.yaw) * cp * r,
        Math.sin(state.pitch) * r + 1.2,
        Math.cos(state.yaw) * cp * r,
      );
      state.pos.lerp(p, 1 - Math.exp(-dt * 6));
    }
    const s = state.shake * energy;
    const fit = camera.aspect < 1.5 ? 1 + (1.5 - camera.aspect) * 1.45 : 1;
    camera.position.copy(state.pos).sub(state.target).multiplyScalar(fit).add(state.target);
    camera.position.x += Math.sin(time * 43) * s * 0.05;
    camera.position.y += Math.cos(time * 37) * s * 0.04;
    camera.lookAt(state.target);
    camera.fov += (state.fov - camera.fov) * (1 - Math.exp(-dt * 4));
    camera.updateProjectionMatrix();
    state.shake *= Math.exp(-dt * 2.4);
    return state.shotName;
  }

  return {
    update,
    state,
    focus(id) {
      if (!SHOTS[id]) return;
      state.holdShot = id;
      state.holdUntil = performance.now() + 7000;
      state.auto = false;
      state.manualUntil = performance.now() + 7000;
      state.shotName = id;
    },
    setAuto(on) {
      state.auto = on;
      state.holdShot = null;
      if (on) state.cameraInitialized = false;
      state.manualUntil = performance.now() + (on ? 0 : 1e9);
    },
    kick() { state.shake = Math.min(1, state.shake + 0.35); },
    get shot() { return state.shotName; },
  };
}

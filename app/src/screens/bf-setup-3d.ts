/**
 * Live attitude model for the Setup tab: a generic 5-inch freestyle quad built from primitives in three.js
 * (no third-party model files), in the colours of the drone render: black carbon, teal props, purple nuts. three.js is loaded on demand, only here.
 *
 * Telemetry arrives every ~150 ms; drawing every sample as-is looks like a slideshow. Each frame the model
 * slerps from its current orientation towards the latest sample (critically damped, ~70 ms), so it moves
 * smoothly at the display's refresh rate. The render loop stops when the tab is hidden or unmounted.
 */
import type * as THREE_NS from 'three';

export interface AttitudeModel {
  /** Degrees, Betaflight convention: roll + = right side down, pitch + = nose up, heading 0-360. */
  set(roll: number, pitch: number, heading: number): void;
  destroy(): void;
}

// colours of the drone render on the Drone screen (assets/img/drone-top.webp): black carbon, teal props, purple nuts
const C = {
  ink: 0xdceff8,
  carbon: 0x2a2c30,
  metal: 0xb8bcc2,
  bell: 0x1d1f22,
  copper: 0xb5652b,
  teal: 0x2fc4c4,
  purple: 0x8a4fd8,
  xt60: 0xf2b52a,
  hot: 0xff4a2e,
  board: 0x101418,
  battery: 0x454950,
  strap: 0x111214,
};

/** Carbon twill as a small canvas texture, so the plates read as carbon fibre instead of flat grey. */
function carbonTexture(THREE: typeof THREE_NS): THREE_NS.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d')!;
  x.fillStyle = '#34373c';
  x.fillRect(0, 0, 64, 64);
  for (let i = 0; i < 8; i++)
    for (let j = 0; j < 8; j++) {
      const on = (i + j) % 2 === 0;
      const g = x.createLinearGradient(i * 8, j * 8, i * 8 + (on ? 8 : 0), j * 8 + (on ? 0 : 8));
      g.addColorStop(0, '#2b2e32');
      g.addColorStop(0.5, '#565a61');
      g.addColorStop(1, '#2b2e32');
      x.fillStyle = g;
      x.fillRect(i * 8 + 0.5, j * 8 + 0.5, 7, 7);
    }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(4, 4);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export async function mountAttitudeModel(host: HTMLElement): Promise<AttitudeModel | null> {
  // No WebGL (old GPU, disabled acceleration): the caller keeps the SVG drawing.
  const probe = document.createElement('canvas');
  if (!(probe.getContext('webgl2') || probe.getContext('webgl'))) return null;

  let THREE: typeof THREE_NS;
  try {
    THREE = await import('three');
  } catch {
    return null;
  }
  if (!host.isConnected) return null;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.3;
  const canvas = renderer.domElement;
  canvas.className = 'bf-su-3d';
  canvas.setAttribute('aria-hidden', 'true');
  host.prepend(canvas);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 2, 1, 4000);
  camera.position.set(-210, 300, -330);
  camera.lookAt(0, 6, 0);

  // light: soft sky/ground fill, a key light from the front-left, a cool rim from behind
  scene.add(new THREE.HemisphereLight(0xffffff, 0x0a0b0c, 1.25));
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(-200, 400, 250);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xdfe8ff, 1.6);
  rim.position.set(250, 150, -350);
  scene.add(rim);

  // ground: faint rings that do not move with the quad (a horizon reference for roll and pitch)
  const ground = new THREE.Group();
  for (const r of [140, 220, 300]) {
    const ringGeo = new THREE.RingGeometry(r - 0.6, r + 0.6, 96);
    const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: C.ink, transparent: true, opacity: r === 140 ? 0.16 : 0.08, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    ground.add(ring);
  }
  const cross = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-320, 0, 0), new THREE.Vector3(320, 0, 0), new THREE.Vector3(0, 0, -320), new THREE.Vector3(0, 0, 320)]);
  ground.add(new THREE.LineSegments(cross, new THREE.LineBasicMaterial({ color: C.ink, transparent: true, opacity: 0.07 })));
  ground.position.y = -70;
  scene.add(ground);

  const quad = buildQuad(THREE);
  scene.add(quad);

  const disposables: Array<{ dispose(): void }> = [];
  scene.traverse((o) => {
    const m = o as THREE_NS.Mesh;
    if (m.geometry) disposables.push(m.geometry);
    const mat = m.material as THREE_NS.Material | THREE_NS.Material[] | undefined;
    if (Array.isArray(mat)) disposables.push(...mat);
    else if (mat) disposables.push(mat);
  });

  // orientation: target from telemetry, current eased towards it every frame
  const target = new THREE.Quaternion();
  const euler = new THREE.Euler(0, 0, 0, 'YXZ');
  const rad = THREE.MathUtils.degToRad;
  let hasTarget = false;

  const resize = () => {
    const w = Math.max(1, host.clientWidth);
    const h = Math.max(1, Math.round(Math.min(380, Math.max(260, w * 0.34))));
    renderer.setSize(w, h, false);
    canvas.style.width = '100%';
    canvas.style.height = `${h}px`;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(host);
  resize();

  let raf = 0;
  let last = performance.now();
  let alive = true;
  const tick = (now: number) => {
    if (!alive) return;
    raf = requestAnimationFrame(tick);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (hasTarget) {
      // exponential smoothing: frame-rate independent, settles in ~0.2 s, never overshoots
      const k = 1 - Math.exp(-dt / 0.07);
      quad.quaternion.slerp(target, k);
    }
    renderer.render(scene, camera);
  };
  const onVis = () => {
    if (document.hidden) {
      cancelAnimationFrame(raf);
      raf = 0;
    } else if (!raf && alive) {
      last = performance.now();
      raf = requestAnimationFrame(tick);
    }
  };
  document.addEventListener('visibilitychange', onVis);
  raf = requestAnimationFrame(tick);

  return {
    set(roll, pitch, heading) {
      // same axes as the SVG model: roll about the nose axis, pitch about the lateral axis, heading about vertical
      euler.set(rad(-pitch), rad(-heading), rad(-roll), 'YXZ');
      target.setFromEuler(euler);
      if (!hasTarget) quad.quaternion.copy(target); // first sample: no swing in from level
      hasTarget = true;
    },
    destroy() {
      alive = false;
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', onVis);
      ro.disconnect();
      for (const d of disposables) d.dispose();
      renderer.dispose();
      canvas.remove();
    },
  };
}

/** A generic 5" freestyle quad (225 mm wheelbase, X frame, 3-blade 5" props). Nose = +Z. Units ~ mm. */
function buildQuad(THREE: typeof THREE_NS): THREE_NS.Group {
  const g = new THREE.Group();
  const carbon = new THREE.MeshStandardMaterial({ color: 0xffffff, map: carbonTexture(THREE), roughness: 0.42, metalness: 0.2 });
  const metal = new THREE.MeshStandardMaterial({ color: C.metal, roughness: 0.28, metalness: 0.9 });
  const bellMat = new THREE.MeshStandardMaterial({ color: C.bell, roughness: 0.35, metalness: 0.7 });
  const copper = new THREE.MeshStandardMaterial({ color: C.copper, roughness: 0.35, metalness: 0.8 });
  const purple = new THREE.MeshStandardMaterial({ color: C.purple, roughness: 0.3, metalness: 0.6 });
  const teal = new THREE.MeshStandardMaterial({ color: C.teal, roughness: 0.35, metalness: 0 });
  const hot = new THREE.MeshStandardMaterial({ color: C.hot, roughness: 0.4, emissive: C.hot, emissiveIntensity: 0.35 });
  const propMat = new THREE.MeshStandardMaterial({ color: C.teal, roughness: 0.2, metalness: 0, transparent: true, opacity: 0.72, side: THREE.DoubleSide, depthWrite: false });
  const edgeMat = new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.5 });
  const outlined = (mesh: THREE_NS.Mesh) => {
    mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry, 25), edgeMat));
    return mesh;
  };
  const box = (w: number, h: number, d: number, mat: THREE_NS.Material, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    return m;
  };
  const cyl = (rt: number, rb: number, h: number, mat: THREE_NS.Material, seg = 28) => new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);

  // body plates
  g.add(outlined(box(42, 3, 96, carbon, 0, 0, 0)));
  g.add(outlined(box(36, 2, 84, carbon, 0, 27, -2)));
  for (const [x, z] of [[-14, -36], [14, -36], [-14, 34], [14, 34]] as const) {
    const s = cyl(1.6, 1.6, 25, metal, 10);
    s.position.set(x, 14, z);
    g.add(s);
    const nut = cyl(3.2, 3.2, 2.4, purple, 6);
    nut.position.set(x, 29, z);
    g.add(nut);
  }
  // FC / ESC stack with a status LED
  g.add(outlined(box(30, 5, 30, new THREE.MeshStandardMaterial({ color: C.board, roughness: 0.6 }), 0, 6, -2)));
  g.add(outlined(box(30, 4, 30, new THREE.MeshStandardMaterial({ color: C.board, roughness: 0.6 }), 0, 14, -2)));
  const led = box(3, 1.5, 3, hot, 10, 16.8, 8);
  g.add(led);

  // arms in X (45 deg), motor at 112 mm from the centre
  const R = 112;
  const motors: Array<[number, number, number]> = [
    [1, 1, -1], // front right, CCW... spin direction only changes the prop pitch sign
    [-1, 1, 1],
    [1, -1, 1],
    [-1, -1, -1],
  ];
  for (const [sx, sz, dir] of motors) {
    const ang = Math.atan2(sz, sx);
    const arm = outlined(box(R - 10, 4.5, 14, carbon));
    arm.position.set(Math.cos(ang) * (R / 2 + 4), -2, Math.sin(ang) * (R / 2 + 4));
    arm.rotation.y = -ang;
    g.add(arm);

    const mx = Math.cos(ang) * R;
    const mz = Math.sin(ang) * R;
    const base = cyl(13, 13, 3, carbon);
    base.position.set(mx, 1.5, mz);
    g.add(base);
    const stator = cyl(12, 12, 8, metal);
    stator.position.set(mx, 7, mz);
    g.add(stator);
    const bell = outlined(cyl(14, 14, 11, bellMat, 32));
    bell.position.set(mx, 14, mz);
    g.add(bell);
    const windings = cyl(12.6, 12.6, 4, copper, 24); // copper shows between the bell spokes
    windings.position.set(mx, 9.5, mz);
    g.add(windings);
    const nutM = cyl(4, 4, 3, metal, 6);
    nutM.position.set(mx, 27.5, mz);
    g.add(nutM);
    const shaft = cyl(2.5, 2.5, 8, metal, 12);
    shaft.position.set(mx, 23, mz);
    g.add(shaft);

    // 3-blade 5" prop (radius 63 mm), slightly twisted blades
    const prop = new THREE.Group();
    const hub = cyl(5, 5, 6, propMat, 18);
    prop.add(hub);
    const blade = new THREE.Shape();
    blade.moveTo(0, -2);
    blade.bezierCurveTo(20, -9, 46, -8, 62, -3);
    blade.quadraticCurveTo(64, 0, 62, 3);
    blade.bezierCurveTo(44, 6, 20, 7, 0, 3);
    blade.lineTo(0, -2);
    const bladeGeo = new THREE.ShapeGeometry(blade, 10);
    bladeGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < 3; i++) {
      const b = new THREE.Mesh(bladeGeo, propMat);
      b.rotation.y = (i * Math.PI * 2) / 3;
      b.rotation.x = 0.12 * dir;
      prop.add(b);
    }
    prop.position.set(mx, 24, mz);
    prop.rotation.y = ang;
    g.add(prop);
  }

  // FPV camera up front with a red lens ring (marks the nose)
  const camBody = outlined(box(20, 19, 18, new THREE.MeshStandardMaterial({ color: 0x141517, roughness: 0.7 }), 0, 13, 44));
  camBody.rotation.x = -0.35;
  g.add(camBody);
  const lens = cyl(7, 7, 10, new THREE.MeshStandardMaterial({ color: 0x05080b, roughness: 0.15, metalness: 0.6 }), 24);
  lens.rotation.x = Math.PI / 2 - 0.35;
  lens.position.set(0, 16, 55);
  g.add(lens);
  const lensRing = cyl(7.6, 7.6, 2, hot, 24);
  lensRing.rotation.x = Math.PI / 2 - 0.35;
  lensRing.position.set(0, 17.5, 59);
  g.add(lensRing);

  // battery on top with a black strap, XT60 lead out the back
  g.add(outlined(box(34, 30, 74, new THREE.MeshStandardMaterial({ color: C.battery, roughness: 0.75 }), 0, 44, -6)));
  g.add(box(35.6, 31.6, 10, new THREE.MeshStandardMaterial({ color: C.strap, roughness: 0.9 }), 0, 44, -6));
  g.add(box(16, 8, 10, new THREE.MeshStandardMaterial({ color: C.xt60, roughness: 0.5 }), 0, 8, -66));

  // ELRS antennas at the back
  for (const sx of [-1, 1]) {
    // two receiver antennas with teal tips, like the render
    const ant = cyl(1.1, 1.1, 30, new THREE.MeshStandardMaterial({ color: 0x0b0d0f, roughness: 0.6 }), 8);
    ant.position.set(sx * 9, 8, -62);
    ant.rotation.x = -1.1;
    ant.rotation.z = sx * 0.35;
    g.add(ant);
    const tip = cyl(2, 2, 7, teal, 10);
    tip.position.set(sx * 13.5, 1, -75);
    tip.rotation.x = -1.1;
    tip.rotation.z = sx * 0.35;
    g.add(tip);
  }

  // centre the model around its body and lower it a touch (props sit above the arms)
  g.position.y = -10;
  const wrap = new THREE.Group();
  wrap.add(g);
  return wrap;
}

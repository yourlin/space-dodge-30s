/**
 * Space Dodge — three.js presentation of the simulation.
 *
 * Whitebox colour legend (see design.md):
 *   cyan    player ship
 *   tan     small meteor   (fast, aimed)
 *   brown   medium meteor  (aimed)
 *   slate   large meteor   (slow drifting wall)
 *   red     missile + launch warning (homing)
 *   blue    arena boundary
 *   green   shield pickup · light-blue slow pickup · amber overclock pickup
 *
 * The view only reads simulation state; it never changes rules.
 */

import * as THREE from 'three';
import { A3GameVfxPreset, createSeededRandom, createVfxDirector } from '@a3game/playable';
import { BuffType, HazardType, SpaceDodgePhase } from './rules.js';

export const COLOR_LEGEND = Object.freeze({
  player: 0x35e0ff,
  [HazardType.METEOR_SMALL]: 0xc9a27a,
  [HazardType.METEOR_MEDIUM]: 0x9a6b4f,
  [HazardType.METEOR_LARGE]: 0x6f7483,
  [HazardType.MISSILE]: 0xff3b3b,
  arena: 0x3d7bff,
  [BuffType.SHIELD]: 0x4dff9a,
  [BuffType.SLOW]: 0x6fb8ff,
  [BuffType.OVERCLOCK]: 0xffa51f,
});

/** Distinct silhouettes per buff so colour is not the only cue. */
function createPickup(buff) {
  const color = COLOR_LEGEND[buff];
  const group = new THREE.Group();
  group.name = `pickup_${buff}`;
  const material = new THREE.MeshStandardMaterial({
    color, emissive: color, emissiveIntensity: 0.9, roughness: 0.3, metalness: 0.2, flatShading: true,
  });
  const core = new THREE.Group();
  if (buff === BuffType.SHIELD) {
    core.add(new THREE.Mesh(new THREE.OctahedronGeometry(0.45), material));
  } else if (buff === BuffType.SLOW) {
    // Hourglass: two cones tip to tip.
    for (const side of [1, -1]) {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.42, 6), material);
      cone.position.y = side * 0.21;
      cone.rotation.x = side > 0 ? Math.PI : 0;
      core.add(cone);
    }
  } else {
    // Lightning bolt.
    const bolt = new THREE.Shape();
    bolt.moveTo(0.1, 0.5);
    bolt.lineTo(-0.25, -0.02);
    bolt.lineTo(-0.02, -0.02);
    bolt.lineTo(-0.12, -0.5);
    bolt.lineTo(0.25, 0.06);
    bolt.lineTo(0.02, 0.06);
    bolt.closePath();
    const mesh = new THREE.Mesh(new THREE.ExtrudeGeometry(bolt, { depth: 0.14, bevelEnabled: false }), material);
    mesh.position.z = -0.07;
    core.add(mesh);
  }
  core.position.y = 0.4;
  group.add(core);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.62, 0.74, 36),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = -0.4;
  group.add(ring);
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.08, 0.3, 2.4, 12, 1, true),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false }),
  );
  beam.position.y = 0.8;
  group.add(beam);
  group.userData = { core, ring, beam };
  group.scale.setScalar(1.5);
  return group;
}

function createShieldBubble() {
  const bubble = new THREE.Mesh(
    new THREE.IcosahedronGeometry(1.05, 2),
    new THREE.MeshBasicMaterial({
      color: COLOR_LEGEND[BuffType.SHIELD], transparent: true, opacity: 0.22, wireframe: true, depthWrite: false,
    }),
  );
  bubble.name = 'shield_bubble';
  bubble.visible = false;
  return bubble;
}

function createShip() {
  const ship = new THREE.Group();
  ship.name = 'player_ship';
  const hull = new THREE.MeshStandardMaterial({
    color: 0xe8f4ff, metalness: 0.55, roughness: 0.35, flatShading: true,
  });
  const accent = new THREE.MeshStandardMaterial({
    color: COLOR_LEGEND.player, emissive: COLOR_LEGEND.player, emissiveIntensity: 0.9,
    metalness: 0.3, roughness: 0.4, flatShading: true,
  });
  // Nose points to -Z (screen-up), the runtime forward axis.
  const body = new THREE.Mesh(new THREE.ConeGeometry(0.32, 1.5, 6), hull);
  body.rotation.x = -Math.PI / 2;
  ship.add(body);
  const wingShape = new THREE.Shape();
  wingShape.moveTo(0, -0.35);
  wingShape.lineTo(0.95, 0.45);
  wingShape.lineTo(0.95, 0.62);
  wingShape.lineTo(0, 0.5);
  const wingGeometry = new THREE.ExtrudeGeometry(wingShape, { depth: 0.07, bevelEnabled: false });
  for (const side of [1, -1]) {
    const wing = new THREE.Mesh(wingGeometry, accent);
    wing.rotation.x = Math.PI / 2;
    wing.scale.x = side;
    wing.position.y = 0.035;
    ship.add(wing);
  }
  const cockpit = new THREE.Mesh(
    new THREE.SphereGeometry(0.17, 10, 8),
    new THREE.MeshStandardMaterial({ color: 0x0b2540, metalness: 0.9, roughness: 0.1 }),
  );
  cockpit.scale.set(1, 0.7, 1.6);
  cockpit.position.set(0, 0.16, -0.15);
  ship.add(cockpit);
  const engine = new THREE.Mesh(
    new THREE.CylinderGeometry(0.16, 0.2, 0.18, 10),
    new THREE.MeshBasicMaterial({ color: 0x9fe8ff }),
  );
  engine.rotation.x = Math.PI / 2;
  engine.position.z = 0.78;
  ship.add(engine);
  ship.userData.engine = engine;
  // Soft glow disc so the ship reads against dark space.
  const halo = new THREE.Mesh(
    new THREE.RingGeometry(0.62, 0.72, 40),
    new THREE.MeshBasicMaterial({ color: COLOR_LEGEND.player, transparent: true, opacity: 0.5, side: THREE.DoubleSide }),
  );
  halo.rotation.x = -Math.PI / 2;
  halo.position.y = -0.3;
  ship.add(halo);
  ship.userData.halo = halo;
  // Visual is a little larger than the forgiving hit circle so the ship
  // stays readable among rocks.
  ship.scale.setScalar(1.35);
  return ship;
}

function createRockGeometry(seed) {
  const random = createSeededRandom(seed);
  const geometry = new THREE.IcosahedronGeometry(1, 1);
  const position = geometry.attributes.position;
  const vertex = new THREE.Vector3();
  // Displace shared vertices consistently so the rock stays watertight.
  const offsets = new Map();
  for (let i = 0; i < position.count; i += 1) {
    vertex.fromBufferAttribute(position, i);
    const key = `${vertex.x.toFixed(3)},${vertex.y.toFixed(3)},${vertex.z.toFixed(3)}`;
    if (!offsets.has(key)) offsets.set(key, 0.78 + random() * 0.4);
    vertex.multiplyScalar(offsets.get(key));
    position.setXYZ(i, vertex.x, vertex.y, vertex.z);
  }
  geometry.computeVertexNormals();
  return geometry;
}

function createMissile() {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({
    color: COLOR_LEGEND[HazardType.MISSILE], emissive: 0x7a0000, emissiveIntensity: 0.8,
    metalness: 0.4, roughness: 0.45, flatShading: true,
  });
  // Travel direction is local -Z, like the ship.
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.75, 8), material);
  body.rotation.x = Math.PI / 2;
  group.add(body);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.3, 8), material);
  nose.rotation.x = -Math.PI / 2;
  nose.position.z = -0.52;
  group.add(nose);
  const finMaterial = new THREE.MeshStandardMaterial({ color: 0x3a3a44, flatShading: true });
  for (let k = 0; k < 4; k += 1) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.36, 0.22), finMaterial);
    fin.position.z = 0.3;
    fin.rotation.z = (k * Math.PI) / 2;
    fin.translateY(0.14);
    group.add(fin);
  }
  const flame = new THREE.Mesh(
    new THREE.ConeGeometry(0.1, 0.45, 8),
    new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.9 }),
  );
  flame.rotation.x = -Math.PI / 2;
  flame.position.z = 0.6;
  group.add(flame);
  group.userData.flame = flame;
  group.scale.setScalar(1.6);
  return group;
}

function createWarningMarker() {
  const group = new THREE.Group();
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.55, 0.75, 32),
    new THREE.MeshBasicMaterial({ color: 0xff3b3b, transparent: true, opacity: 0.85, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  group.add(ring);
  const shape = new THREE.Shape();
  shape.moveTo(0, -0.45);
  shape.lineTo(0.38, 0.25);
  shape.lineTo(-0.38, 0.25);
  const arrow = new THREE.Mesh(
    new THREE.ShapeGeometry(shape),
    new THREE.MeshBasicMaterial({ color: 0xffd23b, transparent: true, opacity: 0.95, side: THREE.DoubleSide }),
  );
  arrow.rotation.x = -Math.PI / 2;
  arrow.position.y = 0.02;
  group.add(arrow);
  group.userData.ring = ring;
  group.userData.arrow = arrow;
  return group;
}

function createArenaFrame(arena) {
  const group = new THREE.Group();
  group.name = 'arena';
  const w = arena.halfWidth;
  const d = arena.halfDepth;
  const points = [
    new THREE.Vector3(-w, 0, -d), new THREE.Vector3(w, 0, -d),
    new THREE.Vector3(w, 0, d), new THREE.Vector3(-w, 0, d), new THREE.Vector3(-w, 0, -d),
  ];
  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineBasicMaterial({ color: COLOR_LEGEND.arena, transparent: true, opacity: 0.8 }),
  );
  line.position.y = -0.6;
  group.add(line);
  const grid = new THREE.GridHelper(2 * w, 16, COLOR_LEGEND.arena, 0x1b2f66);
  grid.scale.z = d / w;
  grid.position.y = -0.62;
  grid.material.transparent = true;
  grid.material.opacity = 0.16;
  group.add(grid);
  return group;
}

function createStarfield(seed) {
  const random = createSeededRandom(seed);
  const count = 2600;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const color = new THREE.Color();
  for (let i = 0; i < count; i += 1) {
    // Upper hemisphere shell around the arena, visible from the tilted camera.
    const u = random() * Math.PI * 2;
    const v = Math.acos(random() * 1.6 - 1);
    const r = 260 + random() * 120;
    positions[i * 3] = r * Math.sin(v) * Math.cos(u);
    positions[i * 3 + 1] = -Math.abs(r * Math.cos(v)) - 20;
    positions[i * 3 + 2] = r * Math.sin(v) * Math.sin(u);
    color.setHSL(0.55 + random() * 0.15, 0.4, 0.65 + random() * 0.35);
    colors.set([color.r, color.g, color.b], i * 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return new THREE.Points(
    geometry,
    new THREE.PointsMaterial({ size: 1.6, vertexColors: true, sizeAttenuation: true, depthWrite: false }),
  );
}

function createPlanet() {
  const group = new THREE.Group();
  const planet = new THREE.Mesh(
    new THREE.SphereGeometry(38, 48, 32),
    new THREE.MeshStandardMaterial({ color: 0x2c2160, roughness: 0.9, emissive: 0x0c0722, flatShading: true }),
  );
  group.add(planet);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(48, 66, 96),
    new THREE.MeshBasicMaterial({ color: 0x8f7bff, transparent: true, opacity: 0.1, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2.4;
  group.add(ring);
  group.scale.setScalar(0.7);
  group.position.set(-120, -150, -230);
  return group;
}

export class SpaceDodgeView {
  /**
   * @param {{host: object, simulation: import('./rules.js').SpaceDodgeSimulation}} options
   */
  constructor({ host, simulation }) {
    this.host = host;
    this.simulation = simulation;
    const { arena } = simulation.getRenderables();

    host.setEnvironment({ preset: 'none' });
    const sun = new THREE.DirectionalLight(0xfff1dc, 2.6);
    sun.position.set(-12, 30, 8);
    host.add(sun, 'environment');
    host.add(new THREE.HemisphereLight(0x6b8cff, 0x1a0f2e, 0.9), 'environment');
    host.add(createStarfield(7), 'environment');
    this.planet = createPlanet();
    host.add(this.planet, 'environment');
    host.add(createArenaFrame(arena), 'environment');

    this.ship = createShip();
    host.add(this.ship, 'entities');
    this.bank = 0;
    this.shield = createShieldBubble();
    host.add(this.shield, 'entities');
    /** @type {Map<number, THREE.Object3D>} */
    this.pickupViews = new Map();
    this.baseFov = host.camera.fov;

    this.rockGeometries = [11, 23, 37, 41, 59].map(createRockGeometry);
    this.rockMaterials = Object.fromEntries(
      [HazardType.METEOR_SMALL, HazardType.METEOR_MEDIUM, HazardType.METEOR_LARGE].map((type) => [
        type,
        new THREE.MeshStandardMaterial({ color: COLOR_LEGEND[type], roughness: 0.95, flatShading: true }),
      ]),
    );
    /** @type {Map<number, {object: THREE.Object3D, marker?: THREE.Object3D}>} */
    this.hazardViews = new Map();

    this.vfx = createVfxDirector({
      host,
      seed: 7,
      presets: {
        explosion: { ...A3GameVfxPreset.EXPLOSION, maxParticles: 400, lifetime: [0.45, 1.1], intensity: 1.4 },
        shock: { ...A3GameVfxPreset.SHOCK_RING },
        thrust: { ...A3GameVfxPreset.BOOST_FLAME, maxParticles: 240 },
        missile_smoke: { ...A3GameVfxPreset.SMOKE_PLUME, maxParticles: 300, lifetime: [0.4, 0.9], size: [0.12, 0.3], windResponse: 0 },
        spark: { ...A3GameVfxPreset.BLOCK_SPARK },
        pickup: { ...A3GameVfxPreset.PICKUP_SPARKLE },
        shield_break: {
          ...A3GameVfxPreset.BLOCK_SPARK, colorStart: ['#d9ffe9', '#4dff9a'], colorEnd: ['#0b6b3a'], maxParticles: 200,
        },
      },
    });

    // Camera: tilted top-down view that keeps the whole arena framed.
    // Portrait screens look along the arena's long axis instead, so a
    // phone held upright still gets a big play field.
    host.detachControls?.();
    this.arena = arena;
    this.portrait = false;
    this.cameraBase = new THREE.Vector3();
    this.cameraTarget = new THREE.Vector3();
    this.ship.rotation.order = 'YXZ';
    this.#fitCamera();
    this.stopResize = host.onResize?.(() => this.#fitCamera());
    this.shake = 0;
    this.time = 0;

    this.unsubscribe = simulation.onEvent((event) => this.#onEvent(event));
  }

  /**
   * Map a screen-space move vector (x right, y up) to the simulation's
   * input frame, which is fixed to the landscape arena.
   */
  screenToSim(x, y) {
    return this.portrait ? { moveX: -y, moveY: x } : { moveX: x, moveY: y };
  }

  /** Choose orientation and pull the camera back until the arena fits. */
  #fitCamera() {
    const camera = this.host.camera;
    const aspect = camera.aspect || 16 / 9;
    this.portrait = aspect < 0.9;
    const offset = this.portrait ? new THREE.Vector3(16.5, 27, 0) : new THREE.Vector3(0, 27, 16.5);
    const target = this.portrait ? new THREE.Vector3(1.2, 0, 0) : new THREE.Vector3(0, 0, 1.2);
    this.ship.rotation.y = this.portrait ? Math.PI / 2 : 0;
    const { halfWidth: w, halfDepth: d } = this.arena;
    const m = 1.2;
    const corners = [[-w - m, -d - m], [w + m, -d - m], [w + m, d + m], [-w - m, d + m]]
      .map(([x, z]) => new THREE.Vector3(x, 0, z));
    const probe = new THREE.Vector3();
    const fits = (k) => {
      camera.position.copy(offset).multiplyScalar(k);
      camera.lookAt(target);
      camera.updateMatrixWorld(true);
      // Leave room for the timer and goal bar across the top.
      return corners.every((c) => {
        probe.copy(c).project(camera);
        return Math.abs(probe.x) <= 0.97 && probe.y >= -0.97 && probe.y <= 0.8;
      });
    };
    let lo = 0.5;
    let hi = 4;
    for (let i = 0; i < 24; i += 1) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) hi = mid;
      else lo = mid;
    }
    // Never zoom in past the tuned desktop framing.
    fits(Math.max(1, hi));
    this.cameraBase.copy(camera.position);
    this.cameraTarget.copy(target);
  }

  #onEvent(event) {
    if (event.type === 'player_destroyed') {
      const at = [event.x, 0, event.z];
      this.vfx.play('explosion', { position: at, count: 160, scale: 1.5 });
      this.vfx.play('shock', { position: at, direction: [0, 1, 0], count: 4, scale: 2.5 });
      this.shake = 0.9;
      this.ship.visible = false;
    } else if (event.type === 'near_miss') {
      const { player } = this.simulation.getRenderables();
      this.vfx.play('spark', { position: [player.x, 0.1, player.z], count: 10 });
    } else if (event.type === 'run_started') {
      this.ship.visible = true;
      this.shake = 0;
      for (const id of [...this.hazardViews.keys()]) this.#removeHazardView(id);
      for (const id of [...this.pickupViews.keys()]) this.#removePickupView(id);
    } else if (event.type === 'pickup_collected') {
      const { player } = this.simulation.getRenderables();
      this.vfx.play('pickup', { position: [player.x, 0.3, player.z], count: 40, scale: 1.4 });
    } else if (event.type === 'shield_blocked') {
      this.vfx.play('shield_break', { position: [event.x, 0.2, event.z], count: 80, scale: 1.6 });
      this.vfx.play('shock', { position: [event.x, 0, event.z], direction: [0, 1, 0], count: 2, scale: 1.5 });
      this.shake = Math.max(this.shake, 0.45);
    }
  }

  /** Sync meshes to the simulation; call once per fixed tick. */
  update(dt, input = {}) {
    this.time += dt;
    const { player, hazards, pickups, buffs, invulnerableSeconds, timeScale } = this.simulation.getRenderables();
    const live = this.simulation.phase === SpaceDodgePhase.PLAYING;
    // Cosmetic motion (spin, blink) follows world time like the rules do.
    const worldDt = live ? dt * timeScale : 0;

    // Ship: position, banking from lateral input, engine pulse.
    this.ship.position.set(player.x, 0, player.z);
    // Bank and pitch against screen-relative velocity.
    const lateral = this.portrait ? -player.vz : player.vx;
    const forward = this.portrait ? -player.vx : -player.vz;
    const targetBank = -THREE.MathUtils.clamp(lateral / 11, -1, 1) * 0.55;
    this.bank += (targetBank - this.bank) * (1 - Math.exp(-10 * dt));
    this.ship.rotation.z = this.bank;
    this.ship.rotation.x = THREE.MathUtils.clamp(forward / 11, -1, 1) * 0.25;
    const pulse = 0.85 + 0.15 * Math.sin(this.time * 40);
    this.ship.userData.engine.scale.set(pulse, pulse, 1);
    this.ship.userData.halo.material.opacity = player.precision ? 0.9 : 0.5;
    if (this.ship.visible && player.alive) {
      const moving = Math.hypot(player.vx, player.vz) > 1 || Math.abs(input.moveY ?? 0) > 0;
      const back = this.portrait ? [1, 0, 0] : [0, 0, 1];
      this.vfx.play('thrust', {
        position: [player.x + back[0] * 0.85, 0, player.z + back[2] * 0.85],
        direction: back,
        count: moving ? 3 : 1,
      });
    }

    // Hazards: create, move, remove to mirror the simulation list.
    const seen = new Set();
    for (const h of hazards) {
      seen.add(h.id);
      let view = this.hazardViews.get(h.id);
      if (!view) view = this.#createHazardView(h);
      this.#updateHazardView(view, h, worldDt);
    }
    for (const id of [...this.hazardViews.keys()]) {
      if (!seen.has(id)) this.#removeHazardView(id);
    }

    // Pickups: bob, spin, and blink during the final 2 seconds.
    const seenPickups = new Set();
    for (const pickup of pickups) {
      seenPickups.add(pickup.id);
      let object = this.pickupViews.get(pickup.id);
      if (!object) {
        object = createPickup(pickup.buff);
        this.host.add(object, 'entities');
        this.pickupViews.set(pickup.id, object);
      }
      object.position.set(pickup.x, 0, pickup.z);
      const { core, ring, beam } = object.userData;
      core.rotation.y += dt * 2.4;
      core.position.y = 0.4 + Math.sin(this.time * 3 + pickup.id) * 0.12;
      const pulse = 1 + 0.18 * Math.sin(this.time * 6);
      ring.scale.setScalar(pulse);
      beam.material.opacity = 0.12 + 0.08 * pulse;
      object.visible = pickup.remaining > 2 || Math.sin(this.time * 18) > -0.2;
    }
    for (const id of [...this.pickupViews.keys()]) {
      if (!seenPickups.has(id)) this.#removePickupView(id);
    }

    // Shield bubble and post-hit grace flicker.
    const shielded = buffs[BuffType.SHIELD] > 0 && player.alive;
    this.shield.visible = shielded;
    if (shielded) {
      this.shield.position.set(player.x, 0.1, player.z);
      this.shield.rotation.y += dt * 1.2;
      const ending = buffs[BuffType.SHIELD] < 2;
      this.shield.material.opacity = ending && Math.sin(this.time * 20) < 0 ? 0.06 : 0.26;
    }
    if (player.alive && this.ship.visible !== false) {
      this.ship.traverse((child) => {
        if (child.isMesh) child.visible = invulnerableSeconds <= 0 || Math.sin(this.time * 40) > 0;
      });
    }

    // Time-flow feedback: wider view when overclocked, narrower when slowed.
    const targetFov = this.baseFov * (timeScale > 1.01 ? 1.1 : timeScale < 0.99 ? 0.94 : 1);
    const fov = this.host.camera.fov + (targetFov - this.host.camera.fov) * (1 - Math.exp(-6 * dt));
    if (Math.abs(fov - this.host.camera.fov) > 1e-3) {
      this.host.camera.fov = fov;
      this.host.camera.updateProjectionMatrix();
    }

    // Camera shake after the explosion, decaying with dt.
    this.shake = Math.max(0, this.shake - dt * 1.4);
    const s = this.shake * this.shake * 0.8;
    this.host.camera.position.set(
      this.cameraBase.x + (Math.random() - 0.5) * s,
      this.cameraBase.y + (Math.random() - 0.5) * s,
      this.cameraBase.z + (Math.random() - 0.5) * s,
    );
    this.host.camera.lookAt(this.cameraTarget);
    this.planet.rotation.y += dt * 0.02;
  }

  #createHazardView(h) {
    let object;
    let marker;
    if (h.type === HazardType.MISSILE) {
      object = createMissile();
      marker = createWarningMarker();
      marker.position.set(h.warningX, -0.5, h.warningZ);
      this.host.add(marker, 'effects');
    } else {
      object = new THREE.Mesh(
        this.rockGeometries[h.id % this.rockGeometries.length],
        this.rockMaterials[h.type],
      );
      object.scale.setScalar(h.radius);
      object.rotation.set(h.id * 1.3, h.id * 0.7, 0);
    }
    object.name = `${h.type}_${h.id}`;
    this.host.add(object, 'entities');
    const view = { object, marker };
    this.hazardViews.set(h.id, view);
    return view;
  }

  #updateHazardView(view, h, dt) {
    const { object, marker } = view;
    object.position.set(h.x, 0, h.z);
    if (h.type === HazardType.MISSILE) {
      // Model forward is -Z; simulation heading 0 moves toward +Z.
      object.rotation.y = h.heading + Math.PI;
      const flying = h.state === 'flying';
      object.visible = flying;
      object.userData.flame.visible = flying && h.fuel > 0;
      object.userData.flame.scale.y = 0.8 + 0.4 * Math.random();
      if (marker) {
        // A pending launch only matters while a run is live.
        marker.visible = !flying && this.simulation.phase !== SpaceDodgePhase.GAME_OVER;
        const blink = 0.5 + 0.5 * Math.sin(this.time * 22);
        marker.userData.ring.material.opacity = 0.35 + 0.6 * blink;
        marker.userData.ring.scale.setScalar(1 + 0.25 * blink);
        // Shape tip is local -Y; after the -90° X tilt, rotation.z = heading
        // makes it point along the simulation direction (sin h, cos h).
        marker.userData.arrow.rotation.z = h.heading;
      }
      if (flying && h.fuel > 0) {
        const back = [h.x - Math.sin(h.heading) * 0.7, 0, h.z - Math.cos(h.heading) * 0.7];
        this.vfx.play('missile_smoke', { position: back, count: 1 });
      }
    } else {
      object.rotation.x += h.spin * dt;
      object.rotation.y += h.spin * 0.6 * dt;
    }
  }

  #removeHazardView(id) {
    const view = this.hazardViews.get(id);
    if (!view) return;
    this.host.remove(view.object);
    if (view.marker) this.host.remove(view.marker);
    view.object.traverse?.((child) => {
      // Rock geometry/material are shared; missiles own theirs.
      if (child.isMesh && child.geometry && !this.rockGeometries.includes(child.geometry)) {
        child.geometry.dispose();
      }
    });
    this.hazardViews.delete(id);
  }

  #removePickupView(id) {
    const object = this.pickupViews.get(id);
    if (!object) return;
    this.host.remove(object);
    object.traverse((child) => {
      if (child.isMesh) {
        child.geometry.dispose();
        child.material.dispose();
      }
    });
    this.pickupViews.delete(id);
  }

  dispose() {
    this.unsubscribe();
    this.stopResize?.();
    for (const id of [...this.pickupViews.keys()]) this.#removePickupView(id);
    for (const id of [...this.hazardViews.keys()]) this.#removeHazardView(id);
    this.vfx.dispose();
  }
}

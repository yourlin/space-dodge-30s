/**
 * Space Dodge — survival rules and simulation.
 *
 * Pure gameplay: no THREE, no DOM. The arena is the XZ plane seen from
 * above; +X is screen-right and -Z is screen-up. Input `moveY = 1` means
 * "up the screen" (-Z) and `moveX = 1` means right (+X), matching the
 * framework's runtime input frame.
 */

import { RecordBook } from './records.js';

export const SpaceDodgePhase = Object.freeze({
  READY: 'ready',
  PLAYING: 'playing',
  PAUSED: 'paused',
  GAME_OVER: 'game_over',
});

export const HazardType = Object.freeze({
  METEOR_SMALL: 'meteor_small',
  METEOR_MEDIUM: 'meteor_medium',
  METEOR_LARGE: 'meteor_large',
  MISSILE: 'missile',
});

export const BuffType = Object.freeze({
  SHIELD: 'shield',
  SLOW: 'slow',
  OVERCLOCK: 'overclock',
});

export const SPACE_DODGE_CONFIG = Object.freeze({
  arena: { halfWidth: 16, halfDepth: 10 },
  player: {
    radius: 0.55,
    hitRadius: 0.42,
    speed: 11,
    precisionSpeed: 5,
    /** Velocity response rate (1/s); ~70 ms to reach target speed. */
    responsiveness: 14,
  },
  spawnMargin: 2,
  despawnMargin: 7,
  maxHazards: 110,
  nearMissDistance: 1.0,
  milestones: [10, 20, 30, 45, 60, 90, 120],
  /** Survival goal named in the title: "hold on for 30 seconds". */
  goalSeconds: 30,
  meteors: {
    [HazardType.METEOR_SMALL]: { radius: [0.32, 0.5], speed: [8.5, 12], aimJitter: 1.4 },
    [HazardType.METEOR_MEDIUM]: { radius: [0.8, 1.1], speed: [5, 7.5], aimJitter: 2.2 },
    [HazardType.METEOR_LARGE]: { radius: [1.6, 2.2], speed: [2.6, 4], aimJitter: 0 },
  },
  missile: {
    radius: 0.36,
    warningSeconds: 0.9,
    launchSpeed: 4.5,
    maxSpeed: 10.5,
    acceleration: 4,
    turnRate: 1.15,
    fuelSeconds: 2.8,
    maxActive: 3,
  },
  shower: { firstAt: 15, interval: [6, 9], count: [4, 6], spread: 0.55, speed: 8.5 },
  pickups: {
    firstAt: 5,
    /** Game-time seconds between spawns. */
    interval: [7, 10],
    /** Real seconds a pickup stays on the field before vanishing. */
    lifetime: 7,
    radius: 0.6,
    maxActive: 2,
    /** Keep spawns away from the player and the arena edge. */
    minPlayerDistance: 5,
    edgeInset: 2.5,
    weights: { [BuffType.SHIELD]: 0.35, [BuffType.SLOW]: 0.3, [BuffType.OVERCLOCK]: 0.35 },
  },
  /**
   * Buff durations are real seconds. `timeScale` multiplies how fast the
   * world (hazards, spawns and the survival clock) runs; the ship always
   * moves in real time.
   */
  buffs: {
    [BuffType.SHIELD]: { duration: 8 },
    [BuffType.SLOW]: { duration: 4, timeScale: 0.5 },
    [BuffType.OVERCLOCK]: { duration: 5, timeScale: 1.6 },
  },
  /** Grace period after the shield absorbs a hit (real seconds). */
  shieldGraceSeconds: 1,
});

/**
 * Spawn rates (per second) as a function of survival time. Each stream
 * starts at `from`, grows linearly by `growth` per second, and caps.
 */
const SPAWN_STREAMS = Object.freeze([
  { type: HazardType.METEOR_SMALL, from: 0.4, base: 1.2, growth: 0.085, cap: 4.2 },
  { type: HazardType.METEOR_MEDIUM, from: 3, base: 0.3, growth: 0.03, cap: 1.4 },
  { type: HazardType.METEOR_LARGE, from: 6, base: 0.14, growth: 0.01, cap: 0.5 },
  { type: HazardType.MISSILE, from: 8, base: 0.16, growth: 0.012, cap: 0.6 },
]);

/** Deterministic PRNG (mulberry32). */
export function createRng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (min, max) => min + (max - min) * next(),
    pick: (items) => items[Math.floor(next() * items.length)],
  };
}

export function spawnRate(stream, elapsedSeconds) {
  if (elapsedSeconds < stream.from) return 0;
  return Math.min(stream.cap, stream.base + stream.growth * (elapsedSeconds - stream.from));
}

/** 1-based difficulty level shown to the player, one level per 10 s. */
export function difficultyLevel(elapsedSeconds) {
  return 1 + Math.floor(Math.max(0, elapsedSeconds) / 10);
}

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const round = (value, digits = 3) => Number(value.toFixed(digits));

export class SpaceDodgeSimulation {
  /**
   * @param {{seed?: number, config?: object, records?: RecordBook,
   *          randomSeed?: () => number}} [options]
   */
  constructor(options = {}) {
    this.config = options.config ?? SPACE_DODGE_CONFIG;
    this.records = options.records ?? new RecordBook();
    this.baseSeed = Number(options.seed ?? 20260927) >>> 0;
    this.randomSeed = options.randomSeed ?? null;
    this.runIndex = 0;
    /** @type {Set<(event: object) => void>} */
    this.listeners = new Set();
    this.phase = SpaceDodgePhase.READY;
    this.lastRun = null;
    this.#resetRun(this.baseSeed);
  }

  // ------------------------------------------------------------ commands

  /** Begin a run from READY or GAME_OVER. */
  start() {
    if (this.phase === SpaceDodgePhase.PLAYING || this.phase === SpaceDodgePhase.PAUSED) {
      return false;
    }
    this.runIndex += 1;
    const seed = this.randomSeed ? this.randomSeed() >>> 0 : (this.baseSeed + this.runIndex) >>> 0;
    this.#resetRun(seed);
    this.phase = SpaceDodgePhase.PLAYING;
    this.#emit({ type: 'run_started', runIndex: this.runIndex, seed });
    return true;
  }

  /** Abandon any run and immediately start a new one. */
  restart() {
    this.phase = SpaceDodgePhase.READY;
    return this.start();
  }

  togglePause() {
    if (this.phase === SpaceDodgePhase.PLAYING) {
      this.phase = SpaceDodgePhase.PAUSED;
      this.#emit({ type: 'paused', elapsedSeconds: round(this.elapsedSeconds) });
      return true;
    }
    if (this.phase === SpaceDodgePhase.PAUSED) {
      this.phase = SpaceDodgePhase.PLAYING;
      this.#emit({ type: 'resumed', elapsedSeconds: round(this.elapsedSeconds) });
      return true;
    }
    return false;
  }

  clearRecords() {
    this.records.clear();
    this.#emit({ type: 'records_cleared' });
    return true;
  }

  /** @param {(event: object) => void} listener @returns {() => void} */
  onEvent(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // ------------------------------------------------------------ simulation

  /**
   * Advance one fixed step.
   *
   * @param {number} dt seconds
   * @param {{moveX?: number, moveY?: number, run?: boolean}} [input]
   *        `run` is the precision (slow) modifier.
   */
  step(dt, input = {}) {
    if (!(dt > 0) || !Number.isFinite(dt)) return;
    if (this.phase !== SpaceDodgePhase.PLAYING) return;
    this.#tickBuffs(dt);
    // World time: hazards, spawning and the survival clock follow buffs.
    const worldDt = dt * this.timeScale();
    this.elapsedSeconds += worldDt;
    this.#movePlayer(dt, input);
    this.#spawn(worldDt);
    this.#spawnPickups();
    this.#moveHazards(worldDt);
    this.#tickPickups(dt);
    this.#collectPickups();
    this.#resolveContacts();
    if (this.phase === SpaceDodgePhase.PLAYING) this.#checkMilestones();
  }

  #resetRun(seed) {
    this.seed = seed;
    this.rng = createRng(seed);
    this.elapsedSeconds = 0;
    this.player = { x: 0, z: 0, vx: 0, vz: 0, alive: true, precision: false };
    this.hazards = [];
    this.nextHazardId = 1;
    this.spawnAccumulators = new Map(SPAWN_STREAMS.map((s) => [s.type, this.rng.next() * 0.5]));
    this.nextShowerAt = this.config.shower.firstAt;
    this.nearMisses = 0;
    this.dodged = 0;
    this.spawnedByType = Object.fromEntries(Object.values(HazardType).map((t) => [t, 0]));
    this.milestonesReached = [];
    this.lastLevel = 1;
    // Separate stream so pickups do not reshuffle hazard patterns.
    this.pickupRng = createRng((seed ^ 0x9e3779b9) >>> 0);
    this.pickups = [];
    this.nextPickupId = 1;
    this.nextPickupAt = this.config.pickups.firstAt;
    this.buffs = Object.fromEntries(Object.values(BuffType).map((t) => [t, 0]));
    this.invulnerableSeconds = 0;
    this.buffsCollected = 0;
    this.shieldBlocks = 0;
  }

  #movePlayer(dt, input) {
    const { player: cfg, arena } = this.config;
    let mx = clamp(Number(input.moveX ?? 0), -1, 1);
    let mz = -clamp(Number(input.moveY ?? 0), -1, 1);
    const length = Math.hypot(mx, mz);
    if (length > 1) {
      mx /= length;
      mz /= length;
    }
    const precision = Boolean(input.run);
    const speed = precision ? cfg.precisionSpeed : cfg.speed;
    const p = this.player;
    p.precision = precision;
    // Critically fast approach to target velocity: responsive but not
    // teleporting, and frame-rate independent.
    const blend = 1 - Math.exp(-cfg.responsiveness * dt);
    p.vx += (mx * speed - p.vx) * blend;
    p.vz += (mz * speed - p.vz) * blend;
    p.x += p.vx * dt;
    p.z += p.vz * dt;
    const limitX = arena.halfWidth - cfg.radius;
    const limitZ = arena.halfDepth - cfg.radius;
    if (Math.abs(p.x) > limitX) {
      p.x = Math.sign(p.x) * limitX;
      p.vx = 0;
    }
    if (Math.abs(p.z) > limitZ) {
      p.z = Math.sign(p.z) * limitZ;
      p.vz = 0;
    }
  }

  #spawn(dt) {
    const t = this.elapsedSeconds;
    for (const stream of SPAWN_STREAMS) {
      const rate = spawnRate(stream, t);
      if (rate <= 0) continue;
      let acc = this.spawnAccumulators.get(stream.type) + rate * dt;
      while (acc >= 1) {
        acc -= 1;
        this.#spawnStream(stream.type);
      }
      this.spawnAccumulators.set(stream.type, acc);
    }
    if (t >= this.nextShowerAt) {
      this.#spawnShower();
      this.nextShowerAt = t + this.rng.range(...this.config.shower.interval);
    }
  }

  #spawnStream(type) {
    if (type === HazardType.MISSILE) {
      const active = this.hazards.filter((h) => h.type === HazardType.MISSILE).length;
      if (active >= this.config.missile.maxActive) return;
      this.#spawnMissile();
    } else {
      this.#spawnMeteor(type);
    }
  }

  /** A point just outside the arena rectangle, weighted by edge length. */
  #edgePoint(margin) {
    const { halfWidth: w, halfDepth: d } = this.config.arena;
    const perimeter = 4 * (w + d);
    let s = this.rng.next() * perimeter;
    const ex = w + margin;
    const ez = d + margin;
    if (s < 2 * w) return { x: -w + s, z: -ez };
    s -= 2 * w;
    if (s < 2 * d) return { x: ex, z: -d + s };
    s -= 2 * d;
    if (s < 2 * w) return { x: w - s, z: ez };
    s -= 2 * w;
    return { x: -ex, z: d - s };
  }

  #spawnMeteor(type, override = {}) {
    if (this.hazards.length >= this.config.maxHazards) return null;
    const spec = this.config.meteors[type];
    const radius = override.radius ?? this.rng.range(...spec.radius);
    const origin = override.origin ?? this.#edgePoint(this.config.spawnMargin + radius);
    let target;
    if (type === HazardType.METEOR_LARGE) {
      // Large rocks drift across the field as moving walls, not snipers.
      const { halfWidth: w, halfDepth: d } = this.config.arena;
      target = { x: this.rng.range(-w * 0.6, w * 0.6), z: this.rng.range(-d * 0.6, d * 0.6) };
    } else {
      target = {
        x: this.player.x + this.rng.range(-spec.aimJitter, spec.aimJitter),
        z: this.player.z + this.rng.range(-spec.aimJitter, spec.aimJitter),
      };
    }
    let heading = override.heading ?? Math.atan2(target.x - origin.x, target.z - origin.z);
    const speed = override.speed ?? this.rng.range(...spec.speed);
    const hazard = {
      id: this.nextHazardId++,
      type,
      x: origin.x,
      z: origin.z,
      radius,
      speed,
      heading,
      spin: this.rng.range(-2.5, 2.5) / Math.max(0.6, radius),
      age: 0,
      state: 'flying',
      entered: false,
      closest: Infinity,
      nearMissCounted: false,
    };
    this.#pushHazard(hazard);
    return hazard;
  }

  #spawnMissile() {
    const cfg = this.config.missile;
    const { halfWidth: w, halfDepth: d } = this.config.arena;
    const edge = this.#edgePoint(-0.6);
    const origin = { x: clamp(edge.x, -w + 0.6, w - 0.6), z: clamp(edge.z, -d + 0.6, d - 0.6) };
    // Launch from outside the arena behind the warning marker.
    const outward = Math.atan2(origin.x, origin.z);
    const hazard = {
      id: this.nextHazardId++,
      type: HazardType.MISSILE,
      x: origin.x + Math.sin(outward) * this.config.spawnMargin,
      z: origin.z + Math.cos(outward) * this.config.spawnMargin,
      warningX: origin.x,
      warningZ: origin.z,
      radius: cfg.radius,
      speed: 0,
      heading: Math.atan2(this.player.x - origin.x, this.player.z - origin.z),
      spin: 0,
      age: 0,
      fuel: cfg.fuelSeconds,
      state: 'warning',
      entered: false,
      closest: Infinity,
      nearMissCounted: false,
    };
    this.#pushHazard(hazard);
    this.#emit({ type: 'missile_warning', hazardId: hazard.id, x: round(origin.x), z: round(origin.z) });
  }

  #spawnShower() {
    const spec = this.config.shower;
    const origin = this.#edgePoint(this.config.spawnMargin + 0.5);
    const aim = Math.atan2(this.player.x - origin.x, this.player.z - origin.z);
    const count = Math.round(this.rng.range(...spec.count));
    for (let i = 0; i < count; i += 1) {
      const offset = count === 1 ? 0 : (i / (count - 1) - 0.5) * 2 * spec.spread;
      this.#spawnMeteor(HazardType.METEOR_SMALL, {
        origin: { ...origin },
        heading: aim + offset,
        speed: spec.speed * this.rng.range(0.92, 1.08),
      });
    }
    this.#emit({ type: 'meteor_shower', count, x: round(origin.x), z: round(origin.z) });
  }

  #pushHazard(hazard) {
    this.hazards.push(hazard);
    this.spawnedByType[hazard.type] += 1;
    this.#emit({ type: 'hazard_spawned', hazardId: hazard.id, hazardType: hazard.type });
  }

  #moveHazards(dt) {
    const cfg = this.config.missile;
    const { halfWidth: w, halfDepth: d } = this.config.arena;
    const out = this.config.despawnMargin;
    const survivors = [];
    for (const h of this.hazards) {
      h.age += dt;
      if (h.type === HazardType.MISSILE) {
        if (h.state === 'warning') {
          if (h.age >= cfg.warningSeconds) {
            h.state = 'flying';
            h.speed = cfg.launchSpeed;
            h.heading = Math.atan2(this.player.x - h.x, this.player.z - h.z);
            this.#emit({ type: 'missile_launched', hazardId: h.id });
          } else {
            survivors.push(h);
            continue;
          }
        } else {
          h.speed = Math.min(cfg.maxSpeed, h.speed + cfg.acceleration * dt);
          if (h.fuel > 0) {
            h.fuel = Math.max(0, h.fuel - dt);
            const desired = Math.atan2(this.player.x - h.x, this.player.z - h.z);
            let delta = desired - h.heading;
            delta = Math.atan2(Math.sin(delta), Math.cos(delta));
            const turn = cfg.turnRate * dt;
            h.heading += clamp(delta, -turn, turn);
            if (h.fuel === 0) this.#emit({ type: 'missile_burnout', hazardId: h.id });
          }
        }
      }
      h.x += Math.sin(h.heading) * h.speed * dt;
      h.z += Math.cos(h.heading) * h.speed * dt;
      const inside = Math.abs(h.x) < w + h.radius && Math.abs(h.z) < d + h.radius;
      if (inside) h.entered = true;
      const gone =
        (h.entered && !inside && (Math.abs(h.x) > w + out || Math.abs(h.z) > d + out)) ||
        h.age > 25;
      if (gone) {
        this.dodged += 1;
        this.#emit({ type: 'hazard_dodged', hazardId: h.id, hazardType: h.type });
        continue;
      }
      survivors.push(h);
    }
    this.hazards = survivors;
  }

  #resolveContacts() {
    const p = this.player;
    const hitR = this.config.player.hitRadius;
    for (const h of this.hazards) {
      if (h.state !== 'flying') continue;
      const distance = Math.hypot(h.x - p.x, h.z - p.z) - h.radius;
      if (distance < hitR) {
        if (this.invulnerableSeconds > 0) continue;
        if (this.buffs[BuffType.SHIELD] > 0) {
          this.#absorbHit(h);
          continue;
        }
        this.#destroyPlayer(h);
        return;
      }
      if (distance < h.closest) {
        h.closest = distance;
      } else if (
        !h.nearMissCounted &&
        h.closest < hitR + this.config.nearMissDistance
      ) {
        h.nearMissCounted = true;
        this.nearMisses += 1;
        this.#emit({ type: 'near_miss', hazardId: h.id, hazardType: h.type, total: this.nearMisses });
      }
    }
    this.hazards = this.hazards.filter((h) => !h.destroyed);
  }

  /** The shield breaks on the hazard, destroying both, then grants grace. */
  #absorbHit(hazard) {
    hazard.destroyed = true;
    this.buffs[BuffType.SHIELD] = 0;
    this.invulnerableSeconds = this.config.shieldGraceSeconds;
    this.shieldBlocks += 1;
    this.#emit({
      type: 'shield_blocked',
      hazardId: hazard.id,
      hazardType: hazard.type,
      x: round(hazard.x),
      z: round(hazard.z),
    });
    this.#emit({ type: 'buff_ended', buff: BuffType.SHIELD, reason: 'absorbed' });
  }

  // ------------------------------------------------------------ pickups & buffs

  /** Current world-time multiplier from active buffs (they stack). */
  timeScale() {
    let scale = 1;
    for (const type of [BuffType.SLOW, BuffType.OVERCLOCK]) {
      if (this.buffs[type] > 0) scale *= this.config.buffs[type].timeScale;
    }
    return scale;
  }

  #tickBuffs(dt) {
    this.invulnerableSeconds = Math.max(0, this.invulnerableSeconds - dt);
    for (const type of Object.values(BuffType)) {
      if (this.buffs[type] <= 0) continue;
      this.buffs[type] = Math.max(0, this.buffs[type] - dt);
      if (this.buffs[type] === 0) this.#emit({ type: 'buff_ended', buff: type, reason: 'expired' });
    }
  }

  /** Pickups follow the game clock, so overclock brings them sooner. */
  #spawnPickups() {
    const cfg = this.config.pickups;
    if (this.elapsedSeconds < this.nextPickupAt) return;
    this.nextPickupAt = this.elapsedSeconds + this.pickupRng.range(...cfg.interval);
    if (this.pickups.length >= cfg.maxActive) return;
    const { halfWidth: w, halfDepth: d } = this.config.arena;
    let spot = null;
    for (let attempt = 0; attempt < 12 && !spot; attempt += 1) {
      const x = this.pickupRng.range(-w + cfg.edgeInset, w - cfg.edgeInset);
      const z = this.pickupRng.range(-d + cfg.edgeInset, d - cfg.edgeInset);
      if (Math.hypot(x - this.player.x, z - this.player.z) >= cfg.minPlayerDistance) spot = { x, z };
    }
    if (!spot) return;
    const roll = this.pickupRng.next();
    let acc = 0;
    let buff = BuffType.SHIELD;
    const total = Object.values(cfg.weights).reduce((a, b) => a + b, 0);
    for (const [type, weight] of Object.entries(cfg.weights)) {
      acc += weight / total;
      if (roll <= acc) {
        buff = type;
        break;
      }
    }
    const pickup = { id: this.nextPickupId++, buff, x: spot.x, z: spot.z, radius: cfg.radius, remaining: cfg.lifetime };
    this.pickups.push(pickup);
    this.#emit({ type: 'pickup_spawned', pickupId: pickup.id, buff, x: round(spot.x), z: round(spot.z) });
  }

  #tickPickups(dt) {
    this.pickups = this.pickups.filter((pickup) => {
      pickup.remaining -= dt;
      if (pickup.remaining > 0) return true;
      this.#emit({ type: 'pickup_expired', pickupId: pickup.id, buff: pickup.buff });
      return false;
    });
  }

  #collectPickups() {
    const p = this.player;
    const reach = this.config.player.radius;
    this.pickups = this.pickups.filter((pickup) => {
      if (Math.hypot(pickup.x - p.x, pickup.z - p.z) > pickup.radius + reach) return true;
      this.#applyBuff(pickup.buff);
      this.#emit({ type: 'pickup_collected', pickupId: pickup.id, buff: pickup.buff, timeScale: this.timeScale() });
      return false;
    });
  }

  /** Collecting a buff that is already active refreshes its duration. */
  #applyBuff(buff) {
    this.buffs[buff] = this.config.buffs[buff].duration;
    this.buffsCollected += 1;
  }

  #destroyPlayer(hazard) {
    this.player.alive = false;
    this.player.vx = 0;
    this.player.vz = 0;
    this.phase = SpaceDodgePhase.GAME_OVER;
    const seconds = round(this.elapsedSeconds, 2);
    const previousBest = this.records.bestSeconds();
    const entry = this.records.add({ seconds, nearMisses: this.nearMisses, dodged: this.dodged });
    const newBest = seconds > previousBest;
    this.lastRun = {
      seconds,
      nearMisses: this.nearMisses,
      dodged: this.dodged,
      killedBy: hazard.type,
      buffsCollected: this.buffsCollected,
      shieldBlocks: this.shieldBlocks,
      rank: entry.rank,
      newBest,
      goalReached: seconds >= this.config.goalSeconds,
    };
    this.#emit({
      type: 'player_destroyed',
      hazardId: hazard.id,
      hazardType: hazard.type,
      x: round(this.player.x),
      z: round(this.player.z),
      ...this.lastRun,
    });
    if (newBest) this.#emit({ type: 'new_record', seconds, previousBest });
  }

  #checkMilestones() {
    const t = this.elapsedSeconds;
    for (const m of this.config.milestones) {
      if (t >= m && !this.milestonesReached.includes(m)) {
        this.milestonesReached.push(m);
        this.#emit({ type: 'milestone', seconds: m, goal: m === this.config.goalSeconds });
      }
    }
    const level = difficultyLevel(t);
    if (level !== this.lastLevel) {
      this.lastLevel = level;
      this.#emit({ type: 'difficulty_up', level });
    }
  }

  #emit(event) {
    const payload = { ...event, time: round(this.elapsedSeconds) };
    for (const listener of this.listeners) listener(payload);
  }

  // ------------------------------------------------------------ queries

  /** Serializable state for UI, tests and playtest recording. */
  getState() {
    const counts = Object.fromEntries(Object.values(HazardType).map((t) => [t, 0]));
    let warnings = 0;
    for (const h of this.hazards) {
      counts[h.type] += 1;
      if (h.state === 'warning') warnings += 1;
    }
    return {
      phase: this.phase,
      elapsedSeconds: round(this.elapsedSeconds, 2),
      goalSeconds: this.config.goalSeconds,
      difficultyLevel: difficultyLevel(this.elapsedSeconds),
      player: {
        x: round(this.player.x),
        z: round(this.player.z),
        speed: round(Math.hypot(this.player.vx, this.player.vz)),
        alive: this.player.alive,
        precision: this.player.precision,
      },
      hazardCount: this.hazards.length,
      hazardCounts: counts,
      missileWarnings: warnings,
      nearMisses: this.nearMisses,
      dodged: this.dodged,
      milestonesReached: [...this.milestonesReached],
      bestSeconds: this.records.bestSeconds(),
      records: this.records.list(),
      totalRuns: this.records.totalRuns(),
      lastRun: this.lastRun ? { ...this.lastRun } : null,
      runIndex: this.runIndex,
      seed: this.seed,
      timeScale: this.timeScale(),
      buffs: Object.fromEntries(Object.entries(this.buffs).map(([k, v]) => [k, round(v, 2)])),
      invulnerable: this.invulnerableSeconds > 0,
      pickups: this.pickups.map((p) => ({ id: p.id, buff: p.buff, x: round(p.x), z: round(p.z), remaining: round(p.remaining, 2) })),
      buffsCollected: this.buffsCollected,
      shieldBlocks: this.shieldBlocks,
    };
  }

  /** Read-only view data for renderers; not part of the serialized state. */
  getRenderables() {
    return {
      player: this.player,
      hazards: this.hazards,
      pickups: this.pickups,
      buffs: this.buffs,
      invulnerableSeconds: this.invulnerableSeconds,
      timeScale: this.timeScale(),
      arena: this.config.arena,
    };
  }
}

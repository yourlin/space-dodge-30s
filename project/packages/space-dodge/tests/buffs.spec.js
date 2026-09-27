import { describe, expect, it } from 'vitest';
import { BuffType, HazardType, SPACE_DODGE_CONFIG, SpaceDodgePhase, SpaceDodgeSimulation } from '../src/rules.js';

const DT = 1 / 60;
const ghost = () => ({ ...SPACE_DODGE_CONFIG, player: { ...SPACE_DODGE_CONFIG.player, hitRadius: -1000 } });

function rock(overrides = {}) {
  return {
    id: 900, type: HazardType.METEOR_SMALL, x: 0, z: -3, radius: 0.4, speed: 6, heading: 0,
    spin: 0, age: 0, state: 'flying', entered: true, closest: Infinity, nearMissCounted: false,
    ...overrides,
  };
}

/** Started run with no random hazards, so tests control the field. */
function quietRun(seed = 1) {
  const sim = new SpaceDodgeSimulation({ seed });
  sim.start();
  sim.spawnAccumulators = new Map([...sim.spawnAccumulators.keys()].map((k) => [k, -1e9]));
  sim.nextShowerAt = Infinity;
  sim.nextPickupAt = Infinity;
  return sim;
}

function collect(sim, buff) {
  sim.pickups.push({ id: 77, buff, x: sim.player.x, z: sim.player.z, radius: 0.6, remaining: 5 });
  sim.step(DT);
}

describe('pickups', () => {
  it('spawn after the first delay, away from the player, and expire', () => {
    const sim = new SpaceDodgeSimulation({ seed: 21, config: ghost() });
    const events = [];
    sim.onEvent((e) => events.push(e));
    sim.start();
    for (let i = 0; i < 60 * 4.9; i += 1) sim.step(DT);
    expect(sim.pickups).toHaveLength(0);
    for (let i = 0; i < 60 * 0.2; i += 1) sim.step(DT);
    const spawned = events.find((e) => e.type === 'pickup_spawned');
    expect(spawned).toBeTruthy();
    expect(Object.values(BuffType)).toContain(spawned.buff);
    expect(Math.hypot(spawned.x, spawned.z)).toBeGreaterThanOrEqual(SPACE_DODGE_CONFIG.pickups.minPlayerDistance - 0.5);
    for (let i = 0; i < 60 * (SPACE_DODGE_CONFIG.pickups.lifetime + 0.2); i += 1) sim.step(DT);
    expect(events.some((e) => e.type === 'pickup_expired' && e.pickupId === spawned.pickupId)).toBe(true);
  });

  it('never exceeds the active cap', () => {
    const sim = new SpaceDodgeSimulation({ seed: 22, config: ghost() });
    sim.start();
    let peak = 0;
    for (let i = 0; i < 60 * 90; i += 1) {
      sim.step(DT);
      peak = Math.max(peak, sim.pickups.length);
    }
    expect(peak).toBeGreaterThan(0);
    expect(peak).toBeLessThanOrEqual(SPACE_DODGE_CONFIG.pickups.maxActive);
  });
});

describe('shield', () => {
  it('absorbs exactly one hit, destroys the hazard and grants grace', () => {
    const sim = quietRun(23);
    const events = [];
    sim.onEvent((e) => events.push(e.type));
    collect(sim, BuffType.SHIELD);
    expect(sim.getState().buffs.shield).toBeGreaterThan(7);
    sim.hazards.push(rock({ id: 901, z: -0.3, speed: 0 }));
    sim.step(DT);
    expect(sim.phase).toBe(SpaceDodgePhase.PLAYING);
    expect(sim.hazards.find((h) => h.id === 901)).toBeUndefined();
    expect(events).toContain('shield_blocked');
    expect(sim.getState()).toMatchObject({ invulnerable: true, shieldBlocks: 1 });
    expect(sim.buffs.shield).toBe(0);
    // A second rock during grace does not kill.
    sim.hazards.push(rock({ id: 902, z: 0, speed: 0 }));
    sim.step(DT);
    expect(sim.phase).toBe(SpaceDodgePhase.PLAYING);
    // After grace, an overlapping rock kills.
    for (let i = 0; i < 60 * 1.1; i += 1) sim.step(DT);
    expect(sim.phase).toBe(SpaceDodgePhase.GAME_OVER);
    expect(sim.getState().lastRun.shieldBlocks).toBe(1);
  });

  it('expires after its duration', () => {
    const sim = quietRun(24);
    collect(sim, BuffType.SHIELD);
    for (let i = 0; i < 60 * (SPACE_DODGE_CONFIG.buffs.shield.duration + 0.1); i += 1) sim.step(DT);
    expect(sim.buffs.shield).toBe(0);
  });
});

describe('time scale', () => {
  const clockAfter = (buff, seconds) => {
    const sim = quietRun(25);
    if (buff) collect(sim, buff);
    const start = sim.elapsedSeconds;
    const h = rock({ id: 903, x: -12, z: -8, speed: 5, heading: Math.PI / 2 });
    sim.hazards.push(h);
    const x0 = h.x;
    for (let i = 0; i < Math.round(seconds * 60); i += 1) sim.step(DT);
    return { clock: sim.elapsedSeconds - start, travelled: h.x - x0, sim };
  };

  it('overclock speeds up the survival clock and hazards by 1.6x', () => {
    const base = clockAfter(null, 2);
    const fast = clockAfter(BuffType.OVERCLOCK, 2);
    expect(fast.sim.timeScale()).toBeCloseTo(1.6, 5);
    expect(fast.clock / base.clock).toBeCloseTo(1.6, 2);
    expect(fast.travelled / base.travelled).toBeCloseTo(1.6, 2);
  });

  it('slow halves the clock and hazards, but not the ship', () => {
    const base = clockAfter(null, 2);
    const slow = clockAfter(BuffType.SLOW, 2);
    expect(slow.clock / base.clock).toBeCloseTo(0.5, 2);
    expect(slow.travelled / base.travelled).toBeCloseTo(0.5, 2);
    const sim = quietRun(26);
    collect(sim, BuffType.SLOW);
    for (let i = 0; i < 30; i += 1) sim.step(DT, { moveX: 1 });
    expect(sim.getState().player.speed).toBeGreaterThan(SPACE_DODGE_CONFIG.player.speed * 0.95);
  });

  it('stacks multiplicatively and returns to 1 when buffs end', () => {
    const sim = quietRun(27);
    collect(sim, BuffType.OVERCLOCK);
    collect(sim, BuffType.SLOW);
    expect(sim.timeScale()).toBeCloseTo(0.8, 5);
    const ended = [];
    sim.onEvent((e) => e.type === 'buff_ended' && ended.push(e.buff));
    for (let i = 0; i < 60 * 5.2; i += 1) sim.step(DT);
    expect(sim.timeScale()).toBe(1);
    expect(ended.sort()).toEqual(['overclock', 'slow']);
  });

  it('buff duration is real time, independent of the time scale', () => {
    const sim = quietRun(28);
    collect(sim, BuffType.OVERCLOCK);
    for (let i = 0; i < 60 * 4.8; i += 1) sim.step(DT);
    expect(sim.buffs.overclock).toBeGreaterThan(0);
    for (let i = 0; i < 60 * 0.3; i += 1) sim.step(DT);
    expect(sim.buffs.overclock).toBe(0);
  });
});

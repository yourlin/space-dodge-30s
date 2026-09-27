import { describe, expect, it } from 'vitest';
import {
  HazardType,
  SPACE_DODGE_CONFIG,
  SpaceDodgePhase,
  SpaceDodgeSimulation,
  difficultyLevel,
} from '../src/rules.js';
import { RECORDS_STORAGE_KEY, RecordBook, createMemoryStorage } from '../src/records.js';

const DT = 1 / 60;

/** Config copy with the player made untouchable, for spawn-only checks. */
function ghostConfig() {
  return { ...SPACE_DODGE_CONFIG, player: { ...SPACE_DODGE_CONFIG.player, hitRadius: -1000 } };
}

function runFor(sim, seconds, input = {}) {
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps && sim.phase === SpaceDodgePhase.PLAYING; i += 1) sim.step(DT, input);
}

describe('run lifecycle', () => {
  it('stays in READY and ignores steps until started', () => {
    const sim = new SpaceDodgeSimulation({ seed: 1 });
    sim.step(DT, { moveX: 1 });
    expect(sim.getState()).toMatchObject({ phase: 'ready', elapsedSeconds: 0, hazardCount: 0 });
    expect(sim.start()).toBe(true);
    expect(sim.start()).toBe(false);
    expect(sim.phase).toBe(SpaceDodgePhase.PLAYING);
  });

  it('pauses without advancing time or hazards, then resumes', () => {
    const sim = new SpaceDodgeSimulation({ seed: 2, config: ghostConfig() });
    sim.start();
    runFor(sim, 3);
    const before = sim.getState();
    expect(sim.togglePause()).toBe(true);
    runFor(sim, 2);
    sim.step(DT);
    const paused = sim.getState();
    expect(paused.phase).toBe('paused');
    expect(paused.elapsedSeconds).toBe(before.elapsedSeconds);
    expect(paused.hazardCount).toBe(before.hazardCount);
    sim.togglePause();
    sim.step(DT);
    expect(sim.getState().elapsedSeconds).toBeGreaterThan(before.elapsedSeconds);
  });

  it('restart resets time, hazards and player', () => {
    const sim = new SpaceDodgeSimulation({ seed: 3, config: ghostConfig() });
    sim.start();
    runFor(sim, 5, { moveX: 1 });
    expect(sim.getState().player.x).toBeGreaterThan(5);
    sim.restart();
    const state = sim.getState();
    expect(state).toMatchObject({ phase: 'playing', elapsedSeconds: 0, hazardCount: 0, nearMisses: 0 });
    expect(state.player).toMatchObject({ x: 0, z: 0, alive: true });
    expect(state.runIndex).toBe(2);
  });
});

describe('player movement', () => {
  it('moves right on moveX and up-screen (-Z) on moveY, at configured speed', () => {
    const sim = new SpaceDodgeSimulation({ seed: 4, config: ghostConfig() });
    sim.start();
    runFor(sim, 0.5, { moveX: 1 });
    const afterRight = sim.getState().player;
    expect(afterRight.x).toBeGreaterThan(3);
    expect(afterRight.speed).toBeCloseTo(SPACE_DODGE_CONFIG.player.speed, 0);
    runFor(sim, 0.5, { moveY: 1 });
    expect(sim.getState().player.z).toBeLessThan(-2);
  });

  it('precision modifier caps speed at the slow value', () => {
    const sim = new SpaceDodgeSimulation({ seed: 5, config: ghostConfig() });
    sim.start();
    runFor(sim, 1, { moveX: 1, run: true });
    const { player } = sim.getState();
    expect(player.precision).toBe(true);
    expect(player.speed).toBeLessThanOrEqual(SPACE_DODGE_CONFIG.player.precisionSpeed + 1e-6);
    expect(player.speed).toBeGreaterThan(SPACE_DODGE_CONFIG.player.precisionSpeed * 0.9);
  });

  it('is clamped inside the arena and diagonal input is normalized', () => {
    const sim = new SpaceDodgeSimulation({ seed: 6, config: ghostConfig() });
    sim.start();
    runFor(sim, 1, { moveX: 1, moveY: 1 });
    expect(sim.getState().player.speed).toBeLessThanOrEqual(SPACE_DODGE_CONFIG.player.speed + 1e-6);
    runFor(sim, 6, { moveX: 1, moveY: 1 });
    const { player } = sim.getState();
    const { halfWidth, halfDepth } = SPACE_DODGE_CONFIG.arena;
    const r = SPACE_DODGE_CONFIG.player.radius;
    expect(player.x).toBeCloseTo(halfWidth - r, 5);
    expect(player.z).toBeCloseTo(-(halfDepth - r), 5);
  });

  it('is frame-rate independent within tolerance', () => {
    const at = (dt) => {
      const sim = new SpaceDodgeSimulation({ seed: 7, config: ghostConfig() });
      sim.start();
      for (let t = 0; t < 0.6 - 1e-9; t += dt) sim.step(dt, { moveX: 1 });
      return sim.getState().player.x;
    };
    expect(Math.abs(at(1 / 30) - at(1 / 120))).toBeLessThan(0.25);
  });
});

describe('hazards and difficulty', () => {
  it('spawns every hazard type and ramps density over time', () => {
    const sim = new SpaceDodgeSimulation({ seed: 8, config: ghostConfig() });
    sim.start();
    runFor(sim, 5);
    const early = sim.getState().hazardCount;
    runFor(sim, 30);
    const late = sim.getState().hazardCount;
    expect(late).toBeGreaterThan(early * 2);
    for (const type of Object.values(HazardType)) {
      expect(sim.spawnedByType[type], type).toBeGreaterThan(0);
    }
    expect(difficultyLevel(0)).toBe(1);
    expect(difficultyLevel(29.9)).toBe(3);
    expect(sim.getState().difficultyLevel).toBe(4);
  });

  it('hazards spawn outside the arena and never exceed the cap', () => {
    const sim = new SpaceDodgeSimulation({ seed: 9, config: ghostConfig() });
    const { halfWidth, halfDepth } = SPACE_DODGE_CONFIG.arena;
    const spawnedOutside = [];
    sim.onEvent((e) => {
      if (e.type !== 'hazard_spawned') return;
      const h = sim.hazards.find((x) => x.id === e.hazardId);
      if (h.type === HazardType.MISSILE) return; // warning marker is inside, body outside
      spawnedOutside.push(Math.abs(h.x) >= halfWidth || Math.abs(h.z) >= halfDepth);
    });
    sim.start();
    runFor(sim, 60);
    expect(spawnedOutside.length).toBeGreaterThan(50);
    expect(spawnedOutside.every(Boolean)).toBe(true);
    expect(sim.hazards.length).toBeLessThanOrEqual(SPACE_DODGE_CONFIG.maxHazards);
  });

  it('missiles telegraph, then launch and home toward the player', () => {
    const sim = new SpaceDodgeSimulation({ seed: 10, config: ghostConfig() });
    const events = [];
    sim.onEvent((e) => events.push(e));
    sim.start();
    runFor(sim, 20);
    const warning = events.find((e) => e.type === 'missile_warning');
    const launch = events.find((e) => e.type === 'missile_launched' && e.hazardId === warning.hazardId);
    expect(warning).toBeTruthy();
    expect(launch.time - warning.time).toBeCloseTo(SPACE_DODGE_CONFIG.missile.warningSeconds, 1);
    const active = sim.hazards.filter((h) => h.type === HazardType.MISSILE);
    expect(active.length).toBeLessThanOrEqual(SPACE_DODGE_CONFIG.missile.maxActive);
  });

  it('a homing missile turns toward a player who moved sideways', () => {
    const sim = new SpaceDodgeSimulation({ seed: 11, config: ghostConfig() });
    sim.start();
    const missile = {
      id: 999, type: HazardType.MISSILE, x: 0, z: -12, radius: 0.36, speed: 6, heading: 0,
      spin: 0, age: 1, fuel: 2, state: 'flying', entered: true, closest: Infinity, nearMissCounted: false,
    };
    sim.hazards.push(missile);
    sim.player.x = 6;
    sim.step(DT * 10);
    expect(missile.heading).toBeGreaterThan(0);
    expect(missile.heading).toBeLessThanOrEqual(SPACE_DODGE_CONFIG.missile.turnRate * DT * 10 + 1e-9);
  });

  it('is deterministic for a fixed seed', () => {
    const trace = () => {
      const sim = new SpaceDodgeSimulation({ seed: 12 });
      sim.start();
      runFor(sim, 40, { moveX: 0.3 });
      return sim.getState().elapsedSeconds;
    };
    expect(trace()).toBe(trace());
  });
});

describe('collision, death and records', () => {
  it('a hazard reaching the player ends the run and records the time', () => {
    const storage = createMemoryStorage();
    const sim = new SpaceDodgeSimulation({ seed: 13, records: new RecordBook({ storage }) });
    const events = [];
    sim.onEvent((e) => events.push(e.type));
    sim.start();
    runFor(sim, 60); // standing still dies quickly
    const state = sim.getState();
    expect(state.phase).toBe('game_over');
    expect(state.player.alive).toBe(false);
    expect(state.elapsedSeconds).toBeGreaterThan(0.5);
    expect(state.elapsedSeconds).toBeLessThan(15);
    expect(state.lastRun).toMatchObject({ seconds: state.elapsedSeconds, rank: 1, newBest: true, goalReached: false });
    expect(events).toContain('player_destroyed');
    expect(events).toContain('new_record');
    const saved = JSON.parse(storage.getItem(RECORDS_STORAGE_KEY));
    expect(saved.entries[0].seconds).toBe(state.elapsedSeconds);
    // Time is frozen after death.
    sim.step(DT);
    expect(sim.getState().elapsedSeconds).toBe(state.elapsedSeconds);
  });

  it('near misses are counted once per hazard', () => {
    const sim = new SpaceDodgeSimulation({ seed: 14, config: ghostConfig() });
    sim.start();
    sim.hazards.push({
      id: 500, type: HazardType.METEOR_SMALL, x: -10, z: 1.2, radius: 0.4, speed: 10,
      heading: Math.PI / 2, spin: 0, age: 0, state: 'flying', entered: true, closest: Infinity, nearMissCounted: false,
    });
    // Restore a real hit radius so the pass is a miss, not a ghost hit.
    sim.config = SPACE_DODGE_CONFIG;
    for (let i = 0; i < 180; i += 1) sim.step(DT);
    expect(sim.phase).toBe('playing');
    expect(sim.nearMisses).toBeGreaterThanOrEqual(1);
    const before = sim.nearMisses;
    const own = sim.hazards.find((h) => h.id === 500);
    expect(own === undefined || own.nearMissCounted).toBe(true);
    expect(before).toBeLessThan(20);
  });

  it('record book keeps the top 10 sorted, survives reload and clears', () => {
    const storage = createMemoryStorage();
    const book = new RecordBook({ storage });
    for (const seconds of [5, 31.5, 12, 8, 40, 2, 3, 4, 6, 7, 9, 10]) book.add({ seconds });
    const reloaded = new RecordBook({ storage });
    expect(reloaded.bestSeconds()).toBe(40);
    expect(reloaded.list()).toHaveLength(10);
    expect(reloaded.list().map((r) => r.seconds)).toEqual([40, 31.5, 12, 10, 9, 8, 7, 6, 5, 4]);
    expect(reloaded.totalRuns()).toBe(12);
    reloaded.clear();
    expect(new RecordBook({ storage }).list()).toEqual([]);
  });

  it('corrupt storage falls back to an empty board', () => {
    const storage = createMemoryStorage();
    storage.setItem(RECORDS_STORAGE_KEY, '{not json');
    expect(new RecordBook({ storage }).list()).toEqual([]);
  });

  it('emits the 30-second goal milestone while surviving', () => {
    const sim = new SpaceDodgeSimulation({ seed: 15, config: ghostConfig() });
    const milestones = [];
    sim.onEvent((e) => e.type === 'milestone' && milestones.push(e));
    sim.start();
    runFor(sim, 31);
    expect(milestones.map((m) => m.seconds)).toEqual([10, 20, 30]);
    expect(milestones.find((m) => m.seconds === 30).goal).toBe(true);
  });
});

// Offline difficulty probe: survival time for bots of different skill.
import { SpaceDodgeSimulation, SpaceDodgePhase } from '../src/rules.js';

const bots = {
  idle: () => ({ moveX: 0, moveY: 0 }),
  // Repulsion from predicted hazard positions, pull toward the centre.
  evasive: (sim, horizon, reaction) => {
    const { player: p, hazards } = sim.getRenderables();
    let fx = -p.x * 0.02, fz = -p.z * 0.03;
    for (const h of hazards) {
      if (h.state !== 'flying') continue;
      for (const t of [0, horizon * 0.5, horizon]) {
        const hx = h.x + Math.sin(h.heading) * h.speed * t;
        const hz = h.z + Math.cos(h.heading) * h.speed * t;
        const dx = p.x - hx, dz = p.z - hz;
        const d = Math.max(0.1, Math.hypot(dx, dz) - h.radius);
        if (d > 5) continue;
        const w = 1 / (d * d);
        fx += dx / (d + h.radius) * w; fz += dz / (d + h.radius) * w;
      }
    }
    const m = Math.hypot(fx, fz);
    if (m < 0.02) return { moveX: 0, moveY: 0 };
    return { moveX: fx / m, moveY: -fz / m };
  },
  // Tries 9 move options and keeps the one with the largest predicted
  // clearance over the horizon — a proxy for an attentive human.
  planner: (sim, horizon) => {
    const { player: p, hazards, arena } = sim.getRenderables();
    const speed = sim.config.player.speed;
    const options = [[0, 0]];
    for (let k = 0; k < 8; k += 1) options.push([Math.cos(k * Math.PI / 4), Math.sin(k * Math.PI / 4)]);
    let best = options[0], bestScore = -Infinity;
    for (const [ox, oz] of options) {
      let score = Infinity;
      for (let t = 0.1; t <= horizon + 1e-6; t += 0.1) {
        const px = Math.max(-arena.halfWidth + 0.6, Math.min(arena.halfWidth - 0.6, p.x + ox * speed * t));
        const pz = Math.max(-arena.halfDepth + 0.6, Math.min(arena.halfDepth - 0.6, p.z + oz * speed * t));
        for (const h of hazards) {
          if (h.state !== 'flying') continue;
          const hx = h.x + Math.sin(h.heading) * h.speed * t;
          const hz = h.z + Math.cos(h.heading) * h.speed * t;
          score = Math.min(score, Math.hypot(px - hx, pz - hz) - h.radius);
        }
      }
      score -= 0.02 * Math.hypot(p.x + ox, p.z + oz);
      if (score > bestScore) { bestScore = score; best = [ox, oz]; }
    }
    return { moveX: best[0], moveY: -best[1] };
  },
};

function run(bot, seed, args) {
  const sim = new SpaceDodgeSimulation({ seed });
  sim.start();
  let held = { moveX: 0, moveY: 0 }, since = 0;
  const dt = 1 / 60;
  while (sim.phase === SpaceDodgePhase.PLAYING && sim.elapsedSeconds < 180) {
    since += dt;
    if (since >= args.reaction) { held = bot(sim, args.horizon); since = 0; }
    sim.step(dt, held);
  }
  return sim.elapsedSeconds;
}

const stats = (xs) => { xs.sort((a, b) => a - b); return `median ${xs[xs.length >> 1].toFixed(1)}s  p10 ${xs[Math.floor(xs.length * .1)].toFixed(1)}  p90 ${xs[Math.floor(xs.length * .9)].toFixed(1)}  >=30s ${(xs.filter(x => x >= 30).length / xs.length * 100).toFixed(0)}%`; };
for (const [name, bot, args] of [
  ['idle', bots.idle, { reaction: 1, horizon: 0 }],
  ['novice (250ms, 0.3s lookahead)', bots.evasive, { reaction: 0.25, horizon: 0.3 }],
  ['average (150ms, 0.5s)', bots.evasive, { reaction: 0.15, horizon: 0.5 }],
  ['skilled (80ms, 0.7s)', bots.evasive, { reaction: 0.08, horizon: 0.7 }],
  ['planner casual (200ms, 0.6s)', bots.planner, { reaction: 0.2, horizon: 0.6 }],
  ['planner good (120ms, 0.8s)', bots.planner, { reaction: 0.12, horizon: 0.8 }],
  ['planner expert (60ms, 1.0s)', bots.planner, { reaction: 0.06, horizon: 1.0 }],
]) {
  const xs = Array.from({ length: 200 }, (_, i) => run(bot, 1000 + i, args));
  console.log(name.padEnd(34), stats(xs));
}

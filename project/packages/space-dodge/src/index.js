/**
 * Space Dodge 3D — "是男人就坚持30秒".
 *
 * Startup and system assembly: boots the runtime host, wires keyboard
 * input into the survival simulation, and attaches view and UI.
 */

import { A3GameInputRouter, A3GameLookMode, bootA3GameRuntime } from '@a3game/playable';
import { SpaceDodgeSimulation, SpaceDodgePhase } from './rules.js';
import { RecordBook } from './records.js';
import { SpaceDodgeView } from './view.js';
import { SpaceDodgeUi } from './ui.js';

export { SpaceDodgeSimulation, SpaceDodgePhase, HazardType, SPACE_DODGE_CONFIG } from './rules.js';
export { RecordBook, createMemoryStorage } from './records.js';

function browserStorage() {
  try {
    const probe = '__space_dodge_probe__';
    globalThis.localStorage.setItem(probe, '1');
    globalThis.localStorage.removeItem(probe);
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

/**
 * @param {{container?: string, hudContainer?: string, seed?: number}} [options]
 */
export async function startSpaceDodge(options = {}) {
  const hudContainer = options.hudContainer ?? '#a3game-hud';
  const context = await bootA3GameRuntime({
    container: options.container ?? '#a3game-viewport',
    hudContainer,
    createHud: false,
    requireManifest: false,
    autoBeginPlay: false,
    autoStart: false,
    hostOptions: { fov: 50, fixedTimeStep: 1 / 60, clearColor: 0x05060f, far: 1000 },
  });
  const { host, runtime } = context;

  const simulation = new SpaceDodgeSimulation({
    records: new RecordBook({ storage: browserStorage() }),
    seed: options.seed,
    // Fresh hazard pattern each run unless a seed is pinned for replay.
    randomSeed: options.seed === undefined ? () => Math.floor(Math.random() * 2 ** 32) : null,
  });
  const view = new SpaceDodgeView({ host, simulation });
  const ui = new SpaceDodgeUi({ hudContainer, simulation, host });

  const input = new A3GameInputRouter({
    target: host.container,
    controllerId: 'local_keyboard',
    lookMode: A3GameLookMode.ALWAYS,
    pointerSensitivity: 0,
    actionBindings: { Enter: 'confirm', Space: 'confirm', KeyP: 'pause', Escape: 'pause', KeyR: 'restart' },
  }).enable();

  const stopActions = input.onAction((action, phase) => {
    if (phase !== 'pressed') return;
    if (action === 'confirm') {
      if (simulation.phase === SpaceDodgePhase.PAUSED) simulation.togglePause();
      else simulation.start();
    } else if (action === 'pause') {
      simulation.togglePause();
    } else if (action === 'restart') {
      simulation.restart();
    }
  });

  let lastInput = { moveX: 0, moveY: 0, run: false };
  const stopTick = host.onTick((dt) => {
    lastInput = input.sample({ controllerId: 'local_keyboard' });
    simulation.step(dt, lastInput);
    view.update(dt, lastInput);
    ui.update(dt);
  });
  // Pause automatically when the tab loses focus mid-run.
  const onBlur = () => {
    if (simulation.phase === SpaceDodgePhase.PLAYING) simulation.togglePause();
  };
  globalThis.addEventListener?.('blur', onBlur);

  runtime.onWorldBeginPlay();
  host.start();

  const game = {
    ...context,
    simulation,
    view,
    ui,
    input,
    getState: () => ({ ...simulation.getState(), ui: ui.getState() }),
    start: () => simulation.start(),
    restart: () => simulation.restart(),
    togglePause: () => simulation.togglePause(),
    dispose() {
      globalThis.removeEventListener?.('blur', onBlur);
      stopTick();
      stopActions();
      input.disable();
      ui.dispose();
      view.dispose();
      runtime.deinitialize();
      host.dispose();
    },
  };
  globalThis.__A3GAME_GAME__ = game;
  globalThis.__A3GAME_PLAYTEST__ = {
    warmup: 1,
    look: 'off',
    actions: [
      { id: 'title_screen', duration: 1.5 },
      { id: 'start_run', taps: ['Space'], duration: 0.4 },
      { id: 'pause', taps: ['KeyP'], duration: 1 },
      { id: 'resume', taps: ['KeyP'], duration: 0.3 },
      { id: 'dodge_left', keys: ['KeyA'], duration: 0.9 },
      { id: 'dodge_up', keys: ['KeyW'], duration: 0.8 },
      { id: 'dodge_right', keys: ['KeyD'], duration: 1.4 },
      { id: 'precision_down', keys: ['KeyS', 'ShiftLeft'], duration: 1 },
      { id: 'diagonal_up_left', keys: ['KeyW', 'KeyA'], duration: 0.9 },
      { id: 'circle_right', keys: ['KeyD', 'KeyS'], duration: 1 },
      { id: 'hold_until_hit', duration: 6 },
      { id: 'game_over_screen', duration: 1.5 },
      { id: 'restart', taps: ['Space'], duration: 0.3 },
      { id: 'second_run_strafe', keys: ['KeyD'], duration: 1.2 },
    ],
  };
  return game;
}

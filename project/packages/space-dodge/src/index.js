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
import { SpaceDodgeAudio } from './audio.js';
import { TouchStick } from './touch.js';

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
 * First connected gamepad: left stick moves, A starts/resumes, Start
 * pauses, shoulders or triggers hold precision. Polled directly so a
 * connected but idle pad never overrides the keyboard.
 */
function createGamepadPoller(actions) {
  const held = new Set();
  const edge = (name, pressed, run) => {
    if (pressed && !held.has(name)) run();
    if (pressed) held.add(name);
    else held.delete(name);
  };
  return {
    poll() {
      const pads = globalThis.navigator?.getGamepads?.() ?? [];
      const pad = [...pads].find(Boolean);
      if (!pad) return { active: false, vector: { x: 0, y: 0 }, precision: false };
      const dead = 0.18;
      const axis = (v = 0) => (Math.abs(v) < dead ? 0 : (v - Math.sign(v) * dead) / (1 - dead));
      const x = axis(pad.axes[0]) || (pad.buttons[15]?.pressed ? 1 : 0) - (pad.buttons[14]?.pressed ? 1 : 0);
      const y = -axis(pad.axes[1]) || (pad.buttons[12]?.pressed ? 1 : 0) - (pad.buttons[13]?.pressed ? 1 : 0);
      edge('confirm', Boolean(pad.buttons[0]?.pressed), actions.confirm);
      edge('pause', Boolean(pad.buttons[9]?.pressed), actions.pause);
      const precision = [4, 5, 6, 7].some((i) => pad.buttons[i]?.pressed);
      return { active: x !== 0 || y !== 0, vector: { x, y }, precision };
    },
  };
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

  const storage = browserStorage();
  const simulation = new SpaceDodgeSimulation({
    records: new RecordBook({ storage }),
    seed: options.seed,
    // Fresh hazard pattern each run unless a seed is pinned for replay.
    randomSeed: options.seed === undefined ? () => Math.floor(Math.random() * 2 ** 32) : null,
  });
  const view = new SpaceDodgeView({ host, simulation });
  const audio = new SpaceDodgeAudio({ simulation, storage });
  const ui = new SpaceDodgeUi({ hudContainer, simulation, host, audio });
  const stick = new TouchStick({ onTouch: () => ui.setTouchMode(true) });
  if (ui.touch) stick.setEnabled(true);

  const input = new A3GameInputRouter({
    target: host.container,
    controllerId: 'local_keyboard',
    lookMode: A3GameLookMode.ALWAYS,
    pointerSensitivity: 0,
    actionBindings: {
      Enter: 'confirm', Space: 'confirm', KeyP: 'pause', Escape: 'pause', KeyR: 'restart', KeyM: 'mute',
    },
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
    } else if (action === 'mute') {
      ui.toggleMute();
    }
  });

  const gamepad = createGamepadPoller({
    confirm: () => (simulation.phase === SpaceDodgePhase.PAUSED ? simulation.togglePause() : simulation.start()),
    pause: () => simulation.togglePause(),
  });

  let lastInput = { moveX: 0, moveY: 0, run: false };
  const stopTick = host.onTick((dt) => {
    // Keyboard, stick and gamepad all speak screen space (x right, y up);
    // the view maps that onto the arena for the current orientation.
    const keys = input.sample({ controllerId: 'local_keyboard' });
    const pad = gamepad.poll();
    let screen = { x: keys.moveX, y: keys.moveY };
    if (stick.active) screen = stick.vector;
    else if (pad.active) screen = pad.vector;
    lastInput = { ...keys, ...view.screenToSim(screen.x, screen.y), run: keys.run || pad.precision };
    simulation.step(dt, lastInput);
    view.update(dt, lastInput);
    ui.update(dt);
    audio.update(dt);
  });
  // Pause automatically when the tab loses focus mid-run.
  const onBlur = () => {
    if (simulation.phase === SpaceDodgePhase.PLAYING) simulation.togglePause();
  };
  const onVisibility = () => {
    if (document.hidden) onBlur();
  };
  globalThis.addEventListener?.('blur', onBlur);
  document.addEventListener('visibilitychange', onVisibility);

  runtime.onWorldBeginPlay();
  host.start();

  const game = {
    ...context,
    simulation,
    view,
    ui,
    audio,
    stick,
    input,
    getState: () => ({ ...simulation.getState(), ui: ui.getState() }),
    start: () => simulation.start(),
    restart: () => simulation.restart(),
    togglePause: () => simulation.togglePause(),
    dispose() {
      globalThis.removeEventListener?.('blur', onBlur);
      document.removeEventListener('visibilitychange', onVisibility);
      stopTick();
      stick.dispose();
      audio.dispose();
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

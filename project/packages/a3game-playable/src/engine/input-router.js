/**
 * Converts browser keyboard, pointer, and gamepad events into the
 * generic normalized input frame.
 *
 * The router owns no gameplay meaning: it produces `moveX`, `moveY`,
 * `run`, `jump`, `yaw`, and `pitch` plus named action edges. Deciding
 * what an action does stays in the generated gameplay entity.
 */

import {
  createRuntimeInputState,
} from '../data-types/runtime-types.js';

export const DEFAULT_KEY_BINDINGS = Object.freeze({
  KeyW: 'forward',
  ArrowUp: 'forward',
  KeyS: 'backward',
  ArrowDown: 'backward',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
  ShiftLeft: 'run',
  ShiftRight: 'run',
  Space: 'jump',
});

/** Keys whose browser default would scroll or activate the page. */
const SWALLOWED_KEYS = new Set([
  'Space',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
]);

/**
 * How mouse movement becomes look input.
 *
 * - `pointer-lock` - only while the document owns the mouse (FPS);
 * - `drag`- only while a pointer button is held (third person);
 * - `always`       - every move event (debug and headless tests).
 */
export const A3GameLookMode = Object.freeze({
  POINTER_LOCK: 'pointer-lock',
  DRAG: 'drag',
  ALWAYS: 'always',
});

export class A3GameInputRouter {
  /**
   * @param {{target?: HTMLElement | Document,
   *          controllerId?: string,
   *          keyBindings?: Record<string, string>,
   *          actionBindings?: Record<string, string>,
   *          pointerSensitivity?: number,
   *          invertPitch?: boolean,
   *          maxPitch?: number,
   *          lookMode?: string,
   *          gamepadIndex?: number}} [options]
   */
  constructor(options = {}) {
    this.target = options.target ?? window;
    this.controllerId = String(options.controllerId ?? '');
    this.keyBindings = { ...DEFAULT_KEY_BINDINGS, ...(options.keyBindings ?? {}) };
    this.actionBindings = { ...(options.actionBindings ?? {}) };
    this.pointerSensitivity = Number(options.pointerSensitivity ?? 0.0025);
    this.invertPitch = Boolean(options.invertPitch);
    this.maxPitch = Number(options.maxPitch ?? Math.PI / 2 - 0.05);
    this.lookMode = String(
      options.lookMode ?? A3GameLookMode.POINTER_LOCK,
    );
    this.gamepadIndex = options.gamepadIndex ?? null;

    this.axes = { forward: 0, backward: 0, left: 0, right: 0 };
    this.run = false;
    this.jump = false;
    this.yaw = 0;
    this.pitch = 0;
    this.sequence = 0;
    this.enabled = false;
    this.pointerDown = false;
    /** @type {Set<string>} */
    this.pressedActions = new Set();
    /** @type {Set<(action: string, phase: 'pressed' | 'released') => void>} */
    this.actionListeners = new Set();
    /** @type {(() => void)[]} */
    this.teardown = [];
  }

  /** Begin listening for browser input events. */
  enable() {
    if (this.enabled) return this;
    this.enabled = true;
    const listen = (element, type, handler, options) => {
      element.addEventListener(type, handler, options);
      this.teardown.push(() =>
        element.removeEventListener(type, handler, options),
      );
    };
    listen(window, 'keydown', (event) => this.#onKey(event, true));
    listen(window, 'keyup', (event) => this.#onKey(event, false));
    listen(window, 'blur', () => this.reset());
    if (this.target !== window) {
      listen(this.target, 'pointermove', (event) => this.#onPointerMove(event));
      listen(this.target, 'pointerdown', (event) => this.#onPointer(event, true));
      listen(this.target, 'pointerup', (event) => this.#onPointer(event, false));
      listen(this.target, 'contextmenu', (event) => event.preventDefault());
      // A drag that ends outside the viewport still has to release the
      // button, otherwise drag-look sticks on forever.
      listen(window, 'pointerup', (event) => this.#onPointer(event, false));
      listen(window, 'pointercancel', () => {
        this.pointerDown = false;
      });
    }
    return this;
  }

  /** Stop listening and clear held state. */
  disable() {
    for (const remove of this.teardown) remove();
    this.teardown = [];
    this.enabled = false;
    this.reset();
    return this;
  }

  /** Clear every held axis, action, and edge. */
  reset() {
    this.axes = { forward: 0, backward: 0, left: 0, right: 0 };
    this.run = false;
    this.jump = false;
    this.pointerDown = false;
    this.pressedActions.clear();
    return this;
  }

  /**
   * Overwrite the accumulated look angles.
   *
   * Needed whenever gameplay repositions the camera itself, for example
   * on respawn or when a vehicle takes over aiming.
   *
   * @param {number} yaw radians
   * @param {number} [pitch] radians, clamped to `maxPitch`
   */
  setLook(yaw, pitch = this.pitch) {
    this.yaw = Number(yaw) || 0;
    this.pitch = Math.max(
      -this.maxPitch,
      Math.min(this.maxPitch, Number(pitch) || 0),
    );
    return this;
  }

  /**
   * Subscribe to named action edges such as `'fire'` or `'reload'`.
   *
   * @param {(action: string, phase: 'pressed' | 'released') => void} listener
   * @returns {() => void} unsubscribe
   */
  onAction(listener) {
    if (typeof listener !== 'function') {
      throw new TypeError('onAction requires a function');
    }
    this.actionListeners.add(listener);
    return () => this.actionListeners.delete(listener);
  }

  /** @returns {boolean} whether a named action is currently held. */
  isActionHeld(action) {
    return this.pressedActions.has(String(action));
  }

  /**
   * Sample current state as one normalized input frame.
   *
   * `jump` is an edge: it reports true once per press so a held key does
   * not produce continuous jumping.
   *
   * @param {{worldId?: string, participantId?: string, entityId?: string}} [identity]
   */
  sample(identity = {}) {
    this.#pollGamepad();
    const moveY = this.axes.forward - this.axes.backward;
    const moveX = this.axes.right - this.axes.left;
    const jump = this.jump;
    this.jump = false;
    this.sequence += 1;
    return createRuntimeInputState({
      worldId: identity.worldId,
      participantId: identity.participantId,
      controllerId: identity.controllerId ?? this.controllerId,
      entityId: identity.entityId,
      moveX,
      moveY,
      run: this.run,
      jump,
      yaw: this.yaw,
      pitch: this.pitch,
      sequence: this.sequence,
    });
  }

  /**
   * Sample and deliver input to a session subsystem each frame.
   *
   * @param {object} session an `A3GameWorldSessionSubsystem`
   * @param {object} host an `A3GameRuntimeHost`
   * @param {{controllerId: string}} identity
   * @returns {() => void} unsubscribe
   */
  pipeToSession(session, host, identity) {
    return host.onTick(() => {
      session.enqueueInputState(this.sample(identity));
    });
  }

  #onKey(event, pressed) {
    const binding = this.keyBindings[event.code];
    if (binding) {
      if (binding === 'run') {
        this.run = pressed;
      } else if (binding === 'jump') {
        if (pressed && !this.pressedActions.has('jump')) this.jump = true;
        this.#setAction('jump', pressed);
      } else if (binding in this.axes) {
        this.axes[binding] = pressed ? 1 : 0;
      }
      if (SWALLOWED_KEYS.has(event.code)) event.preventDefault();
    }
    const action = this.actionBindings[event.code];
    if (action) this.#setAction(action, pressed);
  }

  #onPointer(event, pressed) {
    this.pointerDown = pressed
      ? true
      : (event.buttons ?? 0) !== 0;
    const action =
      this.actionBindings[`Mouse${event.button}`] ??
      (event.button === 0 ? 'primary' : event.button === 2 ? 'secondary' : '');
    if (action) this.#setAction(action, pressed);
  }

  #onPointerMove(event) {
    if (this.lookMode === A3GameLookMode.POINTER_LOCK) {
      if (!document.pointerLockElement) return;
    } else if (this.lookMode === A3GameLookMode.DRAG) {
      if (!this.pointerDown) return;
    }
    const dx = Number(event.movementX ?? 0);
    const dy = Number(event.movementY ?? 0);
    if (dx === 0 && dy === 0) return;
    this.yaw -= dx * this.pointerSensitivity;
    const direction = this.invertPitch ? 1 : -1;
    this.pitch = Math.max(
      -this.maxPitch,
      Math.min(
        this.maxPitch,
        this.pitch + direction * dy * this.pointerSensitivity,
      ),
    );
  }

  #setAction(action, pressed) {
    const key = String(action);
    const held = this.pressedActions.has(key);
    if (pressed && !held) {
      this.pressedActions.add(key);
      for (const listener of this.actionListeners) listener(key, 'pressed');
    } else if (!pressed && held) {
      this.pressedActions.delete(key);
      for (const listener of this.actionListeners) listener(key, 'released');
    }
  }

  #pollGamepad() {
    if (this.gamepadIndex === null) return;
    const pads = navigator.getGamepads?.() ?? [];
    const pad = pads[this.gamepadIndex];
    if (!pad) return;
    const deadzone = 0.15;
    const axis = (value) => (Math.abs(value) < deadzone ? 0 : value);
    const stickX = axis(pad.axes[0] ?? 0);
    const stickY = axis(pad.axes[1] ?? 0);
    this.axes.right = Math.max(0, stickX);
    this.axes.left = Math.max(0, -stickX);
    this.axes.forward = Math.max(0, -stickY);
    this.axes.backward = Math.max(0, stickY);
    this.yaw -= axis(pad.axes[2] ?? 0) * 0.04;
    this.pitch = Math.max(
      -this.maxPitch,
      Math.min(this.maxPitch, this.pitch - axis(pad.axes[3] ?? 0) * 0.04),
    );
    this.run = Boolean(pad.buttons[10]?.pressed);
    if (pad.buttons[0]?.pressed && !this.pressedActions.has('jump')) {
      this.jump = true;
    }
    this.#setAction('jump', Boolean(pad.buttons[0]?.pressed));
    this.#setAction('primary', Boolean(pad.buttons[7]?.pressed));
    this.#setAction('secondary', Boolean(pad.buttons[6]?.pressed));
  }
}

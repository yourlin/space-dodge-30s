/**
 * Wraps `THREE.AnimationMixer` with crossfade, additive layers, and clip
 * lookup by name.
 *
 * Generated gameplay maps its own states (`'attack_light'`, `'reload'`,
 * `'drift'`) onto clips; the director only manages playback.
 */

import * as THREE from 'three';

export class A3GameAnimationDirector {
  /**
   * @param {THREE.Object3D} root the skinned or animated hierarchy
   * @param {THREE.AnimationClip[]} [clips]
   * @param {{defaultFade?: number}} [options]
   */
  constructor(root, clips = [], options = {}) {
    if (!root) {
      throw new TypeError('A3GameAnimationDirector requires a root object');
    }
    this.root = root;
    this.mixer = new THREE.AnimationMixer(root);
    this.defaultFade = Number(options.defaultFade ?? 0.2);
    /** @type {Map<string, THREE.AnimationClip>} */
    this.clips = new Map();
    /** @type {Map<string, THREE.AnimationAction>} */
    this.actions = new Map();
    /** @type {string} */
    this.currentState = '';
    /** @type {Map<string, string>} */
    this.stateToClip = new Map();
    for (const clip of clips) this.addClip(clip);
  }

  /** Register one clip under its own name. */
  addClip(clip) {
    if (!clip?.name) return this;
    this.clips.set(clip.name, clip);
    return this;
  }

  /** Register clips from another artifact, for example an imported motion. */
  addClips(clips = []) {
    for (const clip of clips) this.addClip(clip);
    return this;
  }

  /** @returns {string[]} */
  listClipNames() {
    return [...this.clips.keys()];
  }

  /**
   * Map a gameplay state to a clip name.
   *
   * Accepts a partial name so `mapState('walk', 'Walk')` still matches
   * `'Armature|Walk_Loop'`.
   */
  mapState(state, clipName) {
    const resolved = this.#resolveClipName(clipName);
    if (!resolved) return false;
    this.stateToClip.set(String(state), resolved);
    return true;
  }

  /** Map several states at once. */
  mapStates(mapping = {}) {
    const missing = [];
    for (const [state, clipName] of Object.entries(mapping)) {
      if (!this.mapState(state, clipName)) missing.push(clipName);
    }
    return missing;
  }

  /**
   * Map a state to the first clip name that exists.
   *
   * Necessary because the same gameplay state has to survive three
   * different sources of motion. An auto-rigged generated character has an
   * `aim` clip; the CC0 `robot_expressive` avatar has fourteen clips and
   * none of them is called that. Mapping a single name means the state
   * silently plays nothing on one of the two, and "nothing" for an enemy's
   * attack state is a shooter standing at attention while it kills you.
   *
   * @param {string} state
   * @param {string[]} candidates in order of preference
   * @returns {string} the clip that was bound, or `''`
   */
  mapStateChain(state, candidates = []) {
    for (const candidate of candidates) {
      if (this.mapState(state, candidate)) {
        return this.stateToClip.get(String(state)) ?? '';
      }
    }
    return '';
  }

  /**
   * Map several states, each with its own preference list.
   *
   * @param {Record<string, string[]>} mapping
   * @returns {{bound: Record<string, string>, missing: string[]}}
   */
  mapStateChains(mapping = {}) {
    const bound = {};
    const missing = [];
    for (const [state, candidates] of Object.entries(mapping)) {
      const clip = this.mapStateChain(state, candidates);
      if (clip) bound[state] = clip;
      else missing.push(state);
    }
    return { bound, missing };
  }

  /**
   * Crossfade to a mapped state.
   *
   * @param {string} state
   * @param {{fade?: number, loop?: boolean, timeScale?: number,
   *          clampWhenFinished?: boolean, restart?: boolean}} [options]
   * @returns {THREE.AnimationAction | null}
   */
  play(state, options = {}) {
    const key = String(state);
    if (key === this.currentState && !options.restart) {
      return this.actions.get(this.stateToClip.get(key) ?? '') ?? null;
    }
    const clipName =
      this.stateToClip.get(key) ?? this.#resolveClipName(key);
    if (!clipName) return null;
    const next = this.#action(clipName);
    if (!next) return null;

    next.loop = options.loop === false
      ? THREE.LoopOnce
      : THREE.LoopRepeat;
    next.clampWhenFinished = Boolean(options.clampWhenFinished);
    next.timeScale = Number(options.timeScale ?? 1);
    const fade = Number(options.fade ?? this.defaultFade);

    const previousClip = this.stateToClip.get(this.currentState);
    const previous = previousClip ? this.actions.get(previousClip) : null;
    if (options.restart) next.reset();
    next.enabled = true;
    if (previous && previous !== next) {
      next.reset().play();
      previous.crossFadeTo(next, fade, false);
    } else {
      next.reset().fadeIn(fade).play();
    }
    this.currentState = key;
    return next;
  }

  /**
   * Play a one-shot clip on top of the current state, then return.
   *
   * @param {string} state
   * @param {{fade?: number, timeScale?: number}} [options]
   * @returns {Promise<void>}
   */
  playOnce(state, options = {}) {
    const previous = this.currentState;
    const action = this.play(state, {
      ...options,
      loop: false,
      clampWhenFinished: true,
      restart: true,
    });
    if (!action) return Promise.resolve();
    return new Promise((resolve) => {
      const onFinished = (event) => {
        if (event.action !== action) return;
        this.mixer.removeEventListener('finished', onFinished);
        if (previous && previous !== state) this.play(previous);
        resolve();
      };
      this.mixer.addEventListener('finished', onFinished);
    });
  }

  /** Stop every action without disposing the mixer. */
  stopAll(fade = 0) {
    if (fade > 0) {
      for (const action of this.actions.values()) action.fadeOut(fade);
    } else {
      this.mixer.stopAllAction();
    }
    this.currentState = '';
    return this;
  }

  /** Advance the mixer. Call from the host tick. */
  update(deltaSeconds) {
    this.mixer.update(Math.max(0, Number(deltaSeconds) || 0));
    return this;
  }

  /** Bind the director to a host tick and return the unsubscribe. */
  attachToHost(host) {
    return host.onTick((delta) => this.update(delta));
  }

  /** @returns {object} playback state for snapshots and evidence. */
  getState() {
    return {
      currentState: this.currentState,
      clipCount: this.clips.size,
      clips: this.listClipNames(),
      activeActions: [...this.actions.entries()]
        .filter(([, action]) => action.isRunning())
        .map(([name, action]) => ({
          clip: name,
          weight: Number(action.getEffectiveWeight().toFixed(3)),
          time: Number(action.time.toFixed(3)),
        })),
    };
  }

  dispose() {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.root);
    this.actions.clear();
    this.clips.clear();
    this.stateToClip.clear();
    this.currentState = '';
  }

  #action(clipName) {
    if (this.actions.has(clipName)) return this.actions.get(clipName);
    const clip = this.clips.get(clipName);
    if (!clip) return null;
    const action = this.mixer.clipAction(clip);
    this.actions.set(clipName, action);
    return action;
  }

  #resolveClipName(candidate) {
    const name = String(candidate ?? '');
    if (!name) return '';
    if (this.clips.has(name)) return name;
    const lowered = name.toLowerCase();
    for (const key of this.clips.keys()) {
      if (key.toLowerCase() === lowered) return key;
    }
    for (const key of this.clips.keys()) {
      if (key.toLowerCase().includes(lowered)) return key;
    }
    return '';
  }
}

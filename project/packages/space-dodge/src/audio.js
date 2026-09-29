/**
 * Space Dodge — procedural sound effects and music (Web Audio, no files).
 *
 * Everything is synthesized at runtime so the game ships as a single
 * static bundle. The audio context is created lazily on the first user
 * gesture (browser autoplay policy). Music tempo follows the world time
 * scale, so slow and overclock buffs are audible as well as visible.
 */

import { SpaceDodgePhase } from './rules.js';

export const MUTE_STORAGE_KEY = 'space_dodge_30s.muted.v1';

/** A-minor synthwave loop: Am · F · C · G, one bar each. */
const BASS_BARS = [
  [45, 45, 57, 45, 45, 57, 45, 52],
  [41, 41, 53, 41, 41, 53, 41, 48],
  [48, 48, 60, 48, 48, 60, 48, 55],
  [43, 43, 55, 43, 43, 55, 43, 50],
];
const LEAD_BARS = [
  [69, 0, 72, 0, 76, 0, 72, 0],
  [69, 0, 72, 0, 77, 0, 72, 0],
  [67, 0, 72, 0, 76, 0, 79, 0],
  [67, 0, 71, 0, 74, 0, 71, 0],
];
const BASE_BPM = 124;
/** Events that can carry user activation (touchstart cannot). */
const UNLOCK_EVENTS = ['pointerdown', 'pointerup', 'keydown', 'click', 'touchend'];

const midiToHz = (note) => 440 * 2 ** ((note - 69) / 12);

function readMuted(storage) {
  try {
    return storage?.getItem(MUTE_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export class SpaceDodgeAudio {
  /**
   * @param {{simulation: import('./rules.js').SpaceDodgeSimulation, storage?: Storage}} options
   */
  constructor({ simulation, storage }) {
    this.simulation = simulation;
    this.storage = storage;
    this.muted = readMuted(storage);
    this.ctx = null;
    this.noise = null;
    this.step16 = 0;
    this.nextNoteAt = 0;
    this.warningBeepAt = 0;
    this.unsubscribe = simulation.onEvent((event) => this.#onEvent(event));

    // Create the context only inside an activating gesture; touchstart
    // and modifier-only keys do not count, and Chrome warns if we try.
    this.unlock = () => {
      if (globalThis.navigator?.userActivation?.isActive === false) return;
      this.#ensureContext();
    };
    for (const type of UNLOCK_EVENTS) {
      globalThis.addEventListener?.(type, this.unlock, { passive: true });
    }
  }

  #ensureContext() {
    if (!this.ctx) {
      const Context = globalThis.AudioContext ?? globalThis.webkitAudioContext;
      if (!Context) return null;
      try {
        this.ctx = new Context();
      } catch {
        return null;
      }
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.8;
      // A gentle limiter keeps stacked explosions from clipping.
      const limiter = this.ctx.createDynamicsCompressor();
      limiter.threshold.value = -10;
      limiter.ratio.value = 6;
      this.master.connect(limiter).connect(this.ctx.destination);
      this.sfxBus = this.ctx.createGain();
      this.sfxBus.gain.value = 0.9;
      this.sfxBus.connect(this.master);
      this.musicBus = this.ctx.createGain();
      this.musicBus.gain.value = 0.32;
      this.musicBus.connect(this.master);
      this.noise = this.#createNoiseBuffer();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  #createNoiseBuffer() {
    const length = this.ctx.sampleRate;
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  setMuted(muted) {
    this.muted = Boolean(muted);
    try {
      this.storage?.setItem(MUTE_STORAGE_KEY, this.muted ? '1' : '0');
    } catch {
      // Private mode: the toggle still works for this session.
    }
    if (this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.8, this.ctx.currentTime, 0.02);
    return this.muted;
  }

  toggleMuted() {
    this.unlock();
    return this.setMuted(!this.muted);
  }

  // ------------------------------------------------------------ primitives

  #tone({ freq, to = freq, type = 'sine', duration = 0.15, gain = 0.3, at = 0, bus = this.sfxBus, attack = 0.005 }) {
    const ctx = this.ctx;
    const t = ctx.currentTime + at;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (to !== freq) osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t + duration);
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.exponentialRampToValueAtTime(gain, t + attack);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(amp).connect(bus);
    osc.start(t);
    osc.stop(t + duration + 0.05);
  }

  #noiseBurst({ duration = 0.3, gain = 0.4, filter = 'lowpass', freq = 1200, to = freq, q = 0.8, at = 0, bus = this.sfxBus }) {
    const ctx = this.ctx;
    const t = ctx.currentTime + at;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const biquad = ctx.createBiquadFilter();
    biquad.type = filter;
    biquad.Q.value = q;
    biquad.frequency.setValueAtTime(freq, t);
    if (to !== freq) biquad.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + duration);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(gain, t);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    src.connect(biquad).connect(amp).connect(bus);
    src.start(t, Math.random() * 0.5);
    src.stop(t + duration + 0.05);
  }

  // ------------------------------------------------------------ events

  #onEvent(event) {
    if (!this.ctx || this.muted) return;
    switch (event.type) {
      case 'run_started':
        this.step16 = 0;
        this.nextNoteAt = this.ctx.currentTime + 0.05;
        this.#tone({ freq: 220, to: 880, type: 'sawtooth', duration: 0.35, gain: 0.12 });
        break;
      case 'missile_warning':
        this.warningBeepAt = 0;
        break;
      case 'missile_launched':
        this.#noiseBurst({ duration: 0.5, gain: 0.22, filter: 'bandpass', freq: 600, to: 2600, q: 2 });
        break;
      case 'meteor_shower':
        this.#noiseBurst({ duration: 0.9, gain: 0.18, filter: 'bandpass', freq: 3000, to: 400, q: 1.5 });
        break;
      case 'near_miss':
        this.#noiseBurst({ duration: 0.16, gain: 0.16, filter: 'highpass', freq: 2500, to: 6000 });
        this.#tone({ freq: 1400, to: 1900, type: 'triangle', duration: 0.08, gain: 0.05 });
        break;
      case 'pickup_collected':
        [0, 4, 7, 12].forEach((semi, i) =>
          this.#tone({ freq: midiToHz(76 + semi), type: 'triangle', duration: 0.18, gain: 0.14, at: i * 0.055 }),
        );
        if (event.buff === 'slow') this.#tone({ freq: 600, to: 150, type: 'sine', duration: 0.6, gain: 0.15, at: 0.2 });
        if (event.buff === 'overclock') this.#tone({ freq: 200, to: 1200, type: 'sawtooth', duration: 0.45, gain: 0.08, at: 0.2 });
        break;
      case 'pickup_expired':
        this.#tone({ freq: 500, to: 260, type: 'sine', duration: 0.18, gain: 0.05 });
        break;
      case 'shield_blocked':
        this.#noiseBurst({ duration: 0.45, gain: 0.35, filter: 'highpass', freq: 1800, to: 900 });
        this.#tone({ freq: 1200, to: 300, type: 'square', duration: 0.3, gain: 0.08 });
        break;
      case 'buff_ended':
        if (event.reason === 'expired') this.#tone({ freq: 660, to: 330, type: 'triangle', duration: 0.2, gain: 0.07 });
        break;
      case 'milestone':
        (event.goal ? [0, 4, 7, 12, 16] : [0, 7, 12]).forEach((semi, i) =>
          this.#tone({ freq: midiToHz(72 + semi), type: 'square', duration: 0.22, gain: 0.07, at: i * 0.09 }),
        );
        break;
      case 'difficulty_up':
        this.#tone({ freq: 330, to: 660, type: 'sawtooth', duration: 0.3, gain: 0.06 });
        break;
      case 'player_destroyed':
        this.#noiseBurst({ duration: 1.4, gain: 0.7, filter: 'lowpass', freq: 3000, to: 120 });
        this.#tone({ freq: 140, to: 30, type: 'sine', duration: 0.9, gain: 0.6 });
        this.#tone({ freq: 90, to: 25, type: 'triangle', duration: 1.2, gain: 0.3, at: 0.05 });
        break;
      case 'new_record':
        [0, 4, 7, 11, 12].forEach((semi, i) =>
          this.#tone({ freq: midiToHz(79 + semi), type: 'triangle', duration: 0.3, gain: 0.1, at: 1 + i * 0.1 }),
        );
        break;
      default:
    }
  }

  // ------------------------------------------------------------ per tick

  /** Drive music and repeating cues; call once per tick. */
  update(dt) {
    if (!this.ctx || this.muted) return;
    const sim = this.simulation;
    if (sim.phase !== SpaceDodgePhase.PLAYING) {
      this.nextNoteAt = 0;
      return;
    }
    const scale = sim.timeScale();
    // Pending launch: urgent beeps while any warning marker is showing.
    const warning = sim.hazards.some((h) => h.state === 'warning');
    this.warningBeepAt -= dt;
    if (warning && this.warningBeepAt <= 0) {
      this.#tone({ freq: 1320, type: 'square', duration: 0.07, gain: 0.07 });
      this.warningBeepAt = 0.18;
    }
    this.#scheduleMusic(scale);
  }

  #scheduleMusic(scale) {
    const ctx = this.ctx;
    const now = ctx.currentTime;
    if (this.nextNoteAt < now) this.nextNoteAt = now + 0.02;
    const sixteenth = 60 / (BASE_BPM * scale) / 4;
    // Intensity grows with survival time: more layers join the mix.
    const elapsed = this.simulation.elapsedSeconds;
    while (this.nextNoteAt < now + 0.12) {
      const at = this.nextNoteAt - now;
      const s = this.step16 % 64;
      const bar = Math.floor(s / 16);
      const inBar = s % 16;
      if (inBar % 2 === 0) {
        const note = BASS_BARS[bar][inBar / 2];
        this.#tone({ freq: midiToHz(note) * scale ** 0.25, type: 'sawtooth', duration: sixteenth * 1.8, gain: 0.22, at, bus: this.musicBus });
      }
      if (inBar % 4 === 0) {
        this.#tone({ freq: 150, to: 40, type: 'sine', duration: 0.18, gain: 0.55, at, bus: this.musicBus });
      }
      if (inBar % 4 === 2) {
        this.#noiseBurst({ duration: 0.04, gain: 0.12, filter: 'highpass', freq: 7000, at, bus: this.musicBus });
      }
      if (elapsed > 10 && (inBar === 4 || inBar === 12)) {
        this.#noiseBurst({ duration: 0.14, gain: 0.25, filter: 'bandpass', freq: 1800, q: 0.7, at, bus: this.musicBus });
      }
      if (elapsed > 20 && inBar % 2 === 0) {
        const lead = LEAD_BARS[bar][inBar / 2];
        if (lead) this.#tone({ freq: midiToHz(lead), type: 'square', duration: sixteenth * 1.5, gain: 0.07, at, bus: this.musicBus });
      }
      this.step16 += 1;
      this.nextNoteAt += sixteenth;
    }
  }

  dispose() {
    this.unsubscribe();
    for (const type of UNLOCK_EVENTS) {
      globalThis.removeEventListener?.(type, this.unlock);
    }
    this.ctx?.close?.().catch?.(() => {});
    this.ctx = null;
  }
}

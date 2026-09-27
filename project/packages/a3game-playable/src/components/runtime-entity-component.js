/**
 * Connects a game-owned `THREE.Object3D` to runtime entity state and
 * control. Counterpart of `UA3GameRuntimeEntityComponent`.
 *
 * The component owns no movement rules. It records the latest accepted
 * input frame, derives a generic locomotion state, and produces a
 * snapshot the framework can observe. Concrete movement stays in the
 * generated gameplay entity.
 */

import {
  A3GameLocomotionState,
  createEntitySnapshot,
  createRuntimeInputState,
  locomotionStateFromInput,
} from '../data-types/runtime-types.js';
import {
  A3GAME_USER_DATA_KEY,
  A3GameIdentityComponent,
} from './identity-component.js';

export class A3GameRuntimeEntityComponent {
  /**
   * @param {import('three').Object3D} object
   * @param {{entityId?: string, participantId?: string,
   *          persistent?: boolean}} [options]
   */
  constructor(object, options = {}) {
    if (!object || typeof object !== 'object') {
      throw new TypeError(
        'A3GameRuntimeEntityComponent requires a THREE.Object3D',
      );
    }
    this.object = object;
    this.entityId = String(options.entityId ?? '');
    this.persistent =
      options.persistent === undefined ? true : Boolean(options.persistent);
    this.locomotionState = A3GameLocomotionState.IDLE;
    this.motionState = 'idle';
    this.lastInputTimeSeconds = 0;
    this.lastInputState = createRuntimeInputState({});
    this.lastAcceptedSequence = -1;
    /** @type {Set<(state: object) => void>} */
    this.inputListeners = new Set();

    this.identity = A3GameIdentityComponent.attach(object, {
      participantId: options.participantId,
      entityId: this.entityId,
    });
    const userData = object.userData ?? (object.userData = {});
    const slot =
      userData[A3GAME_USER_DATA_KEY] ?? (userData[A3GAME_USER_DATA_KEY] = {});
    slot.runtimeEntity = this;
  }

  /** @returns {A3GameRuntimeEntityComponent | null} */
  static get(object) {
    return object?.userData?.[A3GAME_USER_DATA_KEY]?.runtimeEntity ?? null;
  }

  /** @param {string} entityId */
  setRuntimeEntityId(entityId) {
    this.entityId = String(entityId ?? '');
    this.identity.setRuntimeIdentity(
      this.identity.participantId,
      this.entityId,
    );
    return this;
  }

  /**
   * Subscribe to accepted input frames.
   *
   * @param {(state: object) => void} listener
   * @returns {() => void} unsubscribe
   */
  onRuntimeInput(listener) {
    if (typeof listener !== 'function') {
      throw new TypeError('onRuntimeInput requires a function');
    }
    this.inputListeners.add(listener);
    return () => this.inputListeners.delete(listener);
  }

  /**
   * Record one normalized input frame.
   *
   * Out-of-order frames are dropped so late network delivery cannot
   * rewind an entity.
   *
   * @param {object} rawInputState
   * @returns {boolean} whether the frame was accepted
   */
  applyRuntimeInput(rawInputState) {
    const inputState = createRuntimeInputState(rawInputState);
    if (
      inputState.sequence > 0 &&
      inputState.sequence <= this.lastAcceptedSequence
    ) {
      return false;
    }
    this.lastAcceptedSequence = inputState.sequence;
    this.lastInputState = inputState;
    this.lastInputTimeSeconds = inputState.timestampSeconds;
    this.locomotionState = locomotionStateFromInput(inputState);
    this.motionState = this.locomotionState;
    for (const listener of this.inputListeners) {
      listener(inputState);
    }
    return true;
  }

  /** Override the reported motion state, for example `'attack_light'`. */
  setMotionState(motionState) {
    this.motionState = String(motionState ?? 'idle');
    return this;
  }

  /** @returns {ReturnType<typeof createEntitySnapshot>} */
  getRuntimeSnapshot() {
    const { position, rotation } = this.object;
    return createEntitySnapshot({
      entityId: this.entityId,
      objectName: String(this.object.name ?? ''),
      position: { x: position.x, y: position.y, z: position.z },
      rotation: { x: rotation.x, y: rotation.y, z: rotation.z },
      locomotionState: this.locomotionState,
      motionState: this.motionState,
      persistent: this.persistent,
      lastInputTimeSeconds: this.lastInputTimeSeconds,
    });
  }

  dispose() {
    this.inputListeners.clear();
    const slot = this.object?.userData?.[A3GAME_USER_DATA_KEY];
    if (slot?.runtimeEntity === this) {
      delete slot.runtimeEntity;
    }
  }
}

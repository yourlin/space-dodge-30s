/**
 * Runtime extension contracts implemented by generated gameplay.
 *
 * JavaScript has no `UINTERFACE`, so each contract is expressed as an
 * abstract base class plus a duck-type validator. Generated gameplay
 * may extend the base class or implement the methods on any object;
 * the subsystems only require the validator to pass.
 *
 * These are the three.js counterparts of:
 *   - `IA3GameControllableEntity`
 *   - `IA3GameEntityFactory`
 *   - `IA3GameRuntimeMessageHandler`
 */

import { createEntitySnapshot } from '../data-types/runtime-types.js';

const missingMethods = (candidate, methods) =>
  methods.filter((name) => typeof candidate?.[name] !== 'function');

/**
 * Contract implemented by game-owned controllable entities.
 *
 * A controllable entity owns exactly one `THREE.Object3D` subtree and
 * translates normalized input into its own movement rules. The
 * framework never moves the object itself.
 */
export class A3GameControllableEntity {
  /** @returns {string} */
  getRuntimeEntityId() {
    throw new Error('getRuntimeEntityId() must be implemented');
  }

  /** @param {string} entityId */
  setRuntimeEntityId(entityId) {
    throw new Error(`setRuntimeEntityId(${entityId}) must be implemented`);
  }

  /**
   * Apply one normalized input frame.
   *
   * @param {ReturnType<typeof import('../data-types/runtime-types.js').createRuntimeInputState>} inputState
   * @returns {boolean} whether the frame was consumed
   */
  applyRuntimeInput(inputState) {
    throw new Error(`applyRuntimeInput(${inputState}) must be implemented`);
  }

  /** @returns {ReturnType<typeof createEntitySnapshot>} */
  getRuntimeSnapshot() {
    return createEntitySnapshot({ entityId: this.getRuntimeEntityId() });
  }

  /**
   * Advance simulation for one frame.
   *
   * Optional. The runtime subsystem calls it when present.
   *
   * @param {number} deltaSeconds
   */
  tick(deltaSeconds) {
    void deltaSeconds;
  }

  /** Release three.js resources owned by this entity. */
  dispose() {}
}

export const CONTROLLABLE_ENTITY_METHODS = Object.freeze([
  'getRuntimeEntityId',
  'setRuntimeEntityId',
  'applyRuntimeInput',
  'getRuntimeSnapshot',
]);

/** Report whether a candidate satisfies the controllable-entity contract. */
export function isControllableEntity(candidate) {
  return missingMethods(candidate, CONTROLLABLE_ENTITY_METHODS).length === 0;
}

/** Throw a descriptive error when a candidate is not controllable. */
export function assertControllableEntity(candidate, label = 'entity') {
  const missing = missingMethods(candidate, CONTROLLABLE_ENTITY_METHODS);
  if (missing.length > 0) {
    throw new TypeError(
      `${label} does not implement A3GameControllableEntity;` +
        `missing: ${missing.join(', ')}`,
    );
  }
  return candidate;
}

/**
 * Contract implemented by game-owned entity factories.
 *
 * The factory decides which concrete class an entity uses, loads its
 * assets, and returns a controllable entity. The framework only knows
 * the returned contract.
 */
export class A3GameEntityFactory {
  /**
   * @param {ReturnType<typeof import('../data-types/runtime-types.js').createEntitySpawnRequest>} request
   * @param {object} context framework context: `{ host, assets, session }`
   * @returns {Promise<A3GameControllableEntity> | A3GameControllableEntity}
   */
  spawnRuntimeEntity(request, context) {
    throw new Error(
      `spawnRuntimeEntity(${request}, ${context}) must be implemented`,
    );
  }
}

export const ENTITY_FACTORY_METHODS = Object.freeze([
  'spawnRuntimeEntity',
]);

export function isEntityFactory(candidate) {
  return missingMethods(candidate, ENTITY_FACTORY_METHODS).length === 0;
}

export function assertEntityFactory(candidate, label = 'factory') {
  const missing = missingMethods(candidate, ENTITY_FACTORY_METHODS);
  if (missing.length > 0) {
    throw new TypeError(
      `${label} does not implement A3GameEntityFactory; ` +
        `missing: ${missing.join(', ')}`,
    );
  }
  return candidate;
}

/**
 * Contract for game-owned runtime message handling.
 *
 * Extension messages let a generated game add its own commands without
 * changing the framework's generic session protocol.
 */
export class A3GameRuntimeMessageHandler {
  /**
   * @param {string} messageType
   * @param {object} payload already-decoded JSON payload
   * @returns {boolean} whether the message was handled
   */
  handleRuntimeMessage(messageType, payload) {
    void messageType;
    void payload;
    return false;
  }
}

export const RUNTIME_MESSAGE_HANDLER_METHODS = Object.freeze([
  'handleRuntimeMessage',
]);

export function isRuntimeMessageHandler(candidate) {
  return (
    missingMethods(candidate, RUNTIME_MESSAGE_HANDLER_METHODS).length === 0
  );
}

export function assertRuntimeMessageHandler(candidate, label = 'handler') {
  const missing = missingMethods(candidate, RUNTIME_MESSAGE_HANDLER_METHODS);
  if (missing.length > 0) {
    throw new TypeError(
      `${label} does not implement A3GameRuntimeMessageHandler; ` +
        `missing: ${missing.join(', ')}`,
    );
  }
  return candidate;
}

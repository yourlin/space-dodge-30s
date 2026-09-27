/**
 * Generic runtime data contract shared by the adapter and generated
 * gameplay packages.
 *
 * This module is the three.js counterpart of the UE5
 * `DataTypes/A3GameRuntimeTypes.h` contract. Field names use the
 * wire-format spelling (`moveX`, `participantId`, ...) so the same
 * payload travels unchanged between Python, the runtime control
 * channel, and browser code.
 *
 * Coordinates: right-handed, Y-up, metres. Rotations: radians.
 */

/** Control arbitration mode assigned to a controller/entity binding. */
export const A3GameControlMode = Object.freeze({
  EXCLUSIVE: 'exclusive',
  PRIORITY: 'priority',
  ASSISTED: 'assisted',
  OBSERVING: 'observing',
});

/** Generic locomotion state reported by entity snapshots. */
export const A3GameLocomotionState = Object.freeze({
  IDLE: 'idle',
  WALK: 'walk',
  RUN: 'run',
  JUMP: 'jump',
});

/** Stable runtime command names understood by the runtime channel. */
export const A3GameRuntimeCommand = Object.freeze({
  SYNC_SESSION: 'sync_session',
  LEAVE_SESSION: 'leave_session',
  APPLY_INPUT: 'apply_input',
  WORLD_SNAPSHOT: 'world_snapshot',
  RESET_WORLD: 'reset_world',
  CLEAR_ENTITY: 'clear_entity',
});

const numberOr = (value, fallback) =>
  Number.isFinite(Number(value)) ? Number(value) : fallback;

const stringOr = (value, fallback = '') =>
  typeof value === 'string' && value.length > 0 ? value : fallback;

/**
 * Normalized control input frame.
 *
 * `moveX`/`moveY` are clamped to [-1, 1]; `yaw`/`pitch` are absolute
 * radians. `sequence` lets a receiver drop out-of-order frames.
 *
 * @param {Partial<ReturnType<typeof createRuntimeInputState>>} [source]
 */
export function createRuntimeInputState(source = {}) {
  const clamp = (value) => Math.max(-1, Math.min(1, numberOr(value, 0)));
  return {
    worldId: stringOr(source.worldId),
    participantId: stringOr(source.participantId),
    controllerId: stringOr(source.controllerId),
    entityId: stringOr(source.entityId),
    moveX: clamp(source.moveX),
    moveY: clamp(source.moveY),
    run: Boolean(source.run),
    jump: Boolean(source.jump),
    yaw: numberOr(source.yaw, 0),
    pitch: numberOr(source.pitch, 0),
    sequence: Math.trunc(numberOr(source.sequence, 0)),
    timestampSeconds: numberOr(
      source.timestampSeconds,
      performance.now() / 1000,
    ),
  };
}

/** Describes one generic entity spawn request. */
export function createEntitySpawnRequest(source = {}) {
  return {
    worldId: stringOr(source.worldId),
    participantId: stringOr(source.participantId),
    entityId: stringOr(source.entityId),
    transform: createTransform(source.transform),
    parameters: { ...(source.parameters ?? {}) },
  };
}

/** Describes one runtime participant. */
export function createParticipantInfo(source = {}) {
  return {
    participantId: stringOr(source.participantId),
    worldId: stringOr(source.worldId),
    userId: stringOr(source.userId),
    entityId: stringOr(source.entityId),
    online: source.online === undefined ? true : Boolean(source.online),
    lastSeenSeconds: numberOr(source.lastSeenSeconds, 0),
  };
}

/** Describes one generic controller. */
export function createControllerState(source = {}) {
  return {
    controllerId: stringOr(source.controllerId),
    participantId: stringOr(source.participantId),
    worldId: stringOr(source.worldId),
    kind: stringOr(source.kind, 'human'),
    online: source.online === undefined ? true : Boolean(source.online),
    lastSeenSeconds: numberOr(source.lastSeenSeconds, 0),
  };
}

/** Connects a controller and an entity under one arbitration mode. */
export function createControlBinding(source = {}) {
  const mode = stringOr(source.mode, A3GameControlMode.EXCLUSIVE);
  const known = Object.values(A3GameControlMode);
  return {
    controllerId: stringOr(source.controllerId),
    entityId: stringOr(source.entityId),
    worldId: stringOr(source.worldId),
    mode: known.includes(mode) ? mode : A3GameControlMode.EXCLUSIVE,
    priority: Math.trunc(numberOr(source.priority, 0)),
    active: source.active === undefined ? true : Boolean(source.active),
  };
}

/** Reports observable generic entity state. */
export function createEntitySnapshot(source = {}) {
  const state = stringOr(source.locomotionState, A3GameLocomotionState.IDLE);
  const known = Object.values(A3GameLocomotionState);
  return {
    entityId: stringOr(source.entityId),
    objectName: stringOr(source.objectName),
    position: createVector3(source.position),
    rotation: createVector3(source.rotation),
    locomotionState: known.includes(state)
      ? state
      : A3GameLocomotionState.IDLE,
    motionState: stringOr(source.motionState, 'idle'),
    persistent:
      source.persistent === undefined ? true : Boolean(source.persistent),
    lastInputTimeSeconds: numberOr(source.lastInputTimeSeconds, 0),
  };
}

/** Plain `{x, y, z}` vector, safe to serialize. */
export function createVector3(source, fallback = { x: 0, y: 0, z: 0 }) {
  if (Array.isArray(source) && source.length >= 3) {
    return {
      x: numberOr(source[0], fallback.x),
      y: numberOr(source[1], fallback.y),
      z: numberOr(source[2], fallback.z),
    };
  }
  const value = source ?? {};
  return {
    x: numberOr(value.x, fallback.x),
    y: numberOr(value.y, fallback.y),
    z: numberOr(value.z, fallback.z),
  };
}

/** Plain transform triple matching the world scene-graph schema. */
export function createTransform(source = {}) {
  return {
    position: createVector3(source.position),
    rotation: createVector3(source.rotation),
    scale: createVector3(source.scale, { x: 1, y: 1, z: 1 }),
  };
}

/**
 * Derive a locomotion state from one normalized input frame.
 *
 * Generated gameplay should reuse this so snapshots stay comparable
 * across games and engines.
 */
export function locomotionStateFromInput(inputState) {
  const moving =
    Math.abs(inputState?.moveX ?? 0) > 1e-3 ||
    Math.abs(inputState?.moveY ?? 0) > 1e-3;
  if (inputState?.jump) return A3GameLocomotionState.JUMP;
  if (moving && inputState?.run) return A3GameLocomotionState.RUN;
  if (moving) return A3GameLocomotionState.WALK;
  return A3GameLocomotionState.IDLE;
}

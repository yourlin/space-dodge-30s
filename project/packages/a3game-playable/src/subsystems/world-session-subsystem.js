/**
 * Owns generic participant, controller, entity, binding, input, and
 * snapshot session state. Counterpart of
 * `UA3GameWorldSessionSubsystem`.
 *
 * The subsystem is game-neutral: it defines no Fighter, FPS, or Racing
 * command. It stores who is connected, which controller drives which
 * entity, and the latest input frame per controller. Consumption is
 * rate-limited so a burst of network frames cannot outpace rendering.
 */

import {
  A3GameControlMode,
  createControlBinding,
  createControllerState,
  createEntitySpawnRequest,
  createParticipantInfo,
  createRuntimeInputState,
} from '../data-types/runtime-types.js';
import { assertControllableEntity } from '../interfaces/contracts.js';

let counter = 0;
const makeRuntimeId = (prefix) => {
  counter += 1;
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}${counter}${random}`;
};

export class A3GameWorldSessionSubsystem {
  /**
   * @param {{worldId?: string, inputConsumeHz?: number}} [options]
   */
  constructor(options = {}) {
    this.worldId = String(options.worldId ?? 'world_001');
    this.inputConsumeHz = Math.max(
      1,
      Number(options.inputConsumeHz ?? 60),
    );
    /** @type {Map<string, object>} */
    this.participants = new Map();
    /** @type {Map<string, object>} */
    this.controllers = new Map();
    /** @type {Map<string, object>} */
    this.controlBindings = new Map();
    /** @type {Map<string, object>} */
    this.entities = new Map();
    /** @type {Map<string, object>} */
    this.latestInputsByController = new Map();
    this.inputConsumeAccumulator = 0;
  }

  /** Register or refresh one participant. */
  registerParticipant(participantId, userId = '') {
    const resolvedId =
      String(participantId ?? '') || makeRuntimeId('participant');
    const existing = this.participants.get(resolvedId);
    const participant = createParticipantInfo({
      ...(existing ?? {}),
      participantId: resolvedId,
      worldId: this.worldId,
      userId: userId || existing?.userId || '',
      online: true,
      lastSeenSeconds: performance.now() / 1000,
    });
    this.participants.set(resolvedId, participant);
    return participant;
  }

  markParticipantOffline(participantId) {
    const participant = this.participants.get(String(participantId));
    if (!participant) return false;
    participant.online = false;
    for (const [controllerId, controller] of this.controllers) {
      if (controller.participantId === participant.participantId) {
        controller.online = false;
        const binding = this.controlBindings.get(controllerId);
        if (binding) binding.active = false;
      }
    }
    return true;
  }

  /** Create or refresh one controller for a participant. */
  createController(participantId, controllerId = '', kind = 'human') {
    const participant = this.registerParticipant(participantId);
    const resolvedId =
      String(controllerId ?? '') || makeRuntimeId('controller');
    const controller = createControllerState({
      controllerId: resolvedId,
      participantId: participant.participantId,
      worldId: this.worldId,
      kind,
      online: true,
      lastSeenSeconds: performance.now() / 1000,
    });
    this.controllers.set(resolvedId, controller);
    return controller;
  }

  /**
   * Register a spawned controllable entity.
   *
   * @param {string} entityId
   * @param {import('../interfaces/contracts.js').A3GameControllableEntity} entity
   * @param {string} [participantId]
   */
  registerEntity(entityId, entity, participantId = '') {
    const resolvedId = String(entityId ?? '') || makeRuntimeId('entity');
    assertControllableEntity(entity, `entity ${resolvedId}`);
    entity.setRuntimeEntityId(resolvedId);
    this.entities.set(resolvedId, entity);
    if (participantId) {
      const participant = this.registerParticipant(participantId);
      participant.entityId = resolvedId;
    }
    return resolvedId;
  }

  /** @returns {object | null} */
  getEntity(entityId) {
    return this.entities.get(String(entityId)) ?? null;
  }

  /** Remove an entity, its bindings, and optionally dispose it. */
  removeEntity(entityId, disposeEntity = true) {
    const resolvedId = String(entityId);
    const entity = this.entities.get(resolvedId);
    if (!entity) return false;
    this.entities.delete(resolvedId);
    for (const [controllerId, binding] of [...this.controlBindings]) {
      if (binding.entityId === resolvedId) {
        this.controlBindings.delete(controllerId);
        this.latestInputsByController.delete(controllerId);
      }
    }
    for (const participant of this.participants.values()) {
      if (participant.entityId === resolvedId) participant.entityId = '';
    }
    if (disposeEntity && typeof entity.dispose === 'function') {
      entity.dispose();
    }
    return true;
  }

  /** Bind a controller to an entity under one arbitration mode. */
  bindControllerToEntity(
    controllerId,
    entityId,
    mode = A3GameControlMode.EXCLUSIVE,
    priority = 0,
  ) {
    const controller = this.controllers.get(String(controllerId));
    if (!controller) return false;
    if (!this.entities.has(String(entityId))) return false;
    if (mode === A3GameControlMode.EXCLUSIVE) {
      for (const [existingId, binding] of [...this.controlBindings]) {
        if (
          binding.entityId === String(entityId) &&
          existingId !== String(controllerId)
        ) {
          this.controlBindings.delete(existingId);
        }
      }
    }
    this.controlBindings.set(
      String(controllerId),
      createControlBinding({
        controllerId: String(controllerId),
        entityId: String(entityId),
        worldId: this.worldId,
        mode,
        priority,
        active: true,
      }),
    );
    return true;
  }

  unbindController(controllerId) {
    const key = String(controllerId);
    this.latestInputsByController.delete(key);
    return this.controlBindings.delete(key);
  }

  /**
   * Establish participant, controller, entity, and binding together.
   *
   * Atomic session synchronization keeps the browser state consistent
   * with the adapter's `runtime.sessions.join` result.
   *
   * @param {{participant?: object, controller?: object,
   *          binding?: object, spawnRequest?: object}} payload
   * @param {(request: object) => Promise<object>} spawnEntity
   */
  async syncSession(payload, spawnEntity) {
    const participantId = String(
      payload?.participant?.participantId ??
        payload?.spawnRequest?.participantId ??
        '',
    );
    const participant = this.registerParticipant(
      participantId,
      String(payload?.participant?.userId ?? ''),
    );
    const controller = this.createController(
      participant.participantId,
      String(payload?.controller?.controllerId ?? ''),
      String(payload?.controller?.kind ?? 'human'),
    );
    const request = createEntitySpawnRequest({
      ...(payload?.spawnRequest ?? {}),
      worldId: this.worldId,
      participantId: participant.participantId,
    });
    const entity = await spawnEntity(request);
    const entityId = this.registerEntity(
      request.entityId || '',
      entity,
      participant.participantId,
    );
    this.bindControllerToEntity(
      controller.controllerId,
      entityId,
      String(payload?.binding?.mode ?? A3GameControlMode.EXCLUSIVE),
      Number(payload?.binding?.priority ?? 0),
    );
    return {
      worldId: this.worldId,
      participantId: participant.participantId,
      controllerId: controller.controllerId,
      entityId,
    };
  }

  /** Queue one normalized input frame for its bound entity. */
  enqueueInputState(rawInputState) {
    const inputState = createRuntimeInputState(rawInputState);
    const controllerId = inputState.controllerId;
    const binding = this.controlBindings.get(controllerId);
    if (!binding || !binding.active) return false;
    const controller = this.controllers.get(controllerId);
    if (controller) {
      controller.lastSeenSeconds = performance.now() / 1000;
      controller.online = true;
    }
    this.latestInputsByController.set(controllerId, {
      ...inputState,
      worldId: binding.worldId || this.worldId,
      entityId: binding.entityId,
    });
    return true;
  }

  /**
   * Deliver queued input to bound entities at `inputConsumeHz`.
   *
   * Call once per frame from the render loop.
   *
   * @param {number} deltaSeconds
   */
  consumeLatestInputs(deltaSeconds) {
    this.inputConsumeAccumulator += Math.max(0, Number(deltaSeconds) || 0);
    const interval = 1 / this.inputConsumeHz;
    if (this.inputConsumeAccumulator < interval) return 0;
    this.inputConsumeAccumulator = 0;

    const ordered = [...this.latestInputsByController.entries()].sort(
      (left, right) => {
        const leftPriority =
          this.controlBindings.get(left[0])?.priority ?? 0;
        const rightPriority =
          this.controlBindings.get(right[0])?.priority ?? 0;
        return rightPriority - leftPriority;
      },
    );
    let delivered = 0;
    for (const [controllerId, inputState] of ordered) {
      const binding = this.controlBindings.get(controllerId);
      if (!binding || !binding.active) continue;
      if (binding.mode === A3GameControlMode.OBSERVING) continue;
      const entity = this.entities.get(binding.entityId);
      if (!entity) continue;
      if (entity.applyRuntimeInput(inputState)) delivered += 1;
    }
    this.latestInputsByController.clear();
    return delivered;
  }

  /** @returns {object[]} */
  getWorldStateSnapshot() {
    return [...this.entities.values()].map((entity) =>
      entity.getRuntimeSnapshot(),
    );
  }

  /** @returns {object} full session state, safe to serialize. */
  getSessionSnapshot() {
    return {
      worldId: this.worldId,
      participants: [...this.participants.values()].map((item) => ({
        ...item,
      })),
      controllers: [...this.controllers.values()].map((item) => ({
        ...item,
      })),
      bindings: [...this.controlBindings.values()].map((item) => ({
        ...item,
      })),
      entities: this.getWorldStateSnapshot(),
    };
  }

  /** Drop every participant, controller, binding, and entity. */
  resetWorld(disposeEntities = true) {
    const entityIds = [...this.entities.keys()];
    for (const entityId of entityIds) {
      this.removeEntity(entityId, disposeEntities);
    }
    this.participants.clear();
    this.controllers.clear();
    this.controlBindings.clear();
    this.latestInputsByController.clear();
    this.inputConsumeAccumulator = 0;
    return { worldId: this.worldId, clearedEntities: entityIds };
  }
}

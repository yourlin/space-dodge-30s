/**
 * Registers game-owned factories and coordinates generic runtime entity
 * creation. Counterpart of `UA3GameRuntimeSubsystem`.
 *
 * The subsystem owns the bridge between the adapter's runtime control
 * channel and the game's own entity factory. It never contains gameplay
 * rules.
 */

import {
  A3GameRuntimeCommand,
  createEntitySpawnRequest,
} from '../data-types/runtime-types.js';
import {
  assertEntityFactory,
  assertRuntimeMessageHandler,
} from '../interfaces/contracts.js';
import { A3GameRuntimeChannel } from '../engine/runtime-channel.js';

export class A3GameRuntimeSubsystem {
  /**
   * @param {{host: object, session: object, assets?: object,
   *          channel?: A3GameRuntimeChannel,
   *          autoConnect?: boolean}} options
   */
  constructor(options) {
    if (!options?.host || !options?.session) {
      throw new TypeError(
        'A3GameRuntimeSubsystem requires { host, session }',
      );
    }
    this.host = options.host;
    this.session = options.session;
    this.assets = options.assets ?? null;
    this.entityFactory = null;
    /** @type {Set<object>} */
    this.messageHandlers = new Set();
    this.channel =
      options.channel ??
      new A3GameRuntimeChannel({
        onCommand: (command, payload) =>
          this.handleRuntimeCommand(command, payload),
      });
    this.autoConnect = options.autoConnect !== false;
    this.started = false;
    this.#unsubscribeTick = null;
  }

  /** @type {null | (() => void)} */
  #unsubscribeTick;

  /** Register the game-owned entity factory. */
  setEntityFactory(factory) {
    this.entityFactory = assertEntityFactory(factory, 'entityFactory');
    return this;
  }

  registerMessageHandler(handler) {
    assertRuntimeMessageHandler(handler, 'messageHandler');
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  unregisterMessageHandler(handler) {
    return this.messageHandlers.delete(handler);
  }

  /** @returns {object} the owned session subsystem. */
  getSessionSubsystem() {
    return this.session;
  }

  /**
   * Start generic runtime coordination.
   *
   * Counterpart of `OnWorldBeginPlay`: it hooks the render loop so
   * queued input reaches bound entities, and opens the control channel.
   */
  onWorldBeginPlay() {
    if (this.started) return this;
    this.started = true;
    this.#unsubscribeTick = this.host.onTick((deltaSeconds) => {
      this.session.consumeLatestInputs(deltaSeconds);
      for (const entity of this.session.entities.values()) {
        if (typeof entity.tick === 'function') entity.tick(deltaSeconds);
      }
    });
    if (this.autoConnect) this.channel.connect();
    return this;
  }

  /** Stop coordination and release the control channel. */
  deinitialize() {
    this.#unsubscribeTick?.();
    this.#unsubscribeTick = null;
    this.channel.disconnect();
    this.session.resetWorld(true);
    this.messageHandlers.clear();
    this.started = false;
  }

  /**
   * Spawn one entity through the game-owned factory.
   *
   * @param {object} rawRequest
   * @returns {Promise<object>} the controllable entity
   */
  async spawnEntity(rawRequest) {
    if (!this.entityFactory) {
      throw new Error(
        'No entity factory is registered; generated gameplay must call ' +
          'runtime.setEntityFactory()',
      );
    }
    const request = createEntitySpawnRequest(rawRequest);
    return this.entityFactory.spawnRuntimeEntity(request, {
      host: this.host,
      assets: this.assets,
      session: this.session,
    });
  }

  /**
   * Handle one generic runtime command from the adapter.
   *
   * Unknown commands are offered to registered message handlers so a
   * generated game can extend the protocol without forking the
   * framework.
   *
   * @param {string} command
   * @param {object} payload
   */
  async handleRuntimeCommand(command, payload = {}) {
    switch (command) {
      case A3GameRuntimeCommand.SYNC_SESSION: {
        const result = await this.session.syncSession(payload, (request) =>
          this.spawnEntity(request),
        );
        return { ok: true, command, ...result };
      }
      case A3GameRuntimeCommand.LEAVE_SESSION: {
        const controllerIds = Array.isArray(payload?.controllerIds)
          ? payload.controllerIds
          : [];
        for (const controllerId of controllerIds) {
          this.session.unbindController(controllerId);
        }
        if (payload?.participantId) {
          this.session.markParticipantOffline(payload.participantId);
        }
        return { ok: true, command, controllerIds };
      }
      case A3GameRuntimeCommand.APPLY_INPUT: {
        const accepted = this.session.enqueueInputState(payload);
        return { ok: accepted, command, accepted };
      }
      case A3GameRuntimeCommand.WORLD_SNAPSHOT: {
        return {
          ok: true,
          command,
          snapshot: this.session.getSessionSnapshot(),
        };
      }
      case A3GameRuntimeCommand.RESET_WORLD: {
        return {
          ok: true,
          command,
          ...this.session.resetWorld(true),
        };
      }
      case A3GameRuntimeCommand.CLEAR_ENTITY: {
        const removed = this.session.removeEntity(
          String(payload?.entityId ?? ''),
          payload?.destroyObject !== false,
        );
        return { ok: removed, command, removed };
      }
      default:
        return {
          ok: this.dispatchExtensionMessage(command, payload),
          command,
          handled_by: 'extension',
        };
    }
  }

  /**
   * Offer a message to every registered handler.
   *
   * @returns {boolean} whether any handler consumed it
   */
  dispatchExtensionMessage(messageType, payload) {
    let handled = false;
    for (const handler of this.messageHandlers) {
      if (handler.handleRuntimeMessage(messageType, payload)) handled = true;
    }
    return handled;
  }
}

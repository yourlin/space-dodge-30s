/**
 * Browser side of the adapter's runtime control channel.
 *
 * `ThreeClient.runtime.sessions.*` posts generic commands to
 * `http://<runtime_host>:<runtime_port>/command`. In the browser we
 * cannot listen on a TCP port, so the channel supports three transports
 * and picks the first available one:
 *
 * 1. `websocket` - connect to `ws://<host>:<port>` when a relay runs;
 * 2. `polling`   - long-poll `GET /pending` from the same relay;
 * 3. `local`     - expose `globalThis.__A3GAME_RUNTIME__` so Playwright,
 *                  Vitest, or a dev console can drive commands directly.
 *
 * The `local` transport is always installed, which is what makes
 * end-to-end tests deterministic without extra infrastructure.
 */

import { A3GameRuntimeCommand } from '../data-types/runtime-types.js';

const readEnvironment = (key, fallback) => {
  const meta = import.meta.env ?? {};
  return (
    meta[`VITE_${key}`] ??
    globalThis.process?.env?.[key] ??
    fallback
  );
};

export class A3GameRuntimeChannel {
  /**
   * @param {{onCommand: (command: string, payload: object) => Promise<object>,
   *          host?: string, port?: number, transport?: string,
   *          pollIntervalMs?: number, globalName?: string}} options
   */
  constructor(options) {
    if (typeof options?.onCommand !== 'function') {
      throw new TypeError(
        'A3GameRuntimeChannel requires an onCommand handler',
      );
    }
    this.onCommand = options.onCommand;
    this.host = String(
      options.host ?? readEnvironment('A3GAME_RUNTIME_HOST', '127.0.0.1'),
    );
    this.port = Number(
      options.port ?? readEnvironment('A3GAME_RUNTIME_PORT', 30040),
    );
    this.transport = String(
      options.transport ??
        readEnvironment('A3GAME_RUNTIME_TRANSPORT', 'local'),
    );
    this.pollIntervalMs = Number(options.pollIntervalMs ?? 250);
    this.globalName = String(options.globalName ?? '__A3GAME_RUNTIME__');

    this.socket = null;
    this.pollHandle = null;
    this.connected = false;
    /** @type {object[]} */
    this.history = [];
  }

  /** @returns {string} */
  get baseUrl() {
    return `http://${this.host}:${this.port}`;
  }

  /** Install the local bridge and open a remote transport when asked. */
  connect() {
    this.#installLocalBridge();
    if (this.transport === 'websocket') this.#connectWebSocket();
    if (this.transport === 'polling') this.#startPolling();
    this.connected = true;
    return this;
  }

  disconnect() {
    this.socket?.close();
    this.socket = null;
    if (this.pollHandle !== null) {
      clearTimeout(this.pollHandle);
      this.pollHandle = null;
    }
    if (globalThis[this.globalName]?.channel === this) {
      delete globalThis[this.globalName];
    }
    this.connected = false;
    return this;
  }

  /**
   * Dispatch one command and record it for evidence capture.
   *
   * @param {string} command
   * @param {object} payload
   */
  async dispatch(command, payload = {}) {
    const startedAt = performance.now();
    let result;
    try {
      result = await this.onCommand(String(command), payload ?? {});
    } catch (error) {
      result = { ok: false, command, error: String(error?.message ?? error) };
    }
    const record = {
      command: String(command),
      payload,
      result,
      durationMs: Number((performance.now() - startedAt).toFixed(2)),
      at: new Date().toISOString(),
    };
    this.history.push(record);
    if (this.history.length > 200) this.history.shift();
    return result;
  }

  /** @returns {object[]} recent command records. */
  getHistory() {
    return [...this.history];
  }

  #installLocalBridge() {
    globalThis[this.globalName] = {
      channel: this,
      commands: { ...A3GameRuntimeCommand },
      dispatch: (command, payload) => this.dispatch(command, payload),
      syncSession: (payload) =>
        this.dispatch(A3GameRuntimeCommand.SYNC_SESSION, payload),
      applyInput: (payload) =>
        this.dispatch(A3GameRuntimeCommand.APPLY_INPUT, payload),
      snapshot: (payload) =>
        this.dispatch(A3GameRuntimeCommand.WORLD_SNAPSHOT, payload ?? {}),
      resetWorld: (payload) =>
        this.dispatch(A3GameRuntimeCommand.RESET_WORLD, payload ?? {}),
      clearEntity: (payload) =>
        this.dispatch(A3GameRuntimeCommand.CLEAR_ENTITY, payload ?? {}),
      history: () => this.getHistory(),
    };
  }

  #connectWebSocket() {
    try {
      const socket = new WebSocket(`ws://${this.host}:${this.port}`);
      socket.addEventListener('message', async (event) => {
        let message;
        try {
          message = JSON.parse(event.data);
        } catch {
          return;
        }
        const result = await this.dispatch(
          message?.command,
          message?.payload ?? {},
        );
        socket.send(
          JSON.stringify({ id: message?.id ?? null, result }),
        );
      });
      socket.addEventListener('close', () => {
        this.socket = null;
      });
      this.socket = socket;
    } catch {
      this.socket = null;
    }
  }

  #startPolling() {
    const poll = async () => {
      try {
        const response = await fetch(`${this.baseUrl}/pending`, {
          cache: 'no-cache',
        });
        if (response.ok) {
          const batch = await response.json();
          for (const message of batch?.commands ?? []) {
            const result = await this.dispatch(
              message?.command,
              message?.payload ?? {},
            );
            await fetch(`${this.baseUrl}/result`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id: message?.id ?? null, result }),
            }).catch(() => {});
          }
        }
      } catch {
        // The relay is optional; the local bridge remains available.
      }
      this.pollHandle = setTimeout(poll, this.pollIntervalMs);
    };
    this.pollHandle = setTimeout(poll, this.pollIntervalMs);
  }
}

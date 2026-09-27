/**
 * Stores stable runtime identity on a game-owned `THREE.Object3D`.
 *
 * three.js has no component system, so identity is attached through
 * `object.userData.a3game` and mirrored on the component instance. This
 * is the counterpart of `UA3GameIdentityComponent`.
 */

export const A3GAME_USER_DATA_KEY = 'a3game';

export class A3GameIdentityComponent {
  /**
   * @param {import('three').Object3D} object
   * @param {{participantId?: string, entityId?: string}} [identity]
   */
  constructor(object, identity = {}) {
    if (!object || typeof object !== 'object') {
      throw new TypeError(
        'A3GameIdentityComponent requires a THREE.Object3D',
      );
    }
    this.object = object;
    this.participantId = String(identity.participantId ?? '');
    this.entityId = String(identity.entityId ?? '');
    this.#sync();
  }

  /** Attach or reuse the identity component for one object. */
  static attach(object, identity = {}) {
    const existing = A3GameIdentityComponent.get(object);
    if (existing) {
      existing.setRuntimeIdentity(
        identity.participantId ?? existing.participantId,
        identity.entityId ?? existing.entityId,
      );
      return existing;
    }
    return new A3GameIdentityComponent(object, identity);
  }

  /** @returns {A3GameIdentityComponent | null} */
  static get(object) {
    return object?.userData?.[A3GAME_USER_DATA_KEY]?.identity ?? null;
  }

  /** Find the nearest ancestor carrying a runtime identity. */
  static findInParents(object) {
    let current = object;
    while (current) {
      const identity = A3GameIdentityComponent.get(current);
      if (identity) return identity;
      current = current.parent;
    }
    return null;
  }

  /**
   * @param {string} participantId
   * @param {string} entityId
   */
  setRuntimeIdentity(participantId, entityId) {
    this.participantId = String(participantId ?? '');
    this.entityId = String(entityId ?? '');
    this.#sync();
    return this;
  }

  toJSON() {
    return {
      participantId: this.participantId,
      entityId: this.entityId,
      objectName: String(this.object?.name ?? ''),
      objectUuid: String(this.object?.uuid ?? ''),
    };
  }

  #sync() {
    const userData = this.object.userData ?? (this.object.userData = {});
    const slot =
      userData[A3GAME_USER_DATA_KEY] ?? (userData[A3GAME_USER_DATA_KEY] = {});
    slot.identity = this;
    slot.participantId = this.participantId;
    slot.entityId = this.entityId;
  }
}

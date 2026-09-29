/**
 * Space Dodge — floating virtual joystick for touch screens.
 *
 * Put a finger down anywhere on the play field and drag: the stick
 * appears under the finger and the deflection becomes an analog move
 * vector in screen space (x right, y up). A small deflection moves the
 * ship slowly, so touch players get "precision" mode for free.
 */

const STYLE = `
.sd-stick { position:absolute; width:120px; height:120px; margin:-60px 0 0 -60px; border-radius:50%;
  border:2px solid rgba(53,224,255,.45); background:rgba(53,224,255,.08); pointer-events:none;
  display:none; box-shadow:0 0 24px rgba(53,224,255,.2); }
.sd-stick > i { position:absolute; left:50%; top:50%; width:52px; height:52px; margin:-26px 0 0 -26px;
  border-radius:50%; background:rgba(53,224,255,.55); box-shadow:0 0 18px rgba(53,224,255,.6); }
`;

export class TouchStick {
  /**
   * @param {{target: HTMLElement, overlay: HTMLElement, radius?: number}} options
   *        `target` receives touches; `overlay` hosts the stick graphic.
   */
  constructor({ target, overlay, radius = 60 }) {
    this.target = target;
    this.radius = radius;
    this.pointerId = null;
    this.origin = { x: 0, y: 0 };
    this.vector = { x: 0, y: 0 };
    /** True once any touch has been seen; the UI swaps its hints. */
    this.used = false;

    this.style = document.createElement('style');
    this.style.textContent = STYLE;
    overlay.appendChild(this.style);
    this.base = document.createElement('div');
    this.base.className = 'sd-stick';
    this.knob = document.createElement('i');
    this.base.appendChild(this.knob);
    overlay.appendChild(this.base);

    this.onDown = (event) => {
      if (event.pointerType === 'mouse' || this.pointerId !== null) return;
      this.used = true;
      this.pointerId = event.pointerId;
      this.origin = { x: event.clientX, y: event.clientY };
      this.vector = { x: 0, y: 0 };
      this.#draw(0, 0);
      this.base.style.display = 'block';
      target.setPointerCapture?.(event.pointerId);
      event.preventDefault();
    };
    this.onMove = (event) => {
      if (event.pointerId !== this.pointerId) return;
      let dx = event.clientX - this.origin.x;
      let dy = event.clientY - this.origin.y;
      const length = Math.hypot(dx, dy);
      if (length > this.radius) {
        // Drag past the rim pulls the stick along, so the finger never
        // runs out of room on small screens.
        const excess = length - this.radius;
        this.origin.x += (dx / length) * excess;
        this.origin.y += (dy / length) * excess;
        dx = (dx / length) * this.radius;
        dy = (dy / length) * this.radius;
      }
      const dead = 0.08;
      const magnitude = Math.hypot(dx, dy) / this.radius;
      const scale = magnitude < dead ? 0 : (magnitude - dead) / (1 - dead) / Math.max(magnitude, 1e-6);
      this.vector = { x: (dx / this.radius) * scale, y: (-dy / this.radius) * scale };
      this.#draw(dx, dy);
      event.preventDefault();
    };
    this.onUp = (event) => {
      if (event.pointerId !== this.pointerId) return;
      this.pointerId = null;
      this.vector = { x: 0, y: 0 };
      this.base.style.display = 'none';
    };
    target.addEventListener('pointerdown', this.onDown);
    target.addEventListener('pointermove', this.onMove);
    target.addEventListener('pointerup', this.onUp);
    target.addEventListener('pointercancel', this.onUp);
  }

  #draw(dx, dy) {
    const rect = this.base.offsetParent?.getBoundingClientRect?.() ?? { left: 0, top: 0 };
    this.base.style.left = `${this.origin.x - rect.left}px`;
    this.base.style.top = `${this.origin.y - rect.top}px`;
    this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
  }

  get active() {
    return this.pointerId !== null;
  }

  dispose() {
    this.target.removeEventListener('pointerdown', this.onDown);
    this.target.removeEventListener('pointermove', this.onMove);
    this.target.removeEventListener('pointerup', this.onUp);
    this.target.removeEventListener('pointercancel', this.onUp);
    this.base.remove();
    this.style.remove();
  }
}

/**
 * Space Dodge — touch control pad.
 *
 * On touch devices a dedicated control area is reserved below the play
 * field (beside it in landscape), so the thumb never covers the ship or
 * incoming hazards. The game viewport shrinks to the remaining space and
 * the camera refits through the host's resize observer.
 *
 * Put a finger down anywhere in the pad and drag: the stick jumps under
 * the finger and the deflection becomes an analog move vector in screen
 * space (x right, y up). A small deflection moves the ship slowly, so
 * touch players get "precision" mode for free.
 */

const STYLE = `
:root { --sd-pad-h: clamp(150px, 28vh, 230px); --sd-pad-w: clamp(170px, 30vw, 260px); }
#a3game-viewport { transition: none; }
body.sd-touch #a3game-viewport { bottom: var(--sd-pad-h); }
.sd-pad { display:none; position:absolute; left:0; right:0; bottom:0; height:var(--sd-pad-h); z-index:1;
  touch-action:none; overflow:hidden; box-sizing:border-box; padding-bottom:env(safe-area-inset-bottom);
  background:linear-gradient(180deg, rgba(10,18,44,.96), rgba(4,7,18,.98));
  border-top:1px solid rgba(53,224,255,.45); box-shadow:0 -6px 24px rgba(53,224,255,.12);
  font-family:"PingFang SC","Microsoft YaHei",system-ui,sans-serif; color:#9fb6e8; }
body.sd-touch .sd-pad { display:block; }
body.sd-touch #a3game-hud { z-index:2; }
body.sd-touch .sd-tools { bottom:calc(var(--sd-pad-h) / 2 - 50px); flex-direction:column; }
.sd-pad-hint { position:absolute; left:0; right:0; top:10px; text-align:center; font-size:13px; letter-spacing:1px;
  pointer-events:none; opacity:.85; }
.sd-pad-hint b { color:#35e0ff; font-weight:700; }
.sd-pad-sub { position:absolute; left:0; right:0; bottom:calc(10px + env(safe-area-inset-bottom)); text-align:center;
  font-size:11px; opacity:.55; pointer-events:none; }
.sd-stick { position:absolute; width:120px; height:120px; margin:-60px 0 0 -60px; border-radius:50%;
  border:2px solid rgba(53,224,255,.45); background:rgba(53,224,255,.08); pointer-events:none;
  box-shadow:0 0 24px rgba(53,224,255,.2); transition:opacity .2s; }
.sd-stick.idle { opacity:.45; }
.sd-stick > i { position:absolute; left:50%; top:50%; width:52px; height:52px; margin:-26px 0 0 -26px;
  border-radius:50%; background:rgba(53,224,255,.55); box-shadow:0 0 18px rgba(53,224,255,.6); }
.sd-stick > s { position:absolute; inset:-14px; pointer-events:none; text-decoration:none; color:rgba(53,224,255,.55);
  font-size:11px; }
.sd-stick > s::before { content:'▲'; position:absolute; top:0; left:50%; transform:translateX(-50%); }
.sd-stick > s::after { content:'▼'; position:absolute; bottom:0; left:50%; transform:translateX(-50%); }
.sd-stick > u { position:absolute; inset:-14px; pointer-events:none; text-decoration:none; color:rgba(53,224,255,.55);
  font-size:11px; }
.sd-stick > u::before { content:'◀'; position:absolute; left:0; top:50%; transform:translateY(-50%); }
.sd-stick > u::after { content:'▶'; position:absolute; right:0; top:50%; transform:translateY(-50%); }
@media (orientation: landscape) {
  body.sd-touch #a3game-viewport { bottom:0; left:var(--sd-pad-w); }
  body.sd-touch #a3game-hud { left:calc(var(--sd-pad-w) + env(safe-area-inset-left)); }
  .sd-pad { top:0; right:auto; height:auto; width:var(--sd-pad-w); border-top:none;
    border-right:1px solid rgba(53,224,255,.45); padding-left:env(safe-area-inset-left); }
  body.sd-touch .sd-tools { bottom:14px; flex-direction:row; }
}
`;

export class TouchStick {
  /**
   * @param {{onTouch?: () => void, radius?: number}} [options]
   *        `onTouch` fires on the first touch anywhere, so hybrid
   *        devices switch to the touch layout when a finger is used.
   */
  constructor({ onTouch, radius = 60 } = {}) {
    this.radius = radius;
    this.pointerId = null;
    this.origin = { x: 0, y: 0 };
    this.vector = { x: 0, y: 0 };
    /** True once any touch has been seen; the UI swaps its hints. */
    this.used = false;

    this.style = document.createElement('style');
    this.style.textContent = STYLE;
    document.head.appendChild(this.style);
    this.pad = document.createElement('div');
    this.pad.className = 'sd-pad';
    this.pad.innerHTML = `<div class="sd-pad-hint">在此区域 <b>按住拖动</b> 控制飞船</div>
      <div class="sd-pad-sub">轻推 = 慢速微调 · 松手即停</div>`;
    this.base = document.createElement('div');
    this.base.className = 'sd-stick idle';
    this.base.innerHTML = '<i></i><s></s><u></u>';
    this.knob = this.base.querySelector('i');
    this.pad.appendChild(this.base);
    document.body.appendChild(this.pad);

    this.onAnyTouch = (event) => {
      if (event.pointerType === 'mouse') return;
      if (!this.used) {
        this.used = true;
        this.setEnabled(true);
        onTouch?.();
      }
    };
    globalThis.addEventListener('pointerdown', this.onAnyTouch, true);

    this.onDown = (event) => {
      if (event.pointerType === 'mouse' || this.pointerId !== null) return;
      this.pointerId = event.pointerId;
      this.origin = this.#clampToPad(event.clientX, event.clientY);
      this.vector = { x: 0, y: 0 };
      this.base.classList.remove('idle');
      this.pad.setPointerCapture?.(event.pointerId);
      this.onMove(event);
      event.preventDefault();
    };
    this.onMove = (event) => {
      if (event.pointerId !== this.pointerId) return;
      let dx = event.clientX - this.origin.x;
      let dy = event.clientY - this.origin.y;
      const length = Math.hypot(dx, dy);
      if (length > this.radius) {
        // Drag past the rim pulls the stick along, so the thumb never
        // runs out of room.
        const excess = length - this.radius;
        this.origin = this.#clampToPad(
          this.origin.x + (dx / length) * excess,
          this.origin.y + (dy / length) * excess,
        );
        dx = event.clientX - this.origin.x;
        dy = event.clientY - this.origin.y;
        const l = Math.hypot(dx, dy);
        if (l > this.radius) {
          dx = (dx / l) * this.radius;
          dy = (dy / l) * this.radius;
        }
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
      this.#rest();
    };
    this.pad.addEventListener('pointerdown', this.onDown);
    this.pad.addEventListener('pointermove', this.onMove);
    this.pad.addEventListener('pointerup', this.onUp);
    this.pad.addEventListener('pointercancel', this.onUp);
    this.onResize = () => {
      if (this.pointerId === null) this.#rest();
    };
    globalThis.addEventListener('resize', this.onResize);
  }

  /** Show or hide the pad; the viewport shrinks or grows to match. */
  setEnabled(enabled) {
    document.body.classList.toggle('sd-touch', Boolean(enabled));
    globalThis.dispatchEvent?.(new Event('resize'));
    this.#rest();
  }

  /** Keep the stick centre far enough inside the pad to stay visible. */
  #clampToPad(x, y) {
    const rect = this.pad.getBoundingClientRect();
    const inset = Math.min(this.radius, rect.width / 2, rect.height / 2);
    return {
      x: Math.min(rect.right - inset, Math.max(rect.left + inset, x)),
      y: Math.min(rect.bottom - inset, Math.max(rect.top + inset, y)),
    };
  }

  /** Idle stick sits in the middle of the pad as a visual cue. */
  #rest() {
    const rect = this.pad.getBoundingClientRect();
    this.origin = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 + 6 };
    this.base.classList.add('idle');
    this.#draw(0, 0);
  }

  #draw(dx, dy) {
    const rect = this.pad.getBoundingClientRect();
    this.base.style.left = `${this.origin.x - rect.left}px`;
    this.base.style.top = `${this.origin.y - rect.top}px`;
    this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
  }

  get active() {
    return this.pointerId !== null;
  }

  dispose() {
    globalThis.removeEventListener('pointerdown', this.onAnyTouch, true);
    globalThis.removeEventListener('resize', this.onResize);
    this.pad.remove();
    this.style.remove();
    document.body.classList.remove('sd-touch');
  }
}

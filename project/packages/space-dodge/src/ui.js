/**
 * Space Dodge — HUD and menu screens.
 *
 * UI reads the Mechanic contract (state + events) and invokes commands;
 * it owns no gameplay state.
 */

import { A3GameHudLayer } from '@a3game/playable';
import { BuffType, SPACE_DODGE_CONFIG, SpaceDodgePhase, HazardType } from './rules.js';

const BUFF_UI = {
  [BuffType.SHIELD]: { label: '🛡 护盾', color: '#4dff9a', toast: '🛡 护盾 · 抵挡一次撞击' },
  [BuffType.SLOW]: { label: '🐢 时缓 ×0.5', color: '#6fb8ff', toast: '🐢 时间减缓 ×0.5' },
  [BuffType.OVERCLOCK]: { label: '⚡ 超频 ×1.6', color: '#ffa51f', toast: '⚡ 超频 ×1.6 · 计时加速！' },
};

const KILLER_NAMES = {
  [HazardType.METEOR_SMALL]: '小陨石',
  [HazardType.METEOR_MEDIUM]: '中陨石',
  [HazardType.METEOR_LARGE]: '巨型陨石',
  [HazardType.MISSILE]: '追踪导弹',
};

const MILESTONE_TEXT = {
  10: '10 秒 · 热身结束',
  20: '20 秒 · 还差一点！',
  30: '30 秒！你是真男人！',
  45: '45 秒 · 太空传说',
  60: '60 秒 · 不可思议',
  90: '90 秒 · 神',
  120: '120 秒 · 超越神',
};

const STYLE = `
.sd-overlay { position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
  pointer-events:none; font-family: "PingFang SC","Microsoft YaHei",system-ui,sans-serif; color:#e8f4ff; }
.sd-card { pointer-events:auto; min-width:420px; max-width:560px; padding:28px 36px; border-radius:14px;
  background:rgba(8,14,34,.82); border:1px solid rgba(61,123,255,.55); box-shadow:0 0 40px rgba(53,224,255,.18);
  text-align:center; backdrop-filter: blur(4px); }
.sd-title { font-size:40px; font-weight:800; letter-spacing:2px; margin:0 0 6px;
  background:linear-gradient(90deg,#35e0ff,#9b8cff); -webkit-background-clip:text; background-clip:text; color:transparent; }
.sd-sub { font-size:15px; opacity:.8; margin:0 0 18px; }
.sd-big { font-size:56px; font-weight:800; margin:6px 0; font-variant-numeric: tabular-nums; }
.sd-good { color:#7dffb2; } .sd-bad { color:#ff7a7a; } .sd-gold { color:#ffd23b; }
.sd-row { font-size:15px; margin:4px 0; opacity:.92; }
.sd-legend { display:flex; gap:14px; justify-content:center; flex-wrap:wrap; font-size:13px; margin:12px 0 4px; opacity:.9; }
.sd-dot { display:inline-block; width:10px; height:10px; border-radius:50%; margin-right:5px; vertical-align:middle; }
.sd-btn { pointer-events:auto; margin-top:16px; padding:10px 28px; font-size:17px; font-weight:700; border-radius:8px;
  border:none; cursor:pointer; color:#04101f; background:linear-gradient(90deg,#35e0ff,#7fa8ff); }
.sd-btn.secondary { background:transparent; color:#9fb6e8; border:1px solid #3d5fa8; margin-left:10px; font-weight:500; }
.sd-board { width:100%; border-collapse:collapse; margin-top:12px; font-size:14px; font-variant-numeric: tabular-nums; }
.sd-board td, .sd-board th { padding:3px 6px; border-bottom:1px solid rgba(61,123,255,.18); }
.sd-board th { opacity:.6; font-weight:500; }
.sd-board tr.me td { color:#ffd23b; font-weight:700; }
.sd-hint { font-size:13px; opacity:.6; margin-top:10px; }
.sd-toast { position:absolute; top:22%; left:50%; transform:translateX(-50%); font-size:30px; font-weight:800;
  color:#ffd23b; text-shadow:0 0 18px rgba(255,210,59,.6); pointer-events:none; transition:opacity .5s;
  font-family: "PingFang SC","Microsoft YaHei",system-ui,sans-serif; white-space:nowrap; }
.sd-timer { font-size:44px !important; font-weight:800; font-variant-numeric: tabular-nums; letter-spacing:1px; }
.sd-timer.goal { color:#7dffb2; }
.sd-tint { position:absolute; inset:0; pointer-events:none; transition: box-shadow .3s; }
.sd-scale { font-size:18px; font-weight:800; margin-left:8px; vertical-align:middle; }
.sd-buff-shield .a3game-hud-bar > i { background:#4dff9a !important; }
.sd-buff-slow .a3game-hud-bar > i { background:#6fb8ff !important; }
.sd-buff-overclock .a3game-hud-bar > i { background:#ffa51f !important; }
.sd-warn { position:absolute; inset:0; pointer-events:none; box-shadow: inset 0 0 90px rgba(255,40,40,.0); transition: box-shadow .15s; }
.sd-card { box-sizing:border-box; min-width:min(420px, 94vw); max-width:min(560px, 94vw); max-height:94vh; overflow-y:auto; }
.sd-tools { position:absolute; right:14px; bottom:14px; display:flex; gap:8px; pointer-events:auto; }
.sd-tool { width:44px; height:44px; border-radius:50%; border:1px solid rgba(61,123,255,.6); background:rgba(8,14,34,.7);
  color:#e8f4ff; font-size:20px; cursor:pointer; display:flex; align-items:center; justify-content:center; padding:0; }
.sd-tool:active { transform:scale(.92); }
.sd-copied { font-size:13px; color:#7dffb2; margin-top:6px; min-height:18px; }
@media (max-width: 640px), (max-height: 520px) {
  .sd-card { padding:16px 18px; }
  .sd-title { font-size:28px; }
  .sd-big { font-size:40px; }
  .sd-sub, .sd-row { font-size:13px; }
  .sd-legend { font-size:12px; gap:8px; margin:8px 0 2px; }
  .sd-btn { margin-top:10px; padding:9px 20px; font-size:15px; }
  .sd-board { font-size:12px; margin-top:8px; }
  .sd-toast { font-size:20px; top:18%; }
  .sd-timer { font-size:32px !important; }
  .a3game-hud-slot[data-a3game-anchor="bottom-left"] { display:none; }
  .a3game-hud-widget { font-size:12px; }
}
`;

/** Touch-first devices get touch hints; a mouse or keyboard keeps key hints. */
const COARSE_POINTER = Boolean(globalThis.matchMedia?.('(pointer: coarse)').matches);

function formatSeconds(value) {
  return `${Number(value).toFixed(2)} s`;
}

export class SpaceDodgeUi {
  /**
   * @param {{hudContainer: string | HTMLElement, simulation: object, host: object}} options
   */
  constructor({ hudContainer, simulation, host, audio }) {
    this.simulation = simulation;
    this.host = host;
    this.audio = audio;
    this.touch = COARSE_POINTER;
    this.hud = new A3GameHudLayer({ container: hudContainer });
    this.container = this.hud.container;

    const style = document.createElement('style');
    style.textContent = STYLE;
    this.container.appendChild(style);
    this.style = style;

    this.hud.addText('timer', { anchor: 'top-center', value: formatSeconds(0), className: 'sd-timer' });
    this.hud.addBar('goal', { anchor: 'top-center', label: '目标 30 秒', value: 0 });
    this.hud.addText('best', { anchor: 'top-right', value: '最佳 0.00 s' });
    this.hud.addText('level', { anchor: 'top-left', value: '难度 Lv.1' });
    this.hud.addText('near', { anchor: 'top-left', value: '擦弹 0' });
    for (const [buff, ui] of Object.entries(BUFF_UI)) {
      const name = `buff_${buff}`;
      this.hud.addBar(name, { anchor: 'top-left', label: ui.label, value: 0, className: `sd-buff-${buff}` });
      this.hud.setVisible(name, false);
    }
    this.hud.addPanel('controls', {
      anchor: 'bottom-left',
      value: 'WASD / 方向键 移动 · Shift 精准慢速 · P 暂停 · R 重开',
    });

    this.tint = document.createElement('div');
    this.tint.className = 'sd-tint';
    this.container.appendChild(this.tint);

    this.warn = document.createElement('div');
    this.warn.className = 'sd-warn';
    this.container.appendChild(this.warn);

    this.toast = document.createElement('div');
    this.toast.className = 'sd-toast';
    this.toast.style.opacity = '0';
    this.container.appendChild(this.toast);
    this.toastTimer = 0;
    this.resultDelay = 0;

    this.overlay = document.createElement('div');
    this.overlay.className = 'sd-overlay';
    this.overlay.dataset.screen = '';
    this.container.appendChild(this.overlay);
    this.overlay.addEventListener('click', (event) => {
      const action = event.target?.closest?.('[data-action]')?.dataset?.action;
      if (action === 'start') simulation.phase === SpaceDodgePhase.PAUSED ? simulation.togglePause() : simulation.start();
      if (action === 'restart') simulation.restart();
      if (action === 'clear' && globalThis.confirm?.('确定清空所有本机记录？') !== false) simulation.clearRecords();
      if (action === 'share') {
        this.#share();
        return;
      }
      this.#renderScreen();
    });

    // Always-on buttons: needed on touch screens, handy with a mouse.
    this.tools = document.createElement('div');
    this.tools.className = 'sd-tools';
    this.tools.innerHTML = `<button class="sd-tool" data-tool="mute" title="静音 (M)"></button>
      <button class="sd-tool" data-tool="pause" title="暂停 (P)">⏸</button>`;
    this.container.appendChild(this.tools);
    this.tools.addEventListener('click', (event) => {
      const tool = event.target?.closest?.('[data-tool]')?.dataset?.tool;
      if (tool === 'mute') this.toggleMute();
      if (tool === 'pause') simulation.togglePause();
      event.target?.closest?.('button')?.blur();
    });
    this.#renderTools();

    this.unsubscribe = simulation.onEvent((event) => this.#onEvent(event));
    this.#renderScreen();
  }

  #onEvent(event) {
    if (event.type === 'pickup_collected') {
      this.#showToast(BUFF_UI[event.buff]?.toast ?? event.buff, 1.4);
    } else if (event.type === 'shield_blocked') {
      this.#showToast('🛡 护盾抵挡！', 1);
    } else if (event.type === 'milestone') {
      this.#showToast(MILESTONE_TEXT[event.seconds] ?? `${event.seconds} 秒`);
    } else if (event.type === 'difficulty_up') {
      this.#showToast(`难度提升 · Lv.${event.level}`, 1.2);
    } else if (event.type === 'meteor_shower') {
      this.#showToast('⚠ 流星雨来袭', 1.2);
    }
    if (event.type === 'player_destroyed') {
      // Let the explosion play before the result card covers the arena.
      this.resultDelay = 0.9;
    } else if (['run_started', 'paused', 'resumed', 'records_cleared'].includes(event.type)) {
      this.resultDelay = 0;
      this.#renderScreen();
    }
    if (['run_started', 'paused', 'resumed', 'player_destroyed'].includes(event.type)) this.#renderTools();
  }

  toggleMute() {
    this.audio?.toggleMuted();
    this.#renderTools();
    this.#showToast(this.audio?.muted ? '🔇 已静音' : '🔊 声音开启', 0.9);
  }

  /** The touch flag flips on at the first touch, even on hybrid devices. */
  setTouchMode(touch) {
    if (this.touch === touch) return;
    this.touch = touch;
    this.#renderScreen();
  }

  #renderTools() {
    const mute = this.tools.querySelector('[data-tool="mute"]');
    mute.textContent = this.audio?.muted ? '🔇' : '🔊';
    const pause = this.tools.querySelector('[data-tool="pause"]');
    pause.style.display = this.simulation.phase === SpaceDodgePhase.PLAYING ? 'flex' : 'none';
  }

  async #share() {
    const run = this.simulation.lastRun;
    if (!run) return;
    const url = globalThis.location?.href?.split('#')[0] ?? '';
    const text = run.goalReached
      ? `我在「是男人就坚持30秒 · 3D太空版」坚持了 ${run.seconds.toFixed(2)} 秒，擦弹 ${run.nearMisses} 次，你能超过我吗？`
      : `我在「是男人就坚持30秒 · 3D太空版」只坚持了 ${run.seconds.toFixed(2)} 秒……你来试试？`;
    const note = this.overlay.querySelector('.sd-copied');
    try {
      if (navigator.share && this.touch) {
        await navigator.share({ title: '是男人就坚持30秒', text, url });
        return;
      }
      await navigator.clipboard.writeText(`${text} ${url}`);
      if (note) note.textContent = '✔ 战绩已复制，去粘贴给朋友吧';
    } catch {
      if (note) note.textContent = '复制失败，请手动截图分享';
    }
  }

  #showToast(text, seconds = 1.8) {
    this.toast.textContent = text;
    this.toast.style.opacity = '1';
    this.toastTimer = seconds;
  }

  /** Refresh live widgets; call once per tick. */
  update(dt) {
    const state = this.simulation.getState();
    this.hud.setValues({
      timer: formatSeconds(state.elapsedSeconds),
      goal: Math.min(1, state.elapsedSeconds / state.goalSeconds),
      best: `最佳 ${formatSeconds(state.bestSeconds)}`,
      level: `难度 Lv.${state.difficultyLevel}`,
      near: `擦弹 ${state.nearMisses}`,
    });
    const timerElement = this.container.querySelector('.sd-timer');
    timerElement?.classList.toggle('goal', state.elapsedSeconds >= state.goalSeconds);
    for (const buff of Object.values(BuffType)) {
      const remaining = state.buffs[buff] ?? 0;
      const name = `buff_${buff}`;
      const active = remaining > 0 && state.phase !== SpaceDodgePhase.GAME_OVER;
      this.hud.setVisible(name, active);
      if (active) this.hud.setValue(name, remaining / SPACE_DODGE_CONFIG.buffs[buff].duration);
    }
    // Time-flow indicator next to the clock and a coloured screen edge.
    const timerEl = this.container.querySelector('.sd-timer');
    if (timerEl) {
      let badge = timerEl.querySelector('.sd-scale');
      const scaled = Math.abs(state.timeScale - 1) > 0.01 && state.phase === SpaceDodgePhase.PLAYING;
      if (scaled) {
        if (!badge) {
          badge = document.createElement('span');
          badge.className = 'sd-scale';
        }
        badge.textContent = `×${state.timeScale.toFixed(1)}`;
        badge.style.color = state.timeScale > 1 ? '#ffa51f' : '#6fb8ff';
        if (badge.parentNode !== timerEl) timerEl.appendChild(badge);
      } else {
        badge?.remove();
      }
    }
    const tint = state.phase !== SpaceDodgePhase.PLAYING
      ? 'none'
      : state.timeScale > 1.01
        ? 'inset 0 0 120px rgba(255,165,31,.35)'
        : state.timeScale < 0.99
          ? 'inset 0 0 120px rgba(111,184,255,.35)'
          : 'none';
    this.tint.style.boxShadow = tint;
    const danger = state.phase === SpaceDodgePhase.PLAYING && state.missileWarnings > 0;
    this.warn.style.boxShadow = danger ? 'inset 0 0 90px rgba(255,40,40,.45)' : 'inset 0 0 90px rgba(255,40,40,0)';
    if (this.resultDelay > 0) {
      this.resultDelay -= dt;
      if (this.resultDelay <= 0) this.#renderScreen();
    }
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.toast.style.opacity = '0';
    }
  }

  #legend() {
    const items = [
      ['#35e0ff', '你的飞船'], ['#c9a27a', '小陨石·快'], ['#9a6b4f', '中陨石'],
      ['#6f7483', '巨型陨石·慢'], ['#ff3b3b', '追踪导弹'],
      ['#4dff9a', '护盾'], ['#6fb8ff', '时缓'], ['#ffa51f', '超频'],
    ];
    return `<div class="sd-legend">${items
      .map(([c, t]) => `<span><span class="sd-dot" style="background:${c}"></span>${t}</span>`)
      .join('')}</div>`;
  }

  #board(state, highlightRank = 0) {
    if (!state.records.length) return '<div class="sd-hint">还没有记录，开始第一局吧</div>';
    const rows = state.records
      .slice(0, 5)
      .map((r) => {
        const date = new Date(r.at);
        const when = `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
        return `<tr class="${r.rank === highlightRank ? 'me' : ''}"><td>#${r.rank}</td><td>${formatSeconds(r.seconds)}</td><td>擦弹 ${r.nearMisses}</td><td>${when}</td></tr>`;
      })
      .join('');
    return `<table class="sd-board"><tr><th>排名</th><th>存活</th><th>擦弹</th><th>时间</th></tr>${rows}</table>
      <div class="sd-hint">共 ${state.totalRuns} 局 · 记录自动保存在本机</div>`;
  }

  #renderScreen() {
    const state = this.simulation.getState();
    let html = '';
    let screen = '';
    if (state.phase === SpaceDodgePhase.READY) {
      screen = 'title';
      html = `<div class="sd-card">
        <h1 class="sd-title">是男人就坚持30秒</h1>
        <p class="sd-sub">SPACE DODGE 3D · 驾驶飞船躲开陨石与追踪导弹</p>
        ${this.#legend()}
        ${this.touch
          ? '<div class="sd-row">在屏幕任意位置按住拖动 = 虚拟摇杆，轻推慢速微调</div>'
          : '<div class="sd-row">WASD / 方向键 移动 · 按住 Shift 精准慢速 · M 静音 · 支持手柄</div>'}
        <div class="sd-row">红色闪烁圈 = 导弹即将发射，横向急转可甩掉它</div>
        <div class="sd-row">道具：🛡 护盾挡一次 · 🐢 时缓 ×0.5 · ⚡ 超频 ×1.6（计时更快，弹幕也更快）</div>
        <button class="sd-btn" data-action="start">开始游戏${this.touch ? '' : '（空格）'}</button>
        ${this.#board(state)}
      </div>`;
    } else if (state.phase === SpaceDodgePhase.PAUSED) {
      screen = 'paused';
      html = `<div class="sd-card"><h1 class="sd-title">暂停</h1>
        <div class="sd-big">${formatSeconds(state.elapsedSeconds)}</div>
        <button class="sd-btn" data-action="start">继续${this.touch ? '' : '（P / 空格）'}</button>
        <button class="sd-btn secondary" data-action="restart">重新开始</button></div>`;
    } else if (state.phase === SpaceDodgePhase.GAME_OVER && state.lastRun) {
      screen = 'game_over';
      const run = state.lastRun;
      const verdict = run.goalReached
        ? '<div class="sd-row sd-good">✔ 坚持过 30 秒 —— 你是真男人！</div>'
        : `<div class="sd-row sd-bad">距离 30 秒还差 ${(30 - run.seconds).toFixed(2)} 秒</div>`;
      html = `<div class="sd-card">
        <h1 class="sd-title">飞船被击毁</h1>
        <div class="sd-big ${run.newBest ? 'sd-gold' : ''}">${formatSeconds(run.seconds)}</div>
        ${run.newBest ? '<div class="sd-row sd-gold">★ 新纪录！</div>' : ''}
        ${verdict}
        <div class="sd-row">击毁你的：${KILLER_NAMES[run.killedBy] ?? run.killedBy} · 擦弹 ${run.nearMisses} · 躲过 ${run.dodged} · 道具 ${run.buffsCollected ?? 0}</div>
        <button class="sd-btn" data-action="start">再来一局${this.touch ? '' : '（空格）'}</button>
        <button class="sd-btn secondary" data-action="share">分享战绩</button>
        <button class="sd-btn secondary" data-action="clear">清空记录</button>
        <div class="sd-copied"></div>
        ${this.#board(state, run.rank)}
      </div>`;
    }
    this.overlay.innerHTML = html;
    this.overlay.dataset.screen = screen;
    const inRun = state.phase === SpaceDodgePhase.PLAYING;
    this.hud.setVisible('controls', inRun || state.phase === SpaceDodgePhase.PAUSED);
  }

  getState() {
    return { screen: this.overlay.dataset.screen, hud: this.hud.getState() };
  }

  dispose() {
    this.unsubscribe();
    this.overlay.remove();
    this.tools.remove();
    this.toast.remove();
    this.warn.remove();
    this.tint.remove();
    this.style.remove();
    this.hud.dispose();
  }
}

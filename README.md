# 是男人就坚持30秒 · Space Dodge 3D

3D 太空版「是男人就坚持30秒」。驾驶飞船躲避陨石、流星雨和追踪导弹，拾取道具，挑战你的存活极限。

**▶ 在线游玩：https://yourlin.github.io/space-dodge-30s/**

## 玩法

- **目标**：撑过 30 秒——然后继续挑战 45 / 60 / 90 / 120 秒里程碑
- **障碍物**：小陨石（快、瞄准你）· 中陨石 · 巨型陨石（慢速移动墙）· 15 秒后的流星雨扇形弹幕 · 追踪导弹（红圈预警 0.9 秒后发射，燃料 2.8 秒，横向急转可甩掉）
- **道具**：🛡 护盾（挡一次撞击）· 🐢 时缓 ×0.5 · ⚡ 超频 ×1.6（计时更快，弹幕也更快）
- **记录**：每局自动保存到本机前 10 排行榜，可一键分享战绩

## 操作

| 设备 | 移动 | 精准慢速 | 开始 / 继续 | 暂停 | 其它 |
|---|---|---|---|---|---|
| 键盘 | WASD / 方向键 | 按住 Shift | 空格 / 回车 | P / Esc | R 重开 · M 静音 |
| 手柄 | 左摇杆 / 十字键 | 肩键 / 扳机 | A | Start | |
| 触屏 | 在控制区按住拖动（竖屏在底部，横屏在左侧） | 轻推 | 点按钮 | ⏸ 按钮 | 🔊 按钮 |

手机竖屏时竞技场会自动旋转为纵向，横屏/桌面为横向。

## 技术

- three.js（r185）+ Vite，零外部美术/音频素材：模型为程序化几何体，音效与背景音乐全部由 Web Audio 实时合成（音乐节奏随时缓/超频变化）
- 规则层 `project/packages/space-dodge/src/rules.js` 为纯模拟（无 DOM / THREE），带确定性随机数，可单测与离线平衡（`tools/balance.mjs`）
- 基于 [GameFactory-3A](https://github.com/OpenDCAI/GameFactory-3A) 的 `@a3game/playable` 运行时生成

## 本地运行

```bash
cd project
npm ci
npm run dev          # http://127.0.0.1:5173
npx vitest run packages/space-dodge   # 单元测试
npm run build        # 产物在 project/dist
```

推送到 `main` 后，GitHub Actions（`.github/workflows/pages.yml`）会自动测试、构建并发布到 GitHub Pages。

## License

Apache-2.0（含源自 GameFactory-3A 的运行时代码）。

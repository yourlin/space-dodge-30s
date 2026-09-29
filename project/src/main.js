// 3AGameFactory three.js host entry point: boots the Space Dodge package.
import { startSpaceDodge } from '../packages/space-dodge/src/index.js';

const loading = document.getElementById('sd-loading');
try {
  await startSpaceDodge();
  if (loading) {
    loading.style.opacity = '0';
    setTimeout(() => loading.remove(), 400);
  }
} catch (error) {
  if (loading) loading.innerHTML = `<b>加载失败</b><span>${String(error?.message ?? error)}</span><span>请使用最新版 Chrome / Edge / Safari 打开</span>`;
  throw error;
}

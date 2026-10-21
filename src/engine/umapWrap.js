/* UMAP 包装（umap-js + 种子化随机源）——**只被 embed.worker 静态引入**：
   主包不碰此模块（umap-js 只进 Worker 块）；Worker 的 iife 构建不支持动态 import，故拆分为独立模块。
   🔴 确定性：random 注入 mulberry32 种子链。 */
import { UMAP } from 'umap-js';
import { mulberry32 } from './ops.js';

/* 输入 = preReduce 的 50 维 PCA 空间；返回 { proj, summary }；onProgress(pct 0–100) */
export async function umapEmbedAsync(flat, n, d, opts = {}, onProgress = () => {}) {
  const { seed = 42, nNeighbors = 15, minDist = 0.1, nEpochs = 400 } = opts;
  const data = new Array(n);
  for (let i = 0; i < n; i++) {
    const row = new Array(d);
    for (let t = 0; t < d; t++) row[t] = flat[i * d + t];
    data[i] = row;
  }
  const umap = new UMAP({ nComponents: 2, nNeighbors, minDist, nEpochs, random: mulberry32(seed) });
  const emb = await umap.fitAsync(data, (epoch) => onProgress(5 + (epoch / nEpochs) * 95));
  onProgress(100);
  return { proj: emb.map(([x, y]) => ({ x, y })), summary: { n, nNeighbors, minDist, nEpochs, seed } };
}

/* 投影 Worker（列1 结构面）：在后台线程算 t-SNE / UMAP——主线程只收进度与结果。
   消息：{ method: 'tsne'|'umap', values: Float32Array(n*L), n, L, seed }
   回信：{ type:'progress', pct } | { type:'done', proj } | { type:'error', message } */
import { preReduce, tsneEmbed } from '../engine/embed.js';
import { umapEmbedAsync } from '../engine/umapWrap.js';

self.onmessage = async (e) => {
  const { method, values, n, L, seed } = e.data;
  const post = (pct) => self.postMessage({ type: 'progress', pct: Math.round(pct) });
  try {
    const samples = new Array(n);
    for (let i = 0; i < n; i++) samples[i] = { values: values.subarray(i * L, (i + 1) * L) };
    post(1);
    const { flat, d, mean, comps } = preReduce(samples, 50);
    post(method === 'tsne' ? 2 : 5);
    let r;
    if (method === 'tsne') {
      r = tsneEmbed(flat, n, d, { seed }, (pct) => post(pct));
    } else if (method === 'umap') {
      r = await umapEmbedAsync(flat, n, d, { seed }, (pct) => post(pct));
    } else {
      throw new Error(`未知方法：${method}`);
    }
    /* 回传投影基（mean/comps/flat）——主线程的 out-of-sample kNN 在**同一 50 维空间**里做（2026-10-16 性能修复） */
    self.postMessage({ type: 'done', proj: r.proj, summary: r.summary, pca: { mean, comps, flat, d } });
  } catch (err) {
    self.postMessage({ type: 'error', message: String(err?.message ?? err) });
  }
};

/* 非线性投影引擎（列1 结构面 · 2026-10-14）：
     · t-SNE：本文实现（kNN 稀疏吸引 + 负采样排斥 · 早期夸张 · PCA 初始化）——近似变体，披露见 UI tooltip；
     · UMAP：见 `umapWrap.js`（umap-js + 种子化——只被 Worker 静态引入，主包不碰）。
   🔴 确定性：全部随机源 = mulberry32 种子链；两法均先在 50 维 PCA 空间内计算（加速，口径与 PCA 基底同源=列中心化）。
   🔴 输入约定与 PCA 基底一致（列中心化），保证"三种方法作用于同一距离空间"的可比口径。 */
import { mulberry32 } from './ops.js';
import { pcaK } from './pca.js';

/* 50 维 PCA 预降维（列中心化） → 扁平 Float64Array（n×d）；
   同时回传可迁移的投影基（mean + comps 叠加为 d×L）——供主线程做**同空间**的 out-of-sample 近似。 */
export function preReduce(samples, k = 50) {
  const r = pcaK(samples, k);
  const n = samples.length, d = r.comps.length, L = samples[0].values.length;
  const flat = new Float64Array(n * d);
  r.proj.forEach((p, i) => { for (let j = 0; j < d; j++) flat[i * d + j] = p[j]; });
  const comps = new Float64Array(d * L);
  r.comps.forEach((c, j) => comps.set(c.v, j * L));
  return { flat, n, d, mean: r.mean, comps };
}

/* t-SNE（近邻近似）：返回 { proj: [{x,y}] }；onProgress(pct 0–100) */
export function tsneEmbed(flat, n, d, opts = {}, onProgress = () => {}) {
  const { seed = 42, perplexity = 30, iters = 320 } = opts;
  const k = Math.min(n - 1, Math.max(5, Math.round(perplexity * 2)));
  const m = 32;                                          // 每点每轮负样本数
  const rng = mulberry32(seed);

  /* ① kNN（暴力，d≈50） */
  const nbr = new Int32Array(n * k);
  const nd2 = new Float64Array(n * k);
  for (let i = 0; i < n; i++) {
    const off = i * k;
    nd2.fill(Infinity, off, off + k);
    const io = i * d;
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      let dd = 0;
      const jo = j * d;
      for (let t = 0; t < d; t++) { const q = flat[io + t] - flat[jo + t]; dd += q * q; }
      if (dd < nd2[off + k - 1]) {
        let p = k - 1;
        while (p > 0 && nd2[off + p - 1] > dd) { nd2[off + p] = nd2[off + p - 1]; nbr[off + p] = nbr[off + p - 1]; p--; }
        nd2[off + p] = dd; nbr[off + p] = j;
      }
    }
    if ((i & 255) === 0) onProgress((i / n) * 30);
  }

  /* ② P 矩阵：每点 σ 二分至目标 perplexity → 对称化稀疏存（key = min*n+max） */
  const P = new Map();
  for (let i = 0; i < n; i++) {
    const off = i * k;
    let lo = 1e-8, hi = 1e4, sigma = 1;
    for (let it = 0; it < 50; it++) {
      sigma = (lo + hi) / 2;
      const inv = 1 / (2 * sigma * sigma);
      let s = 0;
      for (let t = 0; t < k; t++) s += Math.exp(-nd2[off + t] * inv);
      if (s > perplexity) hi = sigma; else lo = sigma;
    }
    const inv = 1 / (2 * sigma * sigma);
    let z = 0;
    const pw = new Float64Array(k);
    for (let t = 0; t < k; t++) { pw[t] = Math.exp(-nd2[off + t] * inv); z += pw[t]; }
    z = z || 1;
    for (let t = 0; t < k; t++) {
      const j = nbr[off + t];
      const key = Math.min(i, j) * n + Math.max(i, j);
      P.set(key, (P.get(key) ?? 0) + pw[t] / z);
    }
    if ((i & 255) === 0) onProgress(30 + (i / n) * 10);
  }
  const sup = Array.from({ length: n }, () => []);
  for (const [key, v] of P) {
    const a = Math.floor(key / n), b = key % n;
    const p = v / (2 * n);
    sup[a].push({ j: b, p });
    sup[b].push({ j: a, p });
  }
  onProgress(42);

  /* ③ 初始化：PCA 前两维 × sklearn-pca-init 同款缩放 */
  const Y = new Float64Array(n * 2);
  const iY = new Float64Array(n * 2);
  let s0 = 0, s1 = 0;
  for (let i = 0; i < n; i++) { s0 += flat[i * d]; s1 += flat[i * d + 1]; }
  s0 /= n; s1 /= n;
  let sd = 0;
  for (let i = 0; i < n; i++) { const a = flat[i * d] - s0, b = flat[i * d + 1] - s1; sd += a * a + b * b; }
  sd = Math.sqrt(sd / (2 * n)) || 1;
  const sc = 1e-4 / sd;
  for (let i = 0; i < n; i++) { Y[i * 2] = (flat[i * d] - s0) * sc; Y[i * 2 + 1] = (flat[i * d + 1] - s1) * sc; }

  /* ④ 梯度下降（动量 + 早期夸张；逐轮中心化防漂移） */
  const lr = Math.max(200, n / 12);
  const negBuf = new Int32Array(n * m);
  const grad = new Float64Array(n * 2);
  for (let iter = 0; iter < iters; iter++) {
    const exag = iter < iters * 0.25 ? 4 : 1;
    for (let i = 0; i < n; i++) {
      for (let q = 0; q < m; q++) {
        const j = Math.floor(rng() * n);
        negBuf[i * m + q] = j === i ? (j + 1) % n : j;
      }
    }
    let Z = 0;
    for (let i = 0; i < n; i++) {
      const ix = i * 2;
      for (const e of sup[i]) { const dx = Y[ix] - Y[e.j * 2], dy = Y[ix + 1] - Y[e.j * 2 + 1]; Z += 1 / (1 + dx * dx + dy * dy); }
      for (let q = 0; q < m; q++) {
        const j = negBuf[i * m + q];
        const dx = Y[ix] - Y[j * 2], dy = Y[ix + 1] - Y[j * 2 + 1];
        Z += (n / m) * (1 / (1 + dx * dx + dy * dy));
      }
    }
    Z = Z || 1;
    grad.fill(0);
    for (let i = 0; i < n; i++) {
      const ix = i * 2;
      let gx = 0, gy = 0;
      for (const e of sup[i]) {
        const dx = Y[ix] - Y[e.j * 2], dy = Y[ix + 1] - Y[e.j * 2 + 1];
        const w = 1 / (1 + dx * dx + dy * dy);
        const g = 4 * (exag * e.p - w / Z) * w;
        gx += g * dx; gy += g * dy;
      }
      for (let q = 0; q < m; q++) {
        const j = negBuf[i * m + q];
        const dx = Y[ix] - Y[j * 2], dy = Y[ix + 1] - Y[j * 2 + 1];
        const w = 1 / (1 + dx * dx + dy * dy);
        const g = 4 * (-(n / m) * w / Z) * w;
        gx += g * dx; gy += g * dy;
      }
      grad[ix] = gx; grad[ix + 1] = gy;
    }
    const mom = iter < 250 ? 0.5 : 0.8;
    for (let i = 0; i < n * 2; i++) { iY[i] = mom * iY[i] - lr * grad[i]; Y[i] += iY[i]; }
    let mx = 0, my = 0;
    for (let i = 0; i < n; i++) { mx += Y[i * 2]; my += Y[i * 2 + 1]; }
    mx /= n; my /= n;
    for (let i = 0; i < n; i++) { Y[i * 2] -= mx; Y[i * 2 + 1] -= my; }
    if ((iter & 31) === 0) onProgress(42 + (iter / iters) * 58);
  }
  onProgress(100);
  const proj = new Array(n);
  for (let i = 0; i < n; i++) proj[i] = { x: Y[i * 2], y: Y[i * 2 + 1] };
  return { proj, summary: { n, k, m, iters, seed, perplexity } };
}

/* 新点投影（out-of-sample，两种非线性方法共用·披露为 kNN 加权近似）：
   找 k 近邻 → 以 1/(√d+ε) 权重取嵌入位置的加权平均。确定性、无随机。
   pca 参数（{ mean, comps, flat, d }，来自 preReduce）在场时：**在嵌入拟合的那个 50 维 PCA 空间里做 kNN**
   （更自洽，且 4865×50 比 4865×187 快 ~4×——2026-10-16 性能修复）；缺省则退回原始值空间（旧行为）。 */
export function makeKnnTransform(samples, proj, k = 10, pca = null) {
  const n = samples.length;
  if (!n) return () => ({ x: 0, y: 0 });
  const L = samples[0].values.length;
  const kk = Math.max(1, Math.min(k, n));
  /* 预建投影闭包：raw(L) → 50 维（中心化后点乘各主成分） */
  let toSpace = null;
  if (pca?.mean && pca?.comps && pca?.flat && pca?.d) {
    const { mean, comps, flat, d } = pca;
    toSpace = (values) => {
      const q = new Float64Array(d);
      for (let j = 0; j < d; j++) {
        let s = 0;
        const off = j * L;
        for (let t = 0; t < L; t++) s += (values[t] - mean[t]) * comps[off + t];
        q[j] = s;
      }
      return q;
    };
  }
  return (values) => {
    const best = new Float64Array(kk).fill(Infinity);
    const bidx = new Int32Array(kk).fill(0);
    let q = null, dim = L, flatRows = null;
    if (toSpace) { q = toSpace(values); dim = pca.d; flatRows = pca.flat; }
    for (let i = 0; i < n; i++) {
      let dd = 0;
      if (flatRows) {
        const off = i * dim;
        for (let t = 0; t < dim; t++) { const z = q[t] - flatRows[off + t]; dd += z * z; }
      } else {
        const sv = samples[i].values;
        for (let t = 0; t < dim; t++) { const z = values[t] - sv[t]; dd += z * z; }
      }
      if (dd < best[kk - 1]) {
        let p = kk - 1;
        while (p > 0 && best[p - 1] > dd) { best[p] = best[p - 1]; bidx[p] = bidx[p - 1]; p--; }
        best[p] = dd; bidx[p] = i;
      }
    }
    let sx = 0, sy = 0, sw = 0;
    for (let r = 0; r < kk; r++) {
      const w = 1 / (Math.sqrt(best[r]) + 1e-6);
      sx += w * proj[bidx[r]].x; sy += w * proj[bidx[r]].y; sw += w;
    }
    return { x: sx / sw, y: sy / sw };
  };
}

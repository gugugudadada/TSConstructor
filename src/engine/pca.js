/* PCA(中心化 → 协方差 → 对称 Jacobi 特征分解取前 k 主成分)
   ⚠ 复用自 v2 `src/engine/pca.js`（README D1：引擎/工具代码可直接复用——它们是工具，不是设计）。
   2026-10-06 原样复制（含 2026-09-23 的双重中心化修复）；确定性：初值固定、无随机。
   2026-10-14：泛化为 pcaK（前 k 主成分——供非线性投影的 50 维预降维）；pca2D 保持原契约。
   2026-10-20：修复协方差归一化——原实现把下三角又除了一次 n，得到非对称矩阵；
   改用"上三角镜像 → 全矩阵统一除 n"的对称协方差，并换成 Jacobi 特征分解。
   幂迭代的固定全 1 初值也一并移除：中心化数据的全 1 向量落在零空间，数值上不可靠。 */

export function dot(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }

/* 对称协方差矩阵：只累加上三角，再镜像到下三角，最后统一除以 n。 */
function covariance(samples, mean) {
  const n = samples.length;
  const L = mean.length;
  const cov = new Float64Array(L * L);
  for (const s of samples) {
    for (let i = 0; i < L; i++) {
      const xi = s.values[i] - mean[i];
      const base = i * L;
      for (let j = i; j < L; j++) cov[base + j] += xi * (s.values[j] - mean[j]);
    }
  }
  for (let i = 0; i < L; i++) {
    for (let j = i + 1; j < L; j++) cov[j * L + i] = cov[i * L + j];
  }
  const inv = 1 / Math.max(1, n);
  for (let i = 0; i < cov.length; i++) cov[i] *= inv;
  return cov;
}

/* 对称矩阵 Jacobi 特征分解。L 最大约 200，足够快且没有幂迭代的收敛/初值问题。 */
function jacobiEigen(cov, L) {
  const a = Float64Array.from(cov);
  const v = new Float64Array(L * L);
  for (let i = 0; i < L; i++) v[i * L + i] = 1;

  for (let sweep = 0; sweep < 30; sweep++) {
    let off = 0;
    for (let i = 0; i < L; i++) {
      for (let j = i + 1; j < L; j++) off += a[i * L + j] * a[i * L + j];
    }
    if (off < 1e-22) break;

    for (let p = 0; p < L - 1; p++) {
      for (let q = p + 1; q < L; q++) {
        const apq = a[p * L + q];
        if (Math.abs(apq) < 1e-18) continue;
        const app = a[p * L + p];
        const aqq = a[q * L + q];
        const tau = (aqq - app) / (2 * apq);
        const t = (tau >= 0 ? 1 : -1) / (Math.abs(tau) + Math.sqrt(1 + tau * tau));
        const c = 1 / Math.sqrt(1 + t * t);
        const s = t * c;

        for (let k = 0; k < L; k++) {
          if (k === p || k === q) continue;
          const akp = a[k * L + p];
          const akq = a[k * L + q];
          a[k * L + p] = c * akp - s * akq;
          a[k * L + q] = s * akp + c * akq;
          a[p * L + k] = a[k * L + p];
          a[q * L + k] = a[k * L + q];
        }
        a[p * L + p] = app - t * apq;
        a[q * L + q] = aqq + t * apq;
        a[p * L + q] = 0;
        a[q * L + p] = 0;

        for (let k = 0; k < L; k++) {
          const vkp = v[k * L + p];
          const vkq = v[k * L + q];
          v[k * L + p] = c * vkp - s * vkq;
          v[k * L + q] = s * vkp + c * vkq;
        }
      }
    }
  }

  const vals = new Float64Array(L);
  const vecs = new Float64Array(L * L);
  const order = Array.from({ length: L }, (_, i) => i)
    .sort((x, y) => a[y * L + y] - a[x * L + x]);
  order.forEach((src, dst) => {
    vals[dst] = a[src * L + src];
    for (let i = 0; i < L; i++) vecs[i * L + dst] = v[i * L + src];
  });
  return { vals, vecs };
}

export function pcaK(samples, k = 2) {
  const n = samples.length;
  if (!n) return { proj: [], comps: [], project: () => [], explained: [], mean: new Float64Array(0) };
  const L = samples[0].values.length;
  const mean = new Float64Array(L);
  for (const s of samples) for (let j = 0; j < L; j++) mean[j] += s.values[j];
  for (let j = 0; j < L; j++) mean[j] /= n;

  const cov = covariance(samples, mean);
  const { vals, vecs } = jacobiEigen(cov, L);
  const kk = Math.min(k, L);
  let trace = 0;
  for (let i = 0; i < L; i++) trace += vals[i];

  const comps = [];
  for (let c = 0; c < kk; c++) {
    const v = new Float64Array(L);
    for (let i = 0; i < L; i++) v[i] = vecs[i * L + c];
    comps.push({ v, lam: vals[c] });
  }

  const project = (values) => {
    const c = new Float64Array(L);
    for (let j = 0; j < L; j++) c[j] = values[j] - mean[j];
    return comps.map((comp) => dot(c, comp.v));
  };
  const proj = samples.map((s) => project(s.values));
  return { proj, comps, project, explained: comps.map((c) => (trace ? c.lam / trace : 0)), mean };
}

export function pca2D(samples) {
  const r = pcaK(samples, 2);
  return {
    proj: r.proj.map((p) => ({ x: p[0] ?? 0, y: p[1] ?? 0 })),
    comps: r.comps,
    project: (values) => { const p = r.project(values); return { x: p[0] ?? 0, y: p[1] ?? 0 }; },
    explained: r.explained,
    mean: r.mean,
  };
}

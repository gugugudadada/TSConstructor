/* 频谱（只读展示用）——Hann 窗 + DFT 幅度 → dB（峰值归一 0 dB，底 −60 dB）。
   🔴 只做确定性变换，不含任何领域判读（不做峰检、不标"谐波"、不下结论）。
   口径：点序列 → 频率轴由**数据契约**声明（本项目 187 点 ≈ 125.2 Hz；Nyquist = fs/2 ≈ 62.6 Hz，
   见 docs/sample-contract.md §一）；本模块不假定采样率，只输出 bin。
   实现：对每个 bin 用单位根递推（cos/sin 各算一次/ bin）——O(K·N) 且无浮点放大风险（N=187）。 */

export const SPECTRUM_SPEC_VERSION = 'spectrum-v1.0.0';

function hannWindow(N) {
  const w = new Float64Array(N);
  if (N <= 1) { w.fill(1); return w; }
  for (let n = 0; n < N; n++) w[n] = 0.5 * (1 - Math.cos((2 * Math.PI * n) / (N - 1)));
  return w;
}

/* 返回 { db: Float64Array(K), K, floorDb }；db[k] = 相对"去直流后峰值"的分贝（≤ 0） */
export function spectrumDb(values, { window: useWindow = true, floorDb = -60 } = {}) {
  const N = values.length;
  const K = (N >> 1) + 1;
  const w = useWindow ? hannWindow(N) : null;
  const mag = new Float64Array(K);
  for (let k = 0; k < K; k++) {
    const ang = (2 * Math.PI * k) / N;
    const c = Math.cos(ang), s = Math.sin(ang);
    let cr = 1, si = 0;                       // (cos + i·sin)^n 递推
    let re = 0, im = 0;
    for (let n = 0; n < N; n++) {
      const x = w ? values[n] * w[n] : values[n];
      re += x * cr;
      im += x * si;
      const nc = cr * c - si * s;
      si = cr * s + si * c;
      cr = nc;
    }
    mag[k] = Math.hypot(re, im);
  }
  let mx = 0;
  for (let k = 1; k < K; k++) if (mag[k] > mx) mx = mag[k];   // 归一分母不含 DC（否则直流主导整幅）
  const db = new Float64Array(K);
  for (let k = 0; k < K; k++) {
    const rel = mx > 0 ? Math.max(mag[k] / mx, 1e-30) : 1e-30;
    db[k] = Math.max(floorDb, 20 * Math.log10(rel));
  }
  return { db, K, floorDb, spec: SPECTRUM_SPEC_VERSION };
}

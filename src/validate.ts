/** 候选递推的独立验证、候选延伸与低阶暴力枚举。 */

import { err } from "./bm";

export interface CheckFailure {
  /** 第一个失败位置（从零开始，>= L） */
  n: number;
  /** 实际位 s[n] */
  actual: number;
  /** 递推给出的预测位 */
  predicted: number;
  /** 参与计算的位：{index, bit, coeff}（仅列出 C[i]=1 的项） */
  terms: { index: number; bit: number; coeff: number }[];
  /** 参与位与系数相乘后的异或结果（即 predicted） */
  xor: number;
}

export interface ValidateResult {
  valid: boolean;
  L: number;
  C: number[];
  /** 被检查的位置数量（总长 - L） */
  checkedPositions: number;
  firstFailure: CheckFailure | null;
}

/** 校验候选系数：必须是 0/1 数组，C[0] 必须为 1，长度必须恰好为 L+1。 */
export function parseCoeffs(L: unknown, C: unknown): { L: number; C: number[] } {
  if (typeof L !== "number" || !Number.isInteger(L) || L < 0) {
    throw err("INVALID_ORDER", "阶数 L 必须是非负整数。");
  }
  if (!Array.isArray(C) || C.length !== L + 1) {
    throw err("INVALID_COEFFS", `系数列表长度必须恰好为 L+1（即 ${L + 1}），且 C[0]=1。`);
  }
  for (let i = 0; i < C.length; i++) {
    if (C[i] !== 0 && C[i] !== 1) {
      throw err("INVALID_COEFFS", `系数 C[${i}] 非法：${JSON.stringify(C[i])}，只接受 0 或 1。`);
    }
  }
  if (C[0] !== 1) {
    throw err("INVALID_COEFFS", "C[0] 必须固定为 1（连接多项式常数项）。");
  }
  return { L, C: C.slice() };
}

/**
 * 逐项验证候选递推：仅检查 n >= L 的位置，前 L 位属于起始条件。
 */
export function validateCandidate(bits: number[], L: number, C: number[]): ValidateResult {
  if (bits.length < L) {
    throw err("SEQUENCE_SHORTER_THAN_L", `序列长度 ${bits.length} 小于阶数 L=${L}，起始条件都不够。`);
  }
  for (let n = L; n < bits.length; n++) {
    let xor = 0;
    const terms: { index: number; bit: number; coeff: number }[] = [];
    for (let i = 1; i <= L; i++) {
      if (C[i] === 1) {
        terms.push({ index: n - i, bit: bits[n - i], coeff: 1 });
        xor ^= bits[n - i];
      }
    }
    if (xor !== bits[n]) {
      return {
        valid: false,
        L,
        C: C.slice(),
        checkedPositions: bits.length - L,
        firstFailure: { n, actual: bits[n], predicted: xor, terms, xor },
      };
    }
  }
  return { valid: true, L, C: C.slice(), checkedPositions: bits.length - L, firstFailure: null };
}

export const MAX_EXTENSION = 1024;

/**
 * 按候选递推延伸指定位数。
 * 注意：这只是“该候选规律”的延伸，不保证真实未来唯一。
 */
export function extendSequence(bits: number[], L: number, C: number[], count: number): number[] {
  if (!Number.isInteger(count) || count < 1 || count > MAX_EXTENSION) {
    throw err("INVALID_EXTENSION", `延伸长度必须是 1..${MAX_EXTENSION} 的整数。`);
  }
  if (bits.length < L) {
    throw err("SEQUENCE_SHORTER_THAN_L", `序列长度 ${bits.length} 小于阶数 L=${L}，无法延伸。`);
  }
  const out = bits.slice();
  for (let k = 0; k < count; k++) {
    const n = out.length;
    let v = 0;
    for (let i = 1; i <= L; i++) v ^= C[i] & out[n - i];
    out.push(v);
  }
  return out.slice(bits.length);
}

/**
 * 独立暴力枚举：对短序列，从 L=0 起枚举全部 2^L 种系数组合，
 * 返回能解释该前缀的最低阶数及全部可行系数（用于测试交叉验证，不用 BM 自己当裁判）。
 */
export function bruteForceMinimal(bits: number[], maxL = 20): { L: number; solutions: number[][] } {
  for (let L = 0; L <= Math.min(maxL, bits.length); L++) {
    const solutions: number[][] = [];
    const combos = 1 << L;
    for (let mask = 0; mask < combos; mask++) {
      const C = [1];
      for (let i = 1; i <= L; i++) C.push((mask >> (i - 1)) & 1);
      if (validateCandidate(bits, L, C).valid) solutions.push(C);
    }
    if (solutions.length > 0) return { L, solutions };
  }
  throw err("NO_LOW_ORDER_RECURRENCE", `在 L <= ${maxL} 内未找到可解释该前缀的递推。`);
}

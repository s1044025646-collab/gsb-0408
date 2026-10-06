/**
 * GF(2) 上的 Berlekamp–Massey 最短线性递推推断。
 *
 * 约定（全部下标从零开始）：
 *  - 连接多项式 C(x) = 1 + C[1] x + ... + C[L] x^L，C[0] 固定为 1。
 *  - 递推口径：对 n >= L，s[n] = XOR_{i=1..L} ( C[i] AND s[n-i] )。
 *  - 所有运算在 GF(2) 上进行，加减均为异或，绝不把位串当作十进制整数。
 *  - 全零前缀返回 L = 0，系数列表为 [1]。
 */

export interface BmStep {
  /** 当前处理的输入位置（从零开始） */
  n: number;
  /** 输入位 s[n] */
  bit: number;
  /** discrepancy：用当前 C 预测第 n 位与实际位的异或 */
  discrepancy: number;
  /** 更新前的连接多项式系数（C[0]=1） */
  cBefore: number[];
  /** 更新后的连接多项式系数 */
  cAfter: number[];
  /** 更新前的阶数 */
  lBefore: number;
  /** 更新后的阶数 */
  lAfter: number;
  /** 更新前的备份多项式 B */
  bBefore: number[];
  /** 更新后的备份多项式 B */
  bAfter: number[];
  /** 更新后的位移计数 m */
  mAfter: number;
  /** 本步是否触发了系数修正 */
  updated: boolean;
  /** 本步是否触发了阶数与备份切换（2L <= n） */
  lengthChanged: boolean;
}

export interface BmResult {
  /** 输入长度 */
  length: number;
  /** 最小阶数 L */
  L: number;
  /** 连接多项式系数，C[0] 固定为 1，长度至少为 1 */
  C: number[];
  /** 逐步推断记录 */
  steps: BmStep[];
}

export const MAX_SEQUENCE_LENGTH = 100000;

/** 解析并校验二进制序列输入，返回 0/1 数组；非法输入抛出带 code 的错误。 */
export function parseBits(input: unknown): number[] {
  if (typeof input === "string") {
    if (input.length === 0) {
      throw err("EMPTY_SEQUENCE", "序列为空：无法对空输入做线性递推推断，请提供至少一位 0/1。");
    }
    if (input.length > MAX_SEQUENCE_LENGTH) {
      throw err("SEQUENCE_TOO_LONG", `序列长度 ${input.length} 超过上限 ${MAX_SEQUENCE_LENGTH}。`);
    }
    if (!/^[01]+$/.test(input)) {
      const bad = input.split("").findIndex((ch) => ch !== "0" && ch !== "1");
      throw err(
        "INVALID_CHARACTER",
        `序列包含非二进制字符（位置 ${bad}：${JSON.stringify(input[bad])}）。只接受 0 和 1，不会忽略坏字符继续计算。`
      );
    }
    return input.split("").map((ch) => (ch === "1" ? 1 : 0));
  }
  if (Array.isArray(input)) {
    if (input.length === 0) {
      throw err("EMPTY_SEQUENCE", "序列为空：无法对空输入做线性递推推断，请提供至少一位 0/1。");
    }
    if (input.length > MAX_SEQUENCE_LENGTH) {
      throw err("SEQUENCE_TOO_LONG", `序列长度 ${input.length} 超过上限 ${MAX_SEQUENCE_LENGTH}。`);
    }
    for (let i = 0; i < input.length; i++) {
      const v = input[i];
      if (v !== 0 && v !== 1) {
        throw err(
          "INVALID_ELEMENT",
          `数组元素非法（下标 ${i}：${JSON.stringify(v)}）。只接受数字 0 或 1。`
        );
      }
    }
    return input.slice();
  }
  throw err("INVALID_SEQUENCE", "序列必须是 0/1 字符串或 0/1 数组。");
}

export function err(code: string, message: string): Error & { code: string } {
  const e = new Error(message) as Error & { code: string };
  e.code = code;
  return e;
}

/**
 * 标准二进制 Berlekamp–Massey。
 * 二进制域中缩放因子恒为 1，修正即按位移异或备份多项式。
 */
export function berlekampMassey(bits: number[]): BmResult {
  const N = bits.length;
  let C = [1];
  let B = [1];
  let L = 0;
  let m = 1;
  const steps: BmStep[] = [];

  for (let n = 0; n < N; n++) {
    // discrepancy d = s[n] ^ XOR_{i=1..L} C[i]*s[n-i]
    let d = bits[n];
    for (let i = 1; i <= L; i++) {
      d ^= C[i] & bits[n - i];
    }
    const cBefore = C.slice();
    const bBefore = B.slice();
    const lBefore = L;
    let updated = false;
    let lengthChanged = false;

    if (d === 1) {
      const T = C.slice();
      // C = C ^ (B 左移 m 位)
      const need = B.length + m;
      while (C.length < need) C.push(0);
      for (let i = 0; i < B.length; i++) {
        C[i + m] ^= B[i];
      }
      updated = true;
      if (2 * L <= n) {
        L = n + 1 - L;
        B = T;
        m = 1;
        lengthChanged = true;
      } else {
        m++;
      }
    } else {
      m++;
    }

    steps.push({
      n,
      bit: bits[n],
      discrepancy: d,
      cBefore,
      cAfter: C.slice(),
      lBefore,
      lAfter: L,
      bBefore,
      bAfter: B.slice(),
      mAfter: m,
      updated,
      lengthChanged,
    });
  }

  // 输出系数长度固定为 L+1（C[0]=1）；不因为最高位系数为 0 而缩减阶数语义。
  const cOut = new Array<number>(L + 1).fill(0);
  for (let i = 0; i <= L && i < C.length; i++) cOut[i] = C[i];
  cOut[0] = 1;
  return { length: N, L, C: cOut, steps };
}

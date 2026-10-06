/** API 与 CLI 共用的业务逻辑。 */

import { berlekampMassey, parseBits, BmResult } from "./bm";
import { validateCandidate, extendSequence, parseCoeffs, MAX_EXTENSION } from "./validate";
import { Store, VersionRow, ALGORITHM_ID, ALGORITHM_NOTE } from "./store";

export class Service {
  constructor(public store: Store) {}

  analyze(input: unknown): { analysisId: number; version: number; report: unknown } {
    const bits = parseBits(input);
    const result = berlekampMassey(bits);
    const row = this.store.createAnalysis(bits.join(""), result);
    return { analysisId: row.analysisId, version: row.version, report: reportOf(row) };
  }

  getReport(analysisId: number, version?: number): unknown {
    const row = version === undefined
      ? this.store.latestVersion(analysisId)
      : this.store.getVersion(analysisId, version);
    if (!row) throw Object.assign(new Error("分析或版本不存在。"), { code: "NOT_FOUND" });
    return reportOf(row);
  }

  getSteps(analysisId: number, version?: number): unknown {
    const row = version === undefined
      ? this.store.latestVersion(analysisId)
      : this.store.getVersion(analysisId, version);
    if (!row) throw Object.assign(new Error("分析或版本不存在。"), { code: "NOT_FOUND" });
    return { analysisId: row.analysisId, version: row.version, steps: row.steps };
  }

  append(analysisId: number, extraInput: unknown): unknown {
    const extra = parseBits(extraInput);
    const latest = this.store.latestVersion(analysisId);
    if (!latest) throw Object.assign(new Error(`分析 ${analysisId} 不存在。`), { code: "NOT_FOUND" });
    const full = latest.sequence + extra.join("");
    const bits = parseBits(full);
    const result = berlekampMassey(bits);
    const row = this.store.appendBits(analysisId, extra.join(""), result, full);
    return { analysisId: row.analysisId, version: row.version, report: reportOf(row) };
  }

  validate(input: unknown, L: unknown, C: unknown): unknown {
    const bits = parseBits(input);
    const cand = parseCoeffs(L, C);
    return validateCandidate(bits, cand.L, cand.C);
  }

  extend(analysisId: number, count: unknown, L?: unknown, C?: unknown): unknown {
    const row = this.store.latestVersion(analysisId);
    if (!row) throw Object.assign(new Error(`分析 ${analysisId} 不存在。`), { code: "NOT_FOUND" });
    // 默认用最新推断的递推；也允许显式指定候选 (L, C)
    const cand = L !== undefined || C !== undefined ? parseCoeffs(L, C) : { L: row.L, C: row.C };
    const n = typeof count === "string" ? Number(count) : count;
    const bits = parseBits(row.sequence);
    const ext = extendSequence(bits, cand.L, cand.C, n as number);
    return {
      analysisId: row.analysisId,
      basedOnVersion: row.version,
      basis: { L: cand.L, C: cand.C },
      originalLength: bits.length,
      extensionLength: ext.length,
      extension: ext.join(""),
      disclaimer:
        "延伸位仅是该候选线性规律的延续，不保证真实未来唯一，也不构成对生成器来源的证明。",
    };
  }

  compare(idA: number, idB: number): unknown {
    const a = this.store.latestVersion(idA);
    const b = this.store.latestVersion(idB);
    if (!a || !b) throw Object.assign(new Error("比较的分析不存在。"), { code: "NOT_FOUND" });
    const sa = a.sequence;
    const sb = b.sequence;
    let common = 0;
    while (common < sa.length && common < sb.length && sa[common] === sb[common]) common++;
    return {
      a: { analysisId: a.analysisId, version: a.version, length: sa.length, L: a.L, C: a.C },
      b: { analysisId: b.analysisId, version: b.version, length: sb.length, L: b.L, C: b.C },
      commonPrefixLength: common,
      samePrefixRelationship:
        common === Math.min(sa.length, sb.length)
          ? sa.length === sb.length
            ? "identical"
            : "one-is-prefix-of-other"
          : "diverge",
    };
  }

  list(): unknown {
    return this.store.listAnalyses();
  }
}

export function reportOf(row: VersionRow): unknown {
  return {
    analysisId: row.analysisId,
    version: row.version,
    createdAt: row.createdAt,
    algorithm: ALGORITHM_ID,
    convention: ALGORITHM_NOTE,
    sequence: row.sequence,
    length: row.sequence.length,
    L: row.L,
    C: row.C,
    recurrence:
      row.L === 0
        ? "L=0：能解释该前缀的递推只产生全零序列（该前缀本身全零）。"
        : `对 n >= ${row.L}：s[n] = XOR_{i=1..${row.L}} C[i]*s[n-i]，C = [${row.C.join(", ")}]`,
  };
}

export { BmResult, MAX_EXTENSION };

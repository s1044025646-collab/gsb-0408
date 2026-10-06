/** SQLite 持久化：分析记录 + 不可覆盖的版本化报告。 */

import { DatabaseSync } from "node:sqlite";
import * as fs from "node:fs";
import * as path from "node:path";
import { BmResult } from "./bm";

export const ALGORITHM_ID = "berlekamp-massey-gf2-v1";
export const ALGORITHM_NOTE =
  "GF(2) Berlekamp-Massey；下标从零开始；C[0]=1；对 n>=L，s[n]=XOR_{i=1..L} C[i]*s[n-i]；仅针对有限前缀的最短线性递推，不代表未来预测或生成器来源证明。";

export interface VersionRow {
  id: number;
  analysisId: number;
  version: number;
  sequence: string;
  L: number;
  C: number[];
  steps: unknown;
  createdAt: string;
}

export class Store {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS analyses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT NOT NULL,
        algorithm TEXT NOT NULL,
        note TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS versions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        analysis_id INTEGER NOT NULL REFERENCES analyses(id),
        version INTEGER NOT NULL,
        sequence TEXT NOT NULL,
        L INTEGER NOT NULL,
        coeffs TEXT NOT NULL,
        steps TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(analysis_id, version)
      );
    `);
  }

  close(): void {
    this.db.close();
  }

  /** 新建分析并保存首个版本；任何一步失败都会回滚，不会发布成功分析。 */
  createAnalysis(sequence: string, result: BmResult): VersionRow {
    this.db.exec("BEGIN");
    try {
      const now = new Date().toISOString();
      const a = this.db
        .prepare("INSERT INTO analyses (created_at, algorithm, note) VALUES (?, ?, ?)")
        .run(now, ALGORITHM_ID, ALGORITHM_NOTE);
      const analysisId = Number(a.lastInsertRowid);
      const row = this.insertVersion(analysisId, 1, sequence, result, now);
      this.db.exec("COMMIT");
      return row;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  /** 追加更多观测：形成独立新版本，旧版本保持不变。 */
  appendBits(analysisId: number, extraBits: string, result: BmResult, fullSequence: string): VersionRow {
    const latest = this.latestVersion(analysisId);
    if (!latest) throw Object.assign(new Error(`分析 ${analysisId} 不存在。`), { code: "NOT_FOUND" });
    if (!fullSequence.startsWith(latest.sequence) || !fullSequence.endsWith(extraBits)) {
      throw Object.assign(new Error("追加后的完整序列与旧版本不一致。"), { code: "APPEND_MISMATCH" });
    }
    this.db.exec("BEGIN");
    try {
      const row = this.insertVersion(
        analysisId,
        latest.version + 1,
        fullSequence,
        result,
        new Date().toISOString()
      );
      this.db.exec("COMMIT");
      return row;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  private insertVersion(
    analysisId: number,
    version: number,
    sequence: string,
    result: BmResult,
    now: string
  ): VersionRow {
    const r = this.db
      .prepare(
        "INSERT INTO versions (analysis_id, version, sequence, L, coeffs, steps, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      )
      .run(analysisId, version, sequence, result.L, JSON.stringify(result.C), JSON.stringify(result.steps), now);
    return {
      id: Number(r.lastInsertRowid),
      analysisId,
      version,
      sequence,
      L: result.L,
      C: result.C,
      steps: result.steps,
      createdAt: now,
    };
  }

  latestVersion(analysisId: number): VersionRow | null {
    const row = this.db
      .prepare(
        "SELECT * FROM versions WHERE analysis_id = ? ORDER BY version DESC LIMIT 1"
      )
      .get(analysisId) as Record<string, unknown> | undefined;
    return row ? toVersionRow(row) : null;
  }

  getVersion(analysisId: number, version: number): VersionRow | null {
    const row = this.db
      .prepare("SELECT * FROM versions WHERE analysis_id = ? AND version = ?")
      .get(analysisId, version) as Record<string, unknown> | undefined;
    return row ? toVersionRow(row) : null;
  }

  listVersions(analysisId: number): VersionRow[] {
    const rows = this.db
      .prepare("SELECT * FROM versions WHERE analysis_id = ? ORDER BY version ASC")
      .all(analysisId) as unknown as Record<string, unknown>[];
    return rows.map(toVersionRow);
  }

  listAnalyses(): { id: number; createdAt: string; algorithm: string; versions: number; latestL: number; latestLength: number }[] {
    const rows = this.db
      .prepare(
        `SELECT a.id, a.created_at, a.algorithm,
                (SELECT COUNT(*) FROM versions v WHERE v.analysis_id = a.id) AS versions,
                (SELECT L FROM versions v WHERE v.analysis_id = a.id ORDER BY version DESC LIMIT 1) AS latestL,
                (SELECT LENGTH(sequence) FROM versions v WHERE v.analysis_id = a.id ORDER BY version DESC LIMIT 1) AS latestLength
         FROM analyses a ORDER BY a.id ASC`
      )
      .all() as unknown as Record<string, unknown>[];
    return rows.map((r) => ({
      id: Number(r.id),
      createdAt: String(r.created_at),
      algorithm: String(r.algorithm),
      versions: Number(r.versions),
      latestL: Number(r.latestL),
      latestLength: Number(r.latestLength),
    }));
  }
}

function toVersionRow(r: Record<string, unknown>): VersionRow {
  return {
    id: Number(r.id),
    analysisId: Number(r.analysis_id),
    version: Number(r.version),
    sequence: String(r.sequence),
    L: Number(r.L),
    C: JSON.parse(String(r.coeffs)),
    steps: JSON.parse(String(r.steps)),
    createdAt: String(r.created_at),
  };
}

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { AnalysisResult } from './bm';

export interface StoredVersion {
  id: string;
  analysisId: string;
  version: number;
  sequence: number[];
  length: number;
  report: AnalysisResult;
  source: 'create' | 'append';
  basisVersionId: string | null;
  createdAt: string;
}

export function openDatabase(dbPath: string): DatabaseSync {
  const absolute = resolve(dbPath);
  mkdirSync(dirname(absolute), { recursive: true });
  const db = new DatabaseSync(absolute);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS analyses (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS analysis_versions (
      id TEXT PRIMARY KEY,
      analysis_id TEXT NOT NULL REFERENCES analyses(id),
      version INTEGER NOT NULL,
      sequence_json TEXT NOT NULL,
      length INTEGER NOT NULL,
      report_json TEXT NOT NULL,
      source TEXT NOT NULL CHECK(source IN ('create','append')),
      basis_version_id TEXT REFERENCES analysis_versions(id),
      created_at TEXT NOT NULL,
      UNIQUE(analysis_id, version)
    );
    CREATE INDEX IF NOT EXISTS idx_analysis_versions_analysis
      ON analysis_versions(analysis_id, version);
  `);
  return db;
}

function rowToVersion(row: any): StoredVersion {
  return {
    id: row.id,
    analysisId: row.analysis_id,
    version: Number(row.version),
    sequence: JSON.parse(row.sequence_json),
    length: Number(row.length),
    report: JSON.parse(row.report_json),
    source: row.source,
    basisVersionId: row.basis_version_id,
    createdAt: row.created_at,
  };
}

export function createVersion(
  db: DatabaseSync,
  report: AnalysisResult,
  source: 'create' | 'append',
  basis: StoredVersion | null,
): StoredVersion {
  const now = new Date().toISOString();
  const analysisId = basis ? basis.analysisId : cryptoId();
  const id = cryptoId();
  const version = basis ? basis.version + 1 : 1;

  db.exec('BEGIN IMMEDIATE');
  try {
    if (!basis) {
      db.prepare('INSERT INTO analyses(id, created_at) VALUES (?, ?)').run(analysisId, now);
    }
    db.prepare(`
      INSERT INTO analysis_versions(
        id, analysis_id, version, sequence_json, length, report_json,
        source, basis_version_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      analysisId,
      version,
      JSON.stringify(report.sequence),
      report.length,
      JSON.stringify(report),
      source,
      basis?.id ?? null,
      now,
    );
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  return {
    id,
    analysisId,
    version,
    sequence: report.sequence,
    length: report.length,
    report,
    source,
    basisVersionId: basis?.id ?? null,
    createdAt: now,
  };
}

export function getVersion(db: DatabaseSync, analysisId: string, version?: number): StoredVersion | null {
  const row = version
    ? db.prepare('SELECT * FROM analysis_versions WHERE analysis_id = ? AND version = ?').get(analysisId, version)
    : db.prepare('SELECT * FROM analysis_versions WHERE analysis_id = ? ORDER BY version DESC LIMIT 1').get(analysisId);
  return row ? rowToVersion(row) : null;
}

export function listVersions(db: DatabaseSync, analysisId: string): StoredVersion[] {
  const rows = db.prepare('SELECT * FROM analysis_versions WHERE analysis_id = ? ORDER BY version').all(analysisId);
  return rows.map(rowToVersion);
}

function cryptoId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}-${Math.random().toString(36).slice(2, 8)}`;
}

import type { DatabaseSync } from 'node:sqlite';
import { berlekampMasseyBinary, enumerateLowerOrderSolutions, extendRecurrence, verifyRecurrence } from './bm';
import { AppError, MAX_EXTENSION_BITS, parseBits, parseCoefficients, parseNonNegativeInteger } from './errors';
import { createVersion, getVersion, listVersions, type StoredVersion } from './db';

export function createAnalysis(db: DatabaseSync, bitsInput: unknown): StoredVersion {
  const bits = parseBits(bitsInput);
  const report = berlekampMasseyBinary(bits);
  return createVersion(db, report, 'create', null);
}

export function appendObservation(db: DatabaseSync, analysisId: string, extraBitsInput: unknown): StoredVersion {
  const existing = requireLatestVersion(db, analysisId);
  const extraBits = parseBits(extraBitsInput, 'additionalBits');
  const report = berlekampMasseyBinary([...existing.sequence, ...extraBits]);
  return createVersion(db, report, 'append', existing);
}

export function requireLatestVersion(db: DatabaseSync, analysisId: string): StoredVersion {
  const stored = getVersion(db, analysisId);
  if (!stored) {
    throw new AppError('ANALYSIS_NOT_FOUND', `未找到分析 ${analysisId}。`, 404);
  }
  return stored;
}

export function requireVersion(db: DatabaseSync, analysisId: string, versionInput: unknown): StoredVersion {
  const version = parseNonNegativeInteger(versionInput ?? 1, 'version');
  if (version < 1) {
    throw new AppError('INVALID_VERSION', 'version 必须从 1 开始。', 400);
  }
  const stored = getVersion(db, analysisId, version);
  if (!stored) {
    throw new AppError('VERSION_NOT_FOUND', `未找到分析 ${analysisId} 的第 ${version} 版。`, 404);
  }
  return stored;
}

export function getSteps(db: DatabaseSync, analysisId: string, versionInput: unknown) {
  const stored = requireVersion(db, analysisId, versionInput);
  return {
    analysisId: stored.analysisId,
    version: stored.version,
    sequence: stored.sequence,
    steps: stored.report.steps,
  };
}

export function verificationPayload(body: any) {
  const bits = parseBits(body.bits ?? body.sequence);
  const order = parseNonNegativeInteger(body.order, 'order');
  const coefficients = parseCoefficients(body.coefficients, order);
  const verification = verifyRecurrence(bits, order, coefficients);
  return { order, coefficients, sequence: bits, ...verification };
}

export function extensionPayload(body: any) {
  const bits = parseBits(body.bits ?? body.sequence);
  const order = parseNonNegativeInteger(body.order, 'order');
  const coefficients = parseCoefficients(body.coefficients, order);
  const count = parseNonNegativeInteger(body.count, 'count');
  if (count > MAX_EXTENSION_BITS) {
    throw new AppError('EXTENSION_TOO_LONG', `延伸长度不能超过 ${MAX_EXTENSION_BITS} 位。`, 400);
  }
  if (bits.length < order) {
    throw new AppError('INSUFFICIENT_SEED', '给定序列短于候选阶数，无法取得前 L 位起始条件。', 400);
  }
  const result = extendRecurrence(bits, order, coefficients, count);
  return {
    ...result,
    warning: '这只是该候选规律的有限延伸；短前缀匹配不证明生成器来源，也不保证真实未来唯一。',
  };
}

export function comparisonPayload(db: DatabaseSync, analysisId: string, query: URLSearchParams) {
  const latest = requireLatestVersion(db, analysisId);
  const requestedLengths = query.getAll('length').map((value) => parseNonNegativeInteger(Number(value), 'length'))
    .filter((value) => value > 0 && value <= latest.sequence.length);
  const lengths = requestedLengths.length > 0
    ? [...new Set(requestedLengths)].sort((a, b) => a - b)
    : Array.from({ length: latest.sequence.length }, (_, index) => index + 1);
  return {
    analysisId,
    sourceVersion: latest.version,
    fullLength: latest.sequence.length,
    prefixes: lengths.map((length) => {
      const prefix = latest.sequence.slice(0, length);
      const report = berlekampMasseyBinary(prefix);
      return {
        length,
        order: report.order,
        coefficients: report.coefficients,
      };
    }),
  };
}

export function exportVersion(db: DatabaseSync, analysisId: string, versionInput: unknown) {
  const stored = requireVersion(db, analysisId, versionInput);
  return {
    exportedAt: new Date().toISOString(),
    algorithm: 'Berlekamp-Massey on GF(2), XOR addition/subtraction; binary symbols kept as bits.',
    ...stored,
  };
}

export function independentMinimalityCheck(sequence: number[], order: number) {
  return {
    sequence,
    claimedOrder: order,
    lowerOrderSolutions: enumerateLowerOrderSolutions(sequence, order),
    minimal: order === 0 || enumerateLowerOrderSolutions(sequence, order).length === 0,
    method: '对每个更低阶数独立枚举 C[1..L] 的全部二进制组合，不使用 BM 的结果作为判定算法。',
  };
}

export function describeVersions(db: DatabaseSync, analysisId: string) {
  const versions = listVersions(db, analysisId);
  if (versions.length === 0) {
    throw new AppError('ANALYSIS_NOT_FOUND', `未找到分析 ${analysisId}。`, 404);
  }
  return versions.map((stored) => ({
    id: stored.id,
    analysisId: stored.analysisId,
    version: stored.version,
    length: stored.length,
    order: stored.report.order,
    coefficients: stored.report.coefficients,
    source: stored.source,
    basisVersionId: stored.basisVersionId,
    createdAt: stored.createdAt,
  }));
}

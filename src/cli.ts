#!/usr/bin/env node
import { resolve } from 'node:path';
import { openDatabase } from './db';
import { AppError, parseBits } from './errors';
import { berlekampMasseyBinary, extendRecurrence, verifyRecurrence } from './bm';
import {
  appendObservation,
  comparisonPayload,
  createAnalysis,
  describeVersions,
  exportVersion,
  getSteps,
  independentMinimalityCheck,
  requireVersion,
} from './service';

const dbPath = resolve(process.env.DB_PATH ?? resolve(process.cwd(), 'data', 'bm.sqlite'));

function print(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

function parseCoefficients(raw: string | undefined, order: number): number[] {
  if (!raw) throw new AppError('MISSING_COEFFICIENTS', `需要 --coeff "1,..."，长度应为 ${order + 1}。`);
  const coefficients = raw.split(',').map((part) => Number(part.trim()));
  if (coefficients.some((item) => item !== 0 && item !== 1)) {
    throw new AppError('INVALID_COEFFICIENTS', '系数只能为 0 或 1。');
  }
  if (coefficients.length !== order + 1) throw new AppError('INVALID_COEFFICIENT_LENGTH', `系数数量应为 ${order + 1}。`);
  if (coefficients[0] !== 1) throw new AppError('C0_NOT_ONE', 'C[0] 必须为 1。');
  return coefficients;
}

function demo(): void {
  const db = openDatabase(dbPath);
  const sequence = [1, 1, 0, 1, 1, 0, 1, 1, 0];
  const result = berlekampMasseyBinary(sequence);
  const interestingUpdates = result.steps.filter((step) => step.discrepancy === 1);
  const wrong = verifyRecurrence(sequence, 2, [1, 0, 1]);
  const extension = extendRecurrence(sequence, result.order, result.coefficients, 6);
  const minimality = independentMinimalityCheck(sequence, result.order);
  const edgeCases = [
    { name: '全零', bits: [0, 0, 0, 0] },
    { name: '全一', bits: [1, 1, 1, 1] },
    { name: '单个一', bits: [1] },
    { name: '短前缀', bits: [1, 0] },
    { name: '不同开头', bits: [0, 1, 1, 0] },
  ].map((item) => ({ ...item, result: berlekampMasseyBinary(item.bits) }));
  const stored = createAnalysis(db, sequence);

  print({
    demoSequence: '110110110',
    expectedRecurrence: 's[n] = s[n-1] XOR s[n-2] for n >= 2',
    inferred: {
      order: result.order,
      coefficients: result.coefficients,
      convention: result.convention,
    },
    discrepancyOneUpdates: interestingUpdates,
    deliberatelyWrongCandidate: { coefficients: [1, 0, 1], ...wrong },
    candidateExtension: extension,
    independentLowerOrderEnumeration: minimality,
    edgeCases,
    persisted: { analysisId: stored.analysisId, version: stored.version, dbPath },
  });
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  const db = openDatabase(dbPath);

  try {
    switch (command) {
      case 'demo':
        demo();
        break;
      case 'analyze': {
        print(createAnalysis(db, option(args, 'bits')));
        break;
      }
      case 'append': {
        const analysisId = args[0];
        print(appendObservation(db, analysisId, option(args, 'bits')));
        break;
      }
      case 'get': {
        print({
          ...requireVersion(db, args[0], option(args, 'version') ?? 1),
          versions: describeVersions(db, args[0]),
        });
        break;
      }
      case 'steps':
        print(getSteps(db, args[0], option(args, 'version') ?? 1));
        break;
      case 'verify': {
        const bits = parseBits(option(args, 'bits'));
        const order = Number(option(args, 'order'));
        const coefficients = parseCoefficients(option(args, 'coeff'), order);
        print(verifyRecurrence(bits, order, coefficients));
        break;
      }
      case 'extend': {
        const bits = parseBits(option(args, 'bits'));
        const order = Number(option(args, 'order'));
        const count = Number(option(args, 'count') ?? '8');
        const coefficients = parseCoefficients(option(args, 'coeff'), order);
        print(extendRecurrence(bits, order, coefficients, count));
        break;
      }
      case 'compare': {
        const url = new URL('http://local/api');
        const length = option(args, 'lengths');
        if (length) length.split(',').forEach((value) => url.searchParams.append('length', value.trim()));
        print(comparisonPayload(db, args[0], url.searchParams));
        break;
      }
      case 'export':
        print(exportVersion(db, args[0], option(args, 'version') ?? 1));
        break;
      default:
        console.log(`用法:
  npm run demo
  npm run cli -- analyze --bits 110110110
  npm run cli -- get <analysisId> [--version 1]
  npm run cli -- steps <analysisId>
  npm run cli -- append <analysisId> --bits 110
  npm run cli -- verify --bits 110110110 --order 2 --coeff 1,1,1
  npm run cli -- extend --bits 110110110 --order 2 --coeff 1,1,1 --count 6
  npm run cli -- compare <analysisId> --lengths 1,2,3,9
  npm run cli -- export <analysisId>
  npm start`);
    }
  } catch (error) {
    if (error instanceof AppError) {
      console.error(JSON.stringify({ error: { code: error.code, message: error.message } }, null, 2));
      process.exitCode = 1;
    } else {
      throw error;
    }
  }
}

main();

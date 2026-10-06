/** 命令行入口：analyze / show / steps / validate / extend / append / compare / list / export / serve / demo */

import * as path from "node:path";
import { Store } from "./store";
import { Service } from "./service";
import { startServer } from "./server";
import { berlekampMassey, parseBits } from "./bm";
import { validateCandidate, extendSequence } from "./validate";

const DB_PATH = process.env.BM_DB_PATH ?? path.join(process.cwd(), "data", "bm.sqlite");

function out(x: unknown): void {
  console.log(JSON.stringify(x, null, 2));
}

function fail(e: unknown): never {
  const err = e as Error & { code?: string };
  console.error(JSON.stringify({ error: { code: err.code ?? "ERROR", message: err.message } }, null, 2));
  process.exit(1);
}

function openService(): Service {
  return new Service(new Store(DB_PATH));
}

const USAGE = `用法: node dist/src/cli.js <命令> [参数]
  analyze <bits>                 新建分析（bits 为 0/1 字符串）
  show <analysisId> [version]    查看报告
  steps <analysisId> [version]   查看逐步推断记录
  validate <bits> <L> <C...>     验证外部候选递推（C 为 L+1 个 0/1）
  extend <analysisId> <count>    按最新推断递推延伸 count 位
  append <analysisId> <bits>     追加观测位，生成新版本
  compare <idA> <idB>            比较两个分析的前缀关系
  list                           列出全部分析
  export <analysisId> [version]  导出报告与步骤
  serve [port]                   启动 API 服务（默认自动选择空闲端口）
  demo                           运行内置演示（110110110 等）
数据文件: ${DB_PATH}（可用环境变量 BM_DB_PATH 覆盖）`;

async function main(): Promise<void> {
  const [, , cmd, ...args] = process.argv;
  if (!cmd || cmd === "help" || cmd === "--help") {
    console.log(USAGE);
    return;
  }

  if (cmd === "serve") {
    const port = args[0] !== undefined ? Number(args[0]) : process.env.PORT !== undefined ? Number(process.env.PORT) : 0;
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
      fail(Object.assign(new Error("端口必须是 0..65535 的整数（0 表示自动选择空闲端口）。"), { code: "INVALID_PORT" }));
    }
    const svc = openService();
    const { port: actual } = await startServer(svc, port);
    console.log(`BM GF(2) API 已启动: http://127.0.0.1:${actual}  (数据库: ${DB_PATH})`);
    return;
  }

  if (cmd === "demo") {
    runDemo();
    return;
  }

  const svc = openService();
  try {
    switch (cmd) {
      case "analyze":
        if (!args[0]) throw Object.assign(new Error("缺少 bits 参数。"), { code: "USAGE" });
        out(svc.analyze(args[0]));
        break;
      case "show":
        out(svc.getReport(Number(args[0]), args[1] ? Number(args[1]) : undefined));
        break;
      case "steps":
        out(svc.getSteps(Number(args[0]), args[1] ? Number(args[1]) : undefined));
        break;
      case "validate": {
        const bits = args[0];
        const L = Number(args[1]);
        const C = args.slice(2).map(Number);
        if (!bits || args.length < 3) throw Object.assign(new Error("用法: validate <bits> <L> <C...>"), { code: "USAGE" });
        out(svc.validate(bits, L, C));
        break;
      }
      case "extend":
        out(svc.extend(Number(args[0]), Number(args[1])));
        break;
      case "append":
        out(svc.append(Number(args[0]), args[1]));
        break;
      case "compare":
        out(svc.compare(Number(args[0]), Number(args[1])));
        break;
      case "list":
        out(svc.list());
        break;
      case "export":
        out({
          report: svc.getReport(Number(args[0]), args[1] ? Number(args[1]) : undefined),
          steps: svc.getSteps(Number(args[0]), args[1] ? Number(args[1]) : undefined),
        });
        break;
      default:
        console.error(`未知命令: ${cmd}\n${USAGE}`);
        process.exit(1);
    }
  } catch (e) {
    fail(e);
  } finally {
    svc.store.close();
  }
}

function runDemo(): void {
  console.log("=== 演示 1：序列 110110110 的 Berlekamp–Massey 推断 ===");
  const bits = parseBits("110110110");
  const r = berlekampMassey(bits);
  console.log(`结果: L=${r.L}, C=[${r.C.join(", ")}]  =>  s[n] = s[n-1] XOR s[n-2]`);
  console.log("discrepancy=1 的更新步骤:");
  for (const s of r.steps.filter((x) => x.discrepancy === 1)) {
    console.log(
      `  n=${s.n} bit=${s.bit} d=1  C: [${s.cBefore.join(",")}] -> [${s.cAfter.join(",")}]  L: ${s.lBefore} -> ${s.lAfter}` +
        (s.lengthChanged ? "  (阶数与备份更新)" : "")
    );
  }

  console.log("\n=== 演示 2：验证正确递推 s[n]=s[n-1]^s[n-2]（L=2, C=[1,1,1]） ===");
  out(validateCandidate(bits, 2, [1, 1, 1]));

  console.log("=== 演示 3：故意错误系数 L=2, C=[1,0,1]（即 s[n]=s[n-2]）的失败位置 ===");
  out(validateCandidate(bits, 2, [1, 0, 1]));

  console.log("=== 演示 4：按推断递推延伸 6 位（仅为候选规律延伸，非真实未来保证） ===");
  console.log("原序列: 110110110, 延伸:", extendSequence(bits, r.L, r.C, 6).join(""));

  console.log("\n=== 演示 5：边界序列 ===");
  for (const s of ["000000", "111111", "1", "10", "01"]) {
    const rr = berlekampMassey(parseBits(s));
    console.log(`  ${s}  ->  L=${rr.L}, C=[${rr.C.join(", ")}]`);
  }
}

main().catch(fail);

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { berlekampMassey, parseBits } from "../src/bm";
import { validateCandidate, extendSequence, bruteForceMinimal } from "../src/validate";
import { Store } from "../src/store";
import { Service } from "../src/service";
import { startServer } from "../src/server";

test("演示序列 110110110 -> L=2, C=[1,1,1]", () => {
  const r = berlekampMassey(parseBits("110110110"));
  assert.equal(r.L, 2);
  assert.deepEqual(r.C, [1, 1, 1]);
  // 确实存在 discrepancy=1 的更新步骤，且步骤记录完整
  const ups = r.steps.filter((s) => s.discrepancy === 1);
  assert.ok(ups.length >= 2);
  assert.equal(r.steps.length, 9);
  assert.equal(r.steps[0].n, 0);
  // 最终递推确实解释整个前缀
  assert.ok(validateCandidate(parseBits("110110110"), r.L, r.C).valid);
});

test("全零前缀 L=0；全一 L=1；单个 1 L=1", () => {
  assert.equal(berlekampMassey(parseBits("000000")).L, 0);
  const ones = berlekampMassey(parseBits("111111"));
  assert.equal(ones.L, 1);
  assert.deepEqual(ones.C, [1, 1]);
  const one = berlekampMassey(parseBits("1"));
  assert.equal(one.L, 1);
  assert.deepEqual(one.C, [1, 1]);
});

test("不同开头与短前缀：BM 结果与暴力枚举一致", () => {
  const cases = ["0", "1", "00", "01", "10", "11", "010", "101", "110110110", "0010110", "10110110", "01101101"];
  for (const s of cases) {
    const bits = parseBits(s);
    const r = berlekampMassey(bits);
    const bf = bruteForceMinimal(bits);
    assert.equal(r.L, bf.L, `序列 ${s} 的阶数应与暴力枚举一致`);
    // BM 给出的系数必须在暴力枚举的解集合中
    assert.ok(
      bf.solutions.some((sol) => sol.join() === r.C.join()),
      `序列 ${s}：BM 系数 [${r.C}] 应出现在暴力解集 ${JSON.stringify(bf.solutions)}`
    );
    // 且不存在更低阶递推（暴力枚举从 0 开始已保证）
    assert.ok(validateCandidate(bits, r.L, r.C).valid);
  }
});

test("随机短序列：BM 阶数与暴力枚举一致，且递推可验证", () => {
  let seed = 12345;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let t = 0; t < 50; t++) {
    const len = 1 + Math.floor(rnd() * 16);
    const bits = Array.from({ length: len }, () => (rnd() < 0.5 ? 0 : 1));
    const r = berlekampMassey(bits);
    const bf = bruteForceMinimal(bits);
    assert.equal(r.L, bf.L, `bits=${bits.join("")}`);
    assert.ok(validateCandidate(bits, r.L, r.C).valid);
  }
});

test("验证器：错误系数给出第一个失败位置、参与位与异或结果", () => {
  const bits = parseBits("110110110");
  const bad = validateCandidate(bits, 2, [1, 0, 1]); // s[n]=s[n-2]
  assert.equal(bad.valid, false);
  assert.equal(bad.firstFailure!.n, 2); // s[2]=0，而 s[n-2]=s[0]=1，异或结果 1 != 0
  const f = bad.firstFailure!;
  assert.equal(f.xor, f.predicted);
  assert.notEqual(f.predicted, f.actual);
  assert.ok(f.terms.every((t) => t.coeff === 1));
});

test("验证器：只检查 n>=L，初始 L 位属于起始条件", () => {
  // L=2, C=[1,1,0] 即 s[n]=s[n-1]，序列 "10" 只有起始位，无检查位置
  const r = validateCandidate([1, 0], 2, [1, 1, 0]);
  assert.ok(r.valid);
  assert.equal(r.checkedPositions, 0);
});

test("延伸：LFSR 1011 (L=4, C=[1,1,0,0,1]) 延伸位与递推一致且可再验证", () => {
  const bits = parseBits("1011010111");
  const r = berlekampMassey(bits);
  const ext = extendSequence(bits, r.L, r.C, 8);
  assert.equal(ext.length, 8);
  const full = bits.concat(ext);
  assert.ok(validateCandidate(full, r.L, r.C).valid);
  assert.throws(() => extendSequence(bits, r.L, r.C, 2000), /延伸长度/);
});

test("输入校验：拒绝非二进制字符、非法数组元素、空输入、过长输入", () => {
  assert.throws(() => parseBits("10a01"), /非二进制字符/);
  assert.throws(() => parseBits([0, 1, 2]), /数组元素非法/);
  assert.throws(() => parseBits(""), /空/);
  assert.throws(() => parseBits([]), /空/);
  assert.throws(() => parseBits("1".repeat(100001)), /超过上限/);
  assert.throws(() => parseBits(123 as unknown), /必须是/);
});

test("持久化与版本：追加形成新版本，旧版本不被覆盖", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bm-test-"));
  const svc = new Service(new Store(path.join(dir, "t.sqlite")));
  const a = svc.analyze("110") as { analysisId: number };
  svc.append(a.analysisId, "110110");
  const v1 = svc.getReport(a.analysisId, 1) as { sequence: string };
  const v2 = svc.getReport(a.analysisId, 2) as { sequence: string; L: number };
  assert.equal(v1.sequence, "110");
  assert.equal(v2.sequence, "110110110");
  assert.equal(v2.L, 2);
  // 重启（重新打开数据库）后仍可查询
  svc.store.close();
  const svc2 = new Service(new Store(path.join(dir, "t.sqlite")));
  const again = svc2.getReport(a.analysisId, 1) as { sequence: string };
  assert.equal(again.sequence, "110");
  svc2.store.close();
});

test("失败请求不发布成功分析", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bm-test-"));
  const svc = new Service(new Store(path.join(dir, "t.sqlite")));
  assert.throws(() => svc.analyze("10x01"));
  assert.deepEqual(svc.list(), []);
  svc.store.close();
});

test("HTTP API 端到端：分析/步骤/验证/延伸/比较/导出", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bm-test-"));
  const svc = new Service(new Store(path.join(dir, "t.sqlite")));
  const { port, close } = await startServer(svc, 0);
  const base = `http://127.0.0.1:${port}`;
  const post = async (p: string, body: unknown) =>
    (await fetch(base + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));

  const created = await (await post("/analyses", { sequence: "110110110" })).json() as { analysisId: number };
  assert.ok(created.analysisId >= 1);

  const report = await (await fetch(`${base}/analyses/${created.analysisId}`)).json() as { L: number; C: number[] };
  assert.equal(report.L, 2);
  assert.deepEqual(report.C, [1, 1, 1]);

  const steps = await (await fetch(`${base}/analyses/${created.analysisId}/steps`)).json() as { steps: unknown[] };
  assert.equal(steps.steps.length, 9);

  const val = await (await post("/validate", { sequence: "110110110", L: 2, C: [1, 1, 1] })).json() as { valid: boolean };
  assert.ok(val.valid);

  const ext = await (await post(`/analyses/${created.analysisId}/extend`, { count: 3 })).json() as { extension: string };
  assert.equal(ext.extension, "110");

  const bad = await post("/analyses", { sequence: "10x" });
  assert.equal(bad.status, 400);
  const badBody = await bad.json() as { error: { code: string } };
  assert.equal(badBody.error.code, "INVALID_CHARACTER");

  const exp = await (await fetch(`${base}/analyses/${created.analysisId}/export`)).json() as { report: unknown; steps: unknown };
  assert.ok(exp.report && exp.steps);

  const cmp = await (await post("/compare", { a: created.analysisId, b: created.analysisId })).json() as { samePrefixRelationship: string };
  assert.equal(cmp.samePrefixRelationship, "identical");

  close();
  svc.store.close();
});

# BM-GF2：二进制最短线性递推推断后端

基于 **Berlekamp–Massey** 算法的 GF(2) 二进制序列最短线性递推推断服务。
纯 TypeScript + Node.js + SQLite（`node:sqlite` 内置模块），只做 API 与 CLI，
Windows 本地运行，不依赖 Docker / WSL / 付费服务 / 外部在线 API。

## 适用范围与限制（重要）

- 本工具分析的是**有限前缀的线性复杂度**：输出“能解释这段前缀”的最小阶数 L 与连接多项式系数。
- **有限前缀 ≠ 未来预测**：按推断递推延伸出的位只是“该候选规律的延续”，不保证真实未来唯一。
- **短前缀匹配 ≠ 生成器来源证明**：同一前缀可被多种机制产生，本工具不做、也不声称做来源判定。
- 不破解真实系统、不生成密码密钥；不扩展到一般有限域或多项式因子分解。

## 算法口径约定

- 所有下标**从零开始**；所有运算在 GF(2) 上，加减均为异或。
- 连接多项式 `C(x) = 1 + C[1]x + ... + C[L]x^L`，**C[0] 固定为 1**。
- 递推口径：对 `n >= L`，`s[n] = XOR_{i=1..L} ( C[i] AND s[n-i] )`；前 L 位属于起始条件。
- 阶数 L 与系数列表分开保存，不因最高位系数为 0 而缩减阶数语义。
- 全零前缀返回 `L=0, C=[1]`；空输入被拒绝（错误码 `EMPTY_SEQUENCE`）。
- 拒绝非二进制字符、非法数组元素与过长输入（上限 100000 位），绝不忽略坏字符继续计算。
- 位串绝不转成普通十进制整数做算术递推。

## 快速开始

```powershell
npm install        # 安装开发依赖（typescript）
npm run build      # 编译到 dist/
npm test           # 构建并运行全部测试
npm run demo       # 内置演示（110110110、错误系数失败位置、边界序列）
npm start          # 启动 API 服务（默认自动选择空闲端口并打印）
```

数据文件默认在项目内 `data/bm.sqlite`，可用环境变量 `BM_DB_PATH` 覆盖；
端口可用 `serve <port>` 或环境变量 `PORT` 指定，`0`/缺省表示自动选择空闲端口。

## CLI 命令

```powershell
node dist/src/cli.js analyze 110110110        # 新建分析
node dist/src/cli.js show 1                   # 查看报告（可选版本号作为第二参数）
node dist/src/cli.js steps 1                  # 逐步推断记录
node dist/src/cli.js validate 110110110 2 1 1 1   # 验证外部候选 L=2, C=[1,1,1]
node dist/src/cli.js extend 1 6               # 按最新推断递推延伸 6 位
node dist/src/cli.js append 1 110             # 追加观测位，生成新版本（旧版本保留）
node dist/src/cli.js compare 1 2              # 比较两个分析的前缀关系
node dist/src/cli.js list                     # 列出全部分析
node dist/src/cli.js export 1                 # 导出报告与步骤
node dist/src/cli.js serve 8080               # 指定端口启动 API
```

## HTTP API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/analyses` | 新建分析，body: `{"sequence":"110110110"}`（也接受 0/1 数组） |
| GET | `/analyses` | 列出全部分析 |
| GET | `/analyses/:id?version=N` | 读取报告（默认最新版本） |
| GET | `/analyses/:id/steps?version=N` | 逐步推断记录 |
| POST | `/analyses/:id/append` | 追加观测位 `{"bits":"110"}`，生成独立新版本 |
| POST | `/analyses/:id/extend` | 候选延伸 `{"count":6}`（可选显式 `L`、`C`），上限 1024 位 |
| GET | `/analyses/:id/export?version=N` | 导出报告与步骤 |
| POST | `/validate` | 验证外部候选 `{"sequence":"...","L":2,"C":[1,1,1]}` |
| POST | `/compare` | 比较前缀 `{"a":1,"b":2}` |
| GET | `/health` | 健康检查 |

示例：

```powershell
node dist/src/cli.js serve          # 记下打印的端口，例如 51234
curl -X POST http://127.0.0.1:51234/analyses -H "Content-Type: application/json" -d '{\"sequence\":\"110110110\"}'
curl -X POST http://127.0.0.1:51234/validate -H "Content-Type: application/json" -d '{\"sequence\":\"110110110\",\"L\":2,\"C\":[1,0,1]}'
```

## 输出结构

- 报告：`L`、`C`（长度 L+1，C[0]=1）、原始序列、算法口径说明、可读的递推公式。
- 每步记录：处理位置 `n`、输入位、discrepancy、更新前后系数、更新前后阶数、备份多项式 B 的变化、位移计数 m。
- 验证结果：`valid`、检查位置数、第一个失败位置 `n`、实际位、预测位、参与位列表（下标/位/系数）与异或结果。
- 延伸结果：标注 `basedOnVersion` 与免责声明，保留所依据的原报告版本。

## 错误码

`INVALID_SEQUENCE` / `EMPTY_SEQUENCE` / `SEQUENCE_TOO_LONG` / `INVALID_CHARACTER` /
`INVALID_ELEMENT` / `INVALID_ORDER` / `INVALID_COEFFS` / `SEQUENCE_SHORTER_THAN_L` /
`INVALID_EXTENSION` / `NOT_FOUND` / `INVALID_JSON` / `PAYLOAD_TOO_LARGE`。
所有失败请求返回 4xx 与 `{ "error": { "code", "message" } }`，且不会发布成功分析（数据库事务回滚）。

## 演示：110110110

`npm run demo` 展示：

- `110110110` 推断出 `L=2, C=[1,1,1]`，即 `s[n] = s[n-1] XOR s[n-2]`；
- 若干 discrepancy=1 的更新步骤（如 `n=0: C [1]->[1,1], L 0->1`）；
- 故意错误系数 `C=[1,0,1]`（即 `s[n]=s[n-2]`）在 `n=2` 处失败：`s[2]=0` 而 `s[0]=1`；
- 全零 / 全一 / 单个 1 / 不同开头等边界序列的结果。

## 测试说明

`npm test` 覆盖：

- 演示序列与边界序列（全零、全一、单个 1、短前缀、不同开头）；
- **独立交叉验证**：对短序列暴力枚举所有低阶系数组合，确认 BM 给出的阶数最小、
  且不存在可用的更低阶递推（不是用同一算法自己当裁判）；
- 验证器的失败位置 / 参与位 / 异或结果，及“只检查 n>=L”的语义；
- 持久化与版本化（追加生成新版本、旧版本不被覆盖、重启后可查）；
- 失败请求不产生分析记录；HTTP API 端到端流程。

## 已知限制

- 整段重新计算，无在线增量缓存，未针对超长序列做性能优化（上限 100000 位）。
- 延伸上限 1024 位；仅为候选规律延续，见顶部“适用范围与限制”。
- `node:sqlite` 在部分 Node 版本会打印 ExperimentalWarning，不影响功能（建议 Node >= 22）。

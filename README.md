# BM2：GF(2) 最短线性递推推断后端

这是一个只做后端的 Windows 本地项目，用 TypeScript、Node.js 和 SQLite 实现二进制序列的 Berlekamp–Massey 最短线性递推推断。项目不依赖 Docker、WSL、付费服务或外部在线 API。

## 数学口径

- 输入是由 `0`、`1` 组成的有限序列，所有加减都在 GF(2) 上进行，即异或。
- 下标从 `0` 开始，连接系数 `C[0]` 固定为 `1`。
- 推断结果表示：对每个 `n >= L`，

```text
s[n] = C[1]s[n-1] XOR C[2]s[n-2] XOR ... XOR C[L]s[n-L]
```

- 阶数 `L` 和长度为 `L+1` 的系数数组分开保存；即使 `C[L]=0`，也不会因为最高系数为零而擅自删除有限前缀所需的阶数。
- 全零前缀的最短阶数为 `0`，系数为 `[1]`，语义是从 `n=0` 开始所有位都满足零关系。
- 空输入会被拒绝，因为没有可解释的前缀。

## 有限前缀与未来预测

Berlekamp–Massey 返回的是解释给定有限前缀的最小线性复杂度。它不证明这些位来自某个真实生成器，也不保证未来唯一。

延伸接口只按调用者给定的候选 `(L, C)` 和前 `L` 位继续计算，并明确标记为“候选规律延伸”。短前缀匹配不能被解释为已证明真实未来。

## 算法步骤记录

每个位置记录：

- `position`、`inputBit`
- 用当前连接多项式算出的 `prediction`
- `discrepancy = inputBit XOR prediction`
- 更新前后阶数和系数
- 备份多项式、位移以及是否更新阶数和备份
- 参与异或的系数、历史位及其下标

遇到 discrepancy 为 `1` 时，用先前备份多项式按位移与当前连接多项式异或；满足 `2L <= n` 时更新阶数并保存新备份。

## 环境要求

- Node.js 25（使用内置实验模块 `node:sqlite`；当前开发环境为 Node.js 25.5.0）
- npm
- Windows PowerShell

## 安装与构建

```powershell
npm install
npm run build
```

SQLite 数据库默认位于项目内：

```text
data\bm.sqlite
```

可通过环境变量修改：

```powershell
$env:DB_PATH="E:\GSB\0408\B\data\custom.sqlite"
```

## 启动 API

默认端口参数为 `0`，操作系统会选择空闲端口，启动时打印实际端口：

```powershell
npm start
```

指定端口：

```powershell
$env:PORT="8080"
npm start
```

健康检查：

```powershell
Invoke-RestMethod http://127.0.0.1:8080/health
```

## API

所有请求和响应均为 JSON。失败响应形如：

```json
{"error":{"code":"NON_BINARY_CHARACTER","message":"..."}}
```

### 新建分析

`POST /api/analyses`

```powershell
Invoke-RestMethod -Method Post http://127.0.0.1:8080/api/analyses `
  -ContentType 'application/json' `
  -Body '{"bits":"110110110"}'
```

`bits` 可以是字符串 `"110"`，也可以是数组 `[1,1,0]`。

### 读取报告和版本

`GET /api/analyses/{id}?version=1`

省略 `version` 时返回最新版本，同时列出该分析的所有版本。

### 读取逐步状态

`GET /api/analyses/{id}/steps?version=1`

### 追加观测，形成独立新版本

`POST /api/analyses/{id}/append`

```json
{"additionalBits":"110"}
```

旧版本保留不变，新版本可指向旧版本 ID。

### 验证外部候选

`POST /api/verify`

```json
{"bits":"110110110","order":2,"coefficients":[1,1,1]}
```

只检查 `n >= L`；前 `L` 位被视为起始条件。失败时返回 `firstFailurePosition`、实际位、预测位和所有参与项。

### 生成候选延伸

`POST /api/extend`

```json
{"bits":"110110110","order":2,"coefficients":[1,1,1],"count":6}
```

延伸长度最多 `1024` 位。响应包含原始依据和“未来不唯一”的警告。

### 比较前缀长度

`GET /api/analyses/{id}/compare-prefixes?length=1&length=2&length=9`

不传 `length` 时比较从 `1` 到完整长度的所有前缀。

### 导出结果

`GET /api/analyses/{id}/export?version=1`

## CLI

完整演示：

```powershell
npm run demo
```

演示序列为 `110110110`，关系为：

```text
s[n] = s[n-1] XOR s[n-2]
```

演示包含：

- 推断出的 `L=2`、`C=[1,1,1]`
- 多个 discrepancy 为 1 的更新步骤
- 故意错误候选 `[1,0,1]` 表示 `s[n]=s[n-2]`，首个失败位置是 `2`
- 全零、全一、单个一、短前缀和不同开头
- 对低阶系数组合的独立枚举
- 候选延伸及非唯一性说明
- SQLite 持久化结果

常用命令：

```powershell
npm run cli -- analyze --bits 110110110
npm run cli -- steps <analysisId>
npm run cli -- verify --bits 110110110 --order 2 --coeff 1,0,1
npm run cli -- extend --bits 110110110 --order 2 --coeff 1,1,1 --count 6
npm run cli -- compare <analysisId> --lengths 1,2,3,9
npm run cli -- export <analysisId>
npm run cli -- append <analysisId> --bits 110
```

## 测试

```powershell
npm test
```

测试不只使用 BM 自身输出作为期望。对于短位串，会独立枚举所有更低阶数的 `C[1..L]` 组合并逐项验证，确认不存在能解释输入的低阶递推。

## 限制

- 只支持二进制 GF(2)，不支持一般有限域。
- 不做多项式因式分解、密码密钥生成或真实系统破解。
- 输入上限为 `10000` 位；目标是清晰可追溯，而非在线大规模批处理。
- 追加观测会整段重新计算，没有额外在线缓存。
- 分析先在内存计算成功，随后在 SQLite 事务中发布；校验失败不会产生成功分析记录。

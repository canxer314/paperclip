# 全量测试基线最小修复计划

日期：2026-10-12

## 范围与兼容约束

只修已复现、已确认的测试基线问题。保留生产命令解析默认顺序、认证冲突检查、目录权限检查和沙箱隔离。不得读取或修改开发者凭据。保留当前未提交改动。暂不修改 CompanySettings 异步等待、数据库迁移/备份超时、端口所有权用例，它们的确定根因尚未确认。

## TDD 步骤

1. npm pack JSON：记录当前 npm 12 下 packaged-artifacts 测试失败；补充数组与 keyed-object 输出的回归覆盖；做局部兼容解析。同类 runner pack 测试同步修正。
2. 沙箱退出码：复现 dash 返回 2；断言失败为非零且外部文件不变，不修改 sandbox 实现。
3. remote Pi fixture：复现 umask 002 下权限校验失败；显式使用安全目录模式，确认 26 个用例通过。
4. workspace fixture：复现源配置为 {} 导致 provisioning 失败；使用有效、隔离的测试配置，保留校验，跑 provisioning 相关用例。
5. AI runtime fixture：复现祖先配置污染；正常用例显式使用临时干净 cwd，保留认证冲突用例；回归 ai-connections、agent-hire-ai-connections、ai-legacy-compatibility。
6. fast-response 环境：带无敏感内容的测试 ANTHROPIC_BASE_URL 复现失败；测试清理/恢复环境变量，覆盖整个文件。
7. native session fixture：确认 PATH fake 被安装包优先解析绕过；仅新增内部可选命令注入，测试显式使用 fake 绝对路径并检查其状态。禁止为复现再调用真实 provider；用无网络 fixture 验证命令选择和恢复/归档行为。

## 验证与交付

各项修改互不重叠，针对性验证避免并发重型数据库测试。修改后独立审查兼容性和测试覆盖。必要时执行 token gates。最终执行 typecheck、Vitest 全量测试、build；记录失败、未执行项目和原因，不以局部绿色宣称全仓绿色。不提交或推送，除非用户另行要求。

## 实施记录

- npm pack 测试兼容数组和 npm 12 keyed-object，同时保留 runner 的单结果约束，新增非法及多结果回归。移除了与本次失败无关、不能验证 staged 权限的新增 umask 用例。
- 沙箱只调整 shell 失败退出码断言，仍要求非零退出且外部文件不变。使用对象匹配，避免访问结果联合类型上的不存在字段。
- remote Pi fixture 显式设置安全权限，不改生产权限校验。
- workspace fixture 使用有效源配置，不改生产 provisioning 校验。
- AI 正常用例隔离 cwd。两个包含间接 runtime 调用的测试文件使用 suite 临时 cwd 并在 finally 恢复；legacy 用例直接指定已有临时 home 为 cwd。认证冲突用例和实际 guard 保留。
- fast-response 测试 stub 并恢复 ANTHROPIC_BASE_URL。
- native session 仅增加内部可选 codexCommand 参数，remote 命令优先，缺省解析不变。损坏 epoch 测试三个 backend 都显式传入 fake 绝对路径，并提前校验 fake 状态。

## 验证记录

已完成的针对性验证：

- skills-catalog：9 passed。
- remote-pi-companion：26 passed。
- runner-bridge-tools：14 passed，1 skipped，非 Linux 专用用例在 Linux 跳过。
- workspace-runtime 完整文件：174 passed。
- native-session-resume 与 native-session-executor：732 passed。日志 `/tmp/issue-25-native-resume-green-files.log`。

- 最终认证回归：4 files passed，230 tests passed。已修复 legacy cwd 遗漏并移除 ai-connections 的冗余 wrapper。
- 最终 runner 打包回归：15 passed，包含单结果约束回归。
- 最终 `pnpm -r typecheck`：通过。
- 最终 `pnpm build`：通过。
- `git diff --check`：通过。

- 第二轮 serialized server 原始证据 `/tmp/paperclip-tdd-serialized-round2-20261012.log`：`ai-connection-router.test.ts` 28 passed、1 failed，Pool repair 的 `prepareManagedAiRuntime` 因缺失 cwd 扫描仓库祖先并报 `Project authentication settings conflict`。注意 `/tmp/issue-25-server-router-red.log` 不是该 red；它是安全 preload 下的 29 passed 日志，且实际拦截过开发者配置读取，不可用来证明安全 green。此次更正见下方 2026-10-13 记录。


- general-server：869 files passed，6 skipped；18596 tests passed，70 skipped，耗时 5931.04 秒。
- UI：722 files passed；8142 tests passed，耗时 127.99 秒。本轮 CompanySettings 未失败。
- CLI：64 files passed，2 failed；526 tests passed，1 failed，1 skipped，另有 suite 初始化失败，耗时 86.81 秒。
- CLI `company-import-export-e2e.test.ts` 初始化失败：隔离环境中的 Corepack 尝试下载 pnpm 9.15.4，registry.npmjs.org DNS 返回 EAI_AGAIN，服务在 healthcheck 前退出。
- CLI `doctor.test.ts:110` 失败：repair 后 summary.failed 预期为 0，实际为 1，根因尚未确认。
- runner 在 CLI 分组失败后停止，后续 workspace-b、workspace-c 与 157 个 serialized server 文件未运行。不能宣称全仓绿色。

此前 build/typecheck 的 TS2339 已修复，以上结果来自停止代码修改后的快照。最终独立复审因上游模型服务返回 422 service_unavailable 未完成，不计为审查通过。首次 portable 静态审查发现的两项问题已处理。

全量测试日志 `/tmp/paperclip-tdd-full-tests-20261012.log`。最终认证日志 `/tmp/paperclip-tdd-auth-final-20261012.log`。最终打包日志 `/tmp/paperclip-tdd-pack-final-20261012.log`。最终 typecheck/build 日志分别为 `/tmp/paperclip-tdd-final-stable-typecheck-20261012.log` 和 `/tmp/paperclip-tdd-final-stable-build-20261012.log`。

未运行浏览器套件，未修改 UI，因此不需要 token gates。未提交、推送或创建 PR。

## 第二轮 CLI 修复计划

用户于 2026-10-12 授权继续修复本轮发现的两个 CLI 失败。

1. doctor：以完整日志中的 managed-install manifest 失败为线索，在隔离环境复现，确认是否为共享 PAPERCLIP_HOME 污染。补充能稳定触发原问题的回归，用最小 fixture 隔离或必要修复解决，不跳过检查、不放宽 summary.failed 断言。
2. company import/export e2e：保留 HOME、Paperclip instance 隔离与真实 CLI/server 启动覆盖。研究仓库已有已安装包管理器调用方式，补充离线回归，避免测试必须让 Corepack 下载 pnpm。不得通过修改用户 HOME、联网预热缓存或跳过 e2e 解决。
3. 每项先 red、后 green，再独立只读审查。跑完整 CLI 分组验证并行污染是否消失；根据修改范围运行 typecheck/build。补跑之前未覆盖的 workspace-b、workspace-c、serialized 分组，分别记录，不重复已通过且未受修改影响的耗时 Server 普通组。

### 第二轮实施与验证

- doctor 生产检查在调用时分别使用 PAPERCLIP_HOME 定位 install store、HOME 定位 shim。只隔离其中一项不足以排除安装痕迹。本轮只为原有测试提供独立 HOME/PAPERCLIP_HOME，并在 finally 恢复环境。外部污染环境 red 日志 `/tmp/issue-25-doctor-red.log` 稳定得到缺失 manifest 失败，原有 failed/warned/JWT 修复断言保留。移除无实际读取的污染目录 setup，不把它当成回归覆盖。
- company E2E 只显式保留调用者的 Corepack 缓存根目录并禁用 Corepack 网络访问。仍调用原 pnpm shim，不硬编码 pnpm 版本或缓存内部布局，不共享用户凭据目录。缓存不可用时明确失败，不联网补装。离线 red 日志 `/tmp/issue-25-corepack-red.log`，实际 E2E green 日志 `/tmp/issue-25-cli-company-import-export-green.log`，1 passed。
- workspace-b 补跑通过：17 projects，4695 tests passed，12 skipped。日志 `/tmp/paperclip-tdd-workspaces-b-round2-20261012.log`。
- workspace-c 补跑通过：50 files，181 tests passed。日志 `/tmp/paperclip-tdd-workspaces-c-round2-20261012.log`。
- 完整 CLI 第一轮回归：66 files passed，528 tests passed。全仓 typecheck/build 均通过。
- 独立审查指出 Corepack 缓存规则遗漏 LOCALAPPDATA/Windows 默认目录，已按安装版本的 getCorepackHomeFolder 规则补齐，新增 5 个路径优先级和平台默认值测试。最终完整 CLI：66 files passed，533 tests passed。最终 CLI typecheck/build：通过。旧规则不能满足 LOCALAPPDATA 分支的证据记录在 `/tmp/issue-25-corepack-platform-red-proof.log`。
- serialized server 于 2026-10-12 16:18 停止，退出码 1。前 19 个文件通过，第 20 个 `ai-connection-router.test.ts` 为 28 passed、1 failed。失败位于第 385 行 prepareManagedAiRuntime，报 Project authentication settings conflict，属于此前 cwd 祖先配置污染的同类症状，但该文件尚未修复。后续 137 个串行文件未运行。第一轮 CLI、serialized server、全仓 typecheck/build 日志分别为 `/tmp/paperclip-tdd-cli-full-round2-20261012.log`、`/tmp/paperclip-tdd-serialized-round2-20261012.log`、`/tmp/paperclip-tdd-typecheck-round2-20261012.log`、`/tmp/paperclip-tdd-build-round2-20261012.log`。最终平台兼容回归日志为 `/tmp/paperclip-tdd-cli-platform-final-20261012.log`。

### CLI pnpm helper 复审修复，2026-10-12

本轮只修改 company E2E、pnpm helper、helper 回归测试和本文档。其他已有改动保持不变，未修 ai-connection-router，未提交或推送。

- fallback probe 显式设置 `cwd: probe`。`--dir` 只能影响 pnpm，Corepack 在解析这些参数之前已按启动 cwd 选择版本。fixture 先检查 cwd，旧实现的三个 fallback 用例全部以退出码 98 失败。red 日志 `/tmp/issue-25-pnpm-probe-cwd-red.log`。
- pnpm 入口解析移入实际 E2E 的 `beforeAll`，在创建隔离 HOME/cache 之前执行。新增不支持 embedded Postgres 的模块收集回归，resolver 一旦调用就抛错；旧实现确实在模块顶层失败。red 日志 `/tmp/issue-25-pnpm-skip-red.log`。此回归注册一个明确跳过的 company suite，不跳过实际受支持主机上的 E2E。
- fallback 使用根项目已有 cross-env 所声明的 cross-spawn，不新增依赖、不自行拼接 shell 命令。通过 `import.meta.resolve` 定位 cross-env，再按其模块位置加载 cross-spawn，避免依赖 pnpm 的内部安装路径。cross-spawn 处理 Windows pnpm.cmd 和参数转义；成功后仍返回已安装 pnpm JS 入口，由 Node 直接执行真实 CLI/server。
- 去掉 helper 测试的整套 Windows skip。Windows fixture 使用 pnpm.cmd，仅不生成 POSIX 无扩展 shebang 可执行文件。fallback 的临时 cwd 带空格和 `&`，spy 保留实际调用并断言 cross-spawn 收到未拼接的参数数组。已安装入口覆盖空格、引号、`&`、`%PATH%`、`^` 和尾部反斜杠参数。实际 E2E 保留隔离 HOME/PAPERCLIP_HOME、空 Corepack cache、禁用 Corepack 网络以及失败 PATH shim，Windows 对应 shim 使用 pnpm.cmd。

最终验证均在 Linux 执行：

- 目标 E2E 和 helper：2 files passed，10 tests passed，1 skipped。日志 `/tmp/issue-25-pnpm-company-target-final.log`。真实 E2E 启动 CLI/server、执行导入导出并断言 Corepack cache 仍为空；唯一新增 skip 是模拟不支持 embedded Postgres 的回归套件。
- 串行完整 CLI：67 files passed，537 tests passed，1 skipped，135.23 秒。命令 `pnpm exec vitest run --project paperclipai --maxWorkers 1 --no-file-parallelism`。日志 `/tmp/issue-25-pnpm-cli-full-serial-final.log`。
- CLI typecheck 和 build 通过。日志 `/tmp/issue-25-pnpm-cli-typecheck.log`、`/tmp/issue-25-pnpm-cli-build.log`。
- `git diff --check` 通过。

Windows 原生 pnpm.cmd 启动和 cmd 参数转义未在 Windows 主机实测，不能声称 Windows red/green 通过；本轮实测了 Linux 上的真实 cross-spawn 调用、参数边界、fallback cwd 和 E2E。未联网安装或调用 provider，未重跑全仓 typecheck/build、非 CLI 测试或浏览器套件，不能宣称全仓绿色。此前 serialized server 的失败和未运行部分仍然保留。


### 交接续验，2026-10-12

本轮接手时 helper 的版本管理 CLI 配置、lifecycle 环境变量引用和 POSIX wrapper 已存在，不计为本轮新修。只新增混合大小写 PATH 回归，修正 E2E 环境构造：按 Node Windows 的字典序选择原搜索路径，删除其余大小写重复键，再添加失败 shim。移除 fixture 对配置参数的实现细节断言，改由真实 pnpm lifecycle 验证项目 .npmrc 与 env 的 true 配置；fixture registry 指向本机不可用端口，重试为零，不允许回归尝试外网下载。

TDD seam 沿用 resolver 的真实 lifecycle probe 和真实 CLI/server E2E，没有新增 seam。GLOSSARY.md 和 docs/adr 不存在。

- PATH red：`pnpm exec vitest run --project paperclipai cli/src/__tests__/test-pnpm.test.ts -t 'deduplicates mixed-case'`，1 failed，16 filtered/skipped。日志 `/tmp/issue-25-handoff-path-red.log`。修复后目标组合 17 passed，1 skipped。
- shell red-capability：临时单变量还原为动态 Node 路径双引号插值，运行 helper 的 `-t 'actual probe lifecycle'`，3 failed，3 passed，11 filtered/skipped。$HOME、反引号、$() 三项失败。恢复已有实现后 helper 16 passed，1 skipped。日志 `/tmp/issue-25-handoff-shell-red.log`、`/tmp/issue-25-handoff-helper-green.log`。
- wrapper red-capability：临时把 POSIX wrapper 单项还原为动态 Node shebang，相同生命周期命令 6 failed，11 filtered/skipped。已恢复，没有把已有 wrapper 修复称为本轮新修。日志 `/tmp/issue-25-handoff-wrapper-red.log`。
- 配置优先级真实 lifecycle green 已通过。临时只删除 manage-package-manager-versions CLI 参数未得到 red，3 passed，14 filtered/skipped，不能声称该配置测试证明了参数缺失必然下载。当前 pnpm 与另一 package-manager-strict=false 参数下未复现版本切换。保留两项禁用配置，明确这一回归敏感度缺口。日志 `/tmp/issue-25-handoff-config-red.log`。
- 目标 helper + 真实 E2E：`pnpm exec vitest run --project paperclipai cli/src/__tests__/test-pnpm.test.ts cli/src/__tests__/company-import-export-e2e.test.ts --maxWorkers 1 --no-file-parallelism`，2 files passed，17 passed，1 skipped，30.14 秒。日志 `/tmp/issue-25-handoff-target-green.log`。
- 当前最终代码完整 CLI：`pnpm exec vitest run --project paperclipai --maxWorkers 1 --no-file-parallelism`，67 files passed，544 passed，1 skipped，138.55 秒。日志 `/tmp/issue-25-handoff-cli-full.log`。唯一 skip 为模拟不支持 embedded Postgres 的套件；真实 Linux E2E 通过。
- `pnpm --filter paperclipai typecheck` 与 `pnpm --filter paperclipai build` 均退出 0。日志 `/tmp/issue-25-handoff-typecheck.log`、`/tmp/issue-25-handoff-build.log`。`git diff --check` 通过。

全部实测在 Linux。Windows 原生执行未测，混合 PATH 测试使用 Linux 上的普通 env 对象验证 Windows 选择规则。未开展独立子 Agent 复审；不能把自查称为独立审查通过。全仓认证冲突与后续 137 文件缺口仍在，未修 Server guard，未重跑全仓检查或浏览器测试。其它工作区改动保留。没有提交、推送、创建 PR、联网安装或调用真实 provider。

### pnpm lifecycle 回归有效性修正与最终复验，2026-10-12

- 复审发现 lifecycle wrapper 通过设置 `COREPACK_ROOT: ""`，并没有清除该环境变量；pnpm 将空字符串视为已设置，导致缺少 `manage-package-manager-versions=false` 的临时 red 仍然绿色。修正 `test-pnpm.test.ts` fixture：复制子进程环境后 `delete childEnv.COREPACK_ROOT`，不再赋空值。
- 按已授权的真实 lifecycle seam 做有效 red/green。临时只移除 helper 中禁用 pnpm 自动版本管理的 CLI 参数，真实 probe 的 6 个变体全部失败（6 failed，11 skipped），日志 `/tmp/issue-25-handoff-effective-red.log`。失败实际访问被 fixture 指向的本机 `127.0.0.1:9` registry 并收到 `ECONNREFUSED`，重试数为 0；未联网安装。恢复 helper 后与临时修改前备份逐字比较一致（`cmp` 退出码 0）。
- 修正后的最终 targeted helper + 真实 E2E：2 files passed，17 passed，1 skipped，日志 `/tmp/issue-25-handoff-final-target.log`。保留 `.npmrc`/env true 优先级覆盖、shell/Path/unsupported host 用例。
- 串行完整 CLI：67 files passed，544 passed，1 skipped，日志 `/tmp/issue-25-handoff-final-cli-full.log`。CLI typecheck、CLI build、`git diff --check` 均退出码 0；对应日志 `/tmp/issue-25-handoff-final-typecheck.log`、`/tmp/issue-25-handoff-final-build.log`、`/tmp/issue-25-handoff-final-diff-check.log`。每个日志末尾记录退出码。
- 最终目标快照 SHA-256 清单：`/tmp/issue-25-handoff-final-sha256.txt`，包含三个 CLI 目标文件和本计划的哈希。
- 所有验证均在 Linux。Windows 原生执行未测；此前 serialized server 的认证冲突及后续 137 个文件未执行缺口保持不变。未执行全仓检查、未访问凭据 HOME 配置、未调用 provider、未联网安装、未提交/推送/创建 PR。其他工作区改动保持原样。

### Linux 默认全仓入口续验，2026-10-13

本轮没有修改测试或生产代码。给定复审结果为 null，不代表独立审查通过；router diff 自查只含临时 cwd fixture，未发现新的确定缺陷。源文件开始/结束 hash 一致。

安全环境：env -i，仅保留必要 PATH/LANG 和隔离 HOME/XDG/PAPERCLIP_HOME；预加载 `/tmp/issue-25-linux-final-home/harness/deny-developer-ai-config.mjs`，拒绝开发者 AI 配置读取。实际 pnpm 入口为已安装 `/home/REDACTED/.cache/node/corepack/v1/pnpm/10.18.2/bin/pnpm.cjs`，通过临时 wrapper 使用 `--config.manage-package-manager-versions=false --config.package-manager-strict=false`，不调用 Corepack 下载。前两次临时 wrapper 错用无 config 前缀的参数，在测试启动前退出 1，日志 `/tmp/issue-25-linux-final-serialized.log`、`/tmp/issue-25-linux-final-serialized-2.log`；没有据此修改仓库。

 - 完整 serialized：157 files passed、3108 tests passed，退出 0，2505 秒。日志 `/tmp/issue-25-linux-final-serialized-3.log`。preload 拒绝 6 次 `/home/REDACTED/.codex/config.toml` 读取；没有读内容。既有正常/冲突 guard fixture 未放宽。后续 137 文件缺口已补齐。
- 字面 `pnpm test:run` 已执行，但失败并提前停止，不是全入口通过。general-server：866 files passed、3 failed、6 skipped；18556 tests passed、1 failed、109 skipped，Vitest 5994.90 秒，入口 5996 秒，退出 1。日志 `/tmp/issue-25-linux-final-tests.log`。两个 suite 初始化失败为 cargo ENOENT（dot-runner、native-codex-runner）；一个断言失败为 composio-app-setup 的 concurrent sync batches 预期 1、实际 0。本轮未进入 workspace-a/b/c 和入口内 serialized；独立完整 serialized 证据保留。该轮 preload 没有拒绝记录。
- Composio 最小诊断：未改代码，完整文件隔离重跑 22 tests passed、1 file passed，退出 0，24 秒。日志 `/tmp/issue-25-linux-final-composio-diagnostic.log`。这不是 fixture 修复 red/green，也不抹去全仓失败。后来在续验中针对同步竞态做了明确 provider 进入事件的 red/green，详见 2026-10-13 追加记录。
- 字面 `pnpm -r typecheck`、`pnpm build` 首次分别退出 1（6 秒、8 秒），cargo 不在隔离 PATH。日志 `/tmp/issue-25-linux-final-typecheck.log`、`/tmp/issue-25-linux-final-build.log`。补入已安装 Rust toolchain bin 后依序重试，CARGO_NET_OFFLINE=true、CARGO_HOME 为全新临时目录；分别退出 101（7 秒、9 秒），缺少离线 crates.io `aes-gcm`。日志 `/tmp/issue-25-linux-final-typecheck-2.log`、`/tmp/issue-25-linux-final-build-2.log`。没有联网补装，也没有读取开发者 Cargo 配置/凭据或让 runner 继承真实 HOME。

未完成范围：全入口 workspace-a/b/c 本轮未运行（此前成功记录保留但不是本轮全仓绿色）；native runner 两个初始化失败尚未在离线依赖可用环境重跑；Composio 全仓失败根因未确定；全仓 typecheck/build 被隔离 Cargo 缓存缺口阻塞。默认入口之外 runner 专项、browser、Windows 原生验证未运行。没有并行重型数据库/build，没有 skip 新失败，没有修改 guard、删用户文件、联网安装、provider 调用、提交、推送或创建 PR。最终日志/目标文件 SHA-256 清单 `/tmp/issue-25-linux-final-sha256.txt`；`git diff --check` 退出 0。

### Router 与 Composio fixture 续修，2026-10-13

- 更正早先 router 记录：原始 28 passed/1 failed 的证据是 `/tmp/paperclip-tdd-serialized-round2-20261012.log`；`/tmp/issue-25-server-router-red.log` 实为安全 preload 下 29 passed，不可称 red 或安全 green，且确有读取拦截提示。此前在其后写下的“已修复 / router green”措辞不准确，本节提供更可审计的续验记录。
- router 隔离复现使用仅含无敏感 marker (`model_provider = "paperclip-fixture-conflict"`) 的 `/tmp/issue-25-linux-round2-router-project/.codex/config.toml`，测试进程处于 env-i 隔离 HOME 下并装载开发者配置保护 preload。定向启动 3 用例时前两例因其前置 feature-enable 测试被过滤而出现无关失败；因此完整文件作为 red 验证：28 passed、1 failed，失败指向无 cwd 的 session-identity runtime 配置并确认为项目配置冲突。完整文件修复后 29 passed。Pool repair 已带 cwd；另将 managed-mode adoption 两个 prepare 调用与 session identity 用例的三个 prepare 调用统一显式加 `cwd: home`。不改 runtime/guard。
- Composio 使用 `f.onList` seam，加 providerEntered 通知 promise，在真实 `onList` provider fixture callback 进入后再断言单次 batch；finally 中释放 held promise 并等待 `finishSync`，之后保留全部 ready/批次大小/36 个 toolkit 唯一性断言。无 sleep/timeout，生产代码不变。
- Composio 旧用例自然重复 8 次仍是绿色，不能作为 red。最终隔离 pre-transform 调度闸门以旧的早断言为准，在实际 provider call 前暂停 worker，原断言稳定 8/8 收到 `expected [] length 1 but got 0`；用于此 red 的诊断器会改写被测测试模块，故只作竞态重现证据、不作 green。修改后的真实源码独立完整文件 22 passed；当时标为 repeat8 的日志实际只证明一次 1 passed，不能记为修复后重复 8 次（本次真实 8 次串行证据见下节）；provider-entered gate 的真实代码变体也 1 passed。完整两个文件串行 51 passed。
- 认证回归 `ai-connections`、`agent-hire-ai-connections`、`ai-legacy-compatibility` 为 3 files / 189 tests passed。目标运行使用 env-i 隔离 HOME、XDG_CONFIG_HOME、PAPERCLIP_HOME，不联网、不真实 provider。router green 日志内未见安全 preload 的 developer-config deny 记录。所有相关运行退出码及 SHA-256 见 `/tmp/issue-25-linux-round2-logs/` 下各 `.log` / `.sha256`。
- `doc/plans` 记录的是本次目标验证，不代表恢复全仓入口；2026-10-13 默认入口的 Cargo 缺失/离线依赖缺口与 browser、workspace、native runner 等尚未验证范围仍有效。本轮未提交、推送或创建 PR。


### Linux 默认入口完整续验，2026-10-13

本轮最终源码快照已顺序完成 `pnpm -r typecheck`、字面 `pnpm test:run`、`pnpm build`，均退出 0。没有提交、推送、PR、联网安装或真实 provider 调用；未修改用户原有改动。进程使用 env-i、临时 HOME/XDG_CONFIG_HOME/PAPERCLIP_HOME/CARGO_HOME；Cargo 仅链接 `/home/REDACTED/.cargo/registry` 纯依赖缓存，未读取/复制 Cargo config 或 credentials。使用已安装 pnpm 9.15.4 JS 入口，避免 Corepack 和自动版本安装。安全 preload 对开发者 AI 配置读取抛 EACCES，未以 ENOENT 伪装不存在；最终三个入口 deny 均为 0。

- 真实源码 Composio 同一并发 lease 用例按仓库原生 Vitest 配置串行执行 **8 次、8 次成功**，每次 1 passed、21 因 -t 未选中，退出 0，deny 0；独立日志 `/tmp/issue-25-linux-complete-repeat-1.log` 至 `repeat-8.log`，分别 21/21/20/21/20/21/20/20 秒。未替换 transform。这纠正了上节单次 repeat8 日志误记。
- native 两目标完整串行：`native-codex-runner.integration.test.ts` 与 `dot-runner.test.ts`，2 files / 39 tests passed，143 秒，退出 0，deny 0。Codex vertical slice 通过已有 providerLaunch seam 启动 fake-codex；Cargo 离线真实编译，没有 skip Rust。日志 `/tmp/issue-25-linux-complete-native-integration.log`。
- 首轮全入口采用 pnpm 10.18.2 时，子进程尝试离线解析项目要求的 pnpm 9.15.4，typecheck/test/build 均退出 1；没有下载成功。改用已安装匹配版本后 typecheck 153 秒、build 34 秒退出 0。初次完整 test 在 workspaces-c 出现 attribution migration 的 20 秒 test timeout 与 10 秒 cleanup hook timeout（179 passed、2 failed），因此入口 6704 秒退出 1、serialized 尚未执行。窄文件独立诊断 3 tests passed、32 秒，未加等待、未放宽 timeout、未改 DB 或生产代码。该轮失败保留在 `/tmp/issue-25-linux-complete-test-run-final.log`，不冒称绿色。
- 为填补 serialized 缺口，独立运行时在 heartbeat-process-recovery 的 missing_default 用例真实拒绝 `/home/REDACTED/.codex/config.toml`，该文件 399 passed / 1 failed、guard deny 1。窄 red 为 5 passed / 1 failed、24 秒、deny 1。最小 fixture-only 修复仅给六个配置恢复用例建立临时 cwd，通过既有 adapterConfig.cwd seam 隔离项目配置并 finally 清理；未 mock missing_default、未放宽 guard、未改断言或生产代码。窄 green 为 6 passed、24 秒、deny 0。日志 `/tmp/issue-25-linux-complete-recovery-config-{red,green}.log`。本轮唯一代码修改为 `server/src/__tests__/heartbeat-process-recovery.test.ts`。

最终源码入口证据：

| 入口/分组 | 结果 | 时间/日志 |
| --- | --- | --- |
| pnpm -r typecheck | exit 0，deny 0 | 41 秒；`/tmp/issue-25-linux-complete-typecheck-snapshot.log` |
| pnpm test:run | exit 0，deny 0，完整五分组 | 9132 秒；`/tmp/issue-25-linux-complete-test-run-snapshot.log` |
| general-server | 869 files passed、6 skipped；18596 tests passed、70 skipped | 最终入口同日志 |
| general-workspaces-a | 789 files passed；8686 tests passed、1 skipped | 最终入口同日志 |
| general-workspaces-b | 295 files passed、2 skipped；4695 tests passed、12 skipped | 最终入口同日志 |
| general-workspaces-c | 50 files passed；181 tests passed | 最终入口同日志 |
| serialized | 157/157 files passed；3108 tests passed | 最终入口同日志；不是旧轮证据 |
| pnpm build | exit 0，deny 0 | 35 秒；`/tmp/issue-25-linux-complete-build-snapshot.log` |

合计 2160 files passed、8 原有 skipped，35266 tests passed、83 原有 skipped，0 failed；没有新增 skip。统计 JSON `/tmp/issue-25-linux-complete-counts.json`，全部命令退出码/时间/拒绝次数 `/tmp/issue-25-linux-complete-run/summary.txt`。typecheck 的 Cargo 显式使用 CARGO_BUILD_TARGET=x86_64-unknown-linux-gnu；native/build 保留脚本默认 host target（同为 Linux x86_64），避免破坏脚本固定 target/release 的读取路径。没有修改仓库 build 脚本。Linux 成功不证明 Windows/macOS/WASM；browser、runner 专项和 Windows 默认入口外验证未运行。

最终日志/相关文件 SHA-256 清单 `/tmp/issue-25-linux-complete-sha256.txt`；`git diff --check` 结果 `/tmp/issue-25-linux-complete-diff-check.log`。本轮新增修改边界仅上述 fixture 与本计划；初始工作树记录 `/tmp/issue-25-linux-complete-initial-status.txt`，最终记录 `/tmp/issue-25-linux-complete-final-status.txt`。

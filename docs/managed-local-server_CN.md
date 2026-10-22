# 受管理的本机服务扩展

这个 fork 可以把本机 loopback Web 服务打包为桌面客户端。普通 Pake 构建不会启用该扩展；只有同时传入 `--server-port` 和 `--server-command` 时，才会编译本机进程管理运行时。

## 参数

| 参数                            | 说明                                           |
| ------------------------------- | ---------------------------------------------- |
| `--server-port <number>`        | 需要探测和管理的本机端口，范围 1-65535。       |
| `--server-command <string>`     | 启动本机服务的前台 Shell 命令。                |
| `--server-timeout <seconds>`    | 启动超时，范围 1-3600 秒，默认 `30`。          |
| `--traffic-light-x <number>`    | macOS 红黄绿窗口按钮的横向位置。               |
| `--traffic-light-y <number>`    | macOS 红黄绿窗口按钮的纵向位置。               |
| `--drag-region-height <number>` | 顶部拖拽区域高度，默认 `20`，设为 `0` 可禁用。 |

`--server-port` 和 `--server-command` 必须同时提供。目标必须是使用 `localhost`、`127.0.0.1` 或 `::1` 的 HTTP/HTTPS URL，而且有效端口必须等于 `--server-port`。受管理服务不能与 `--multi-instance` 同时使用。

应用启动时会复用已有监听端口，并且不会取得该进程的所有权。端口未监听时，macOS/Linux 通过用户登录 Shell、Windows 通过 `cmd.exe` 执行命令，然后等待端口就绪。隐藏窗口不会停止客户端启动的服务；真正退出应用时，只会清理该应用启动的进程树。

服务命令会编译进应用，不要在 `--server-command` 中直接写入密码、令牌等秘密。命令必须保持前台运行；自行 daemonize 后退出的命令无法可靠管理。

交通灯坐标必须配合 `--hide-title-bar` 使用，而且只在 macOS 生效。Windows/Linux 无边框客户端可以使用 `--hide-window-decorations --drag-region-height 10`。

## Pi Web

完整构建命令、资源和专项测试见 [Pi Web 构建说明](../build/pi-web/README.md)。

## Fork 维护边界

CLI 增强入口委托 `bin/extensions/managed-local-app/` 内的公共类型、参数解析、服务校验和窗口覆盖。配置加载器只分发一次增强字段；上游原有数值校验和精确 origin 权限生成继续负责原有行为。

原生实现封装在 `src-tauri/extensions/pake-enhancements` workspace crate 中。应用只保留单实例插件之后的运行时入口，以及所有窗口共用的构建入口。通过 flatten 配置保留现有 JSON 字段。窗口定制独立于 `managed-server` feature；对话框和进程管理依赖仅在受管理服务构建中启用。

`.github/managed-local-apps.json` 保存配方路径和通用平台目标；Pi Web 配方位于 `build/pi-web/recipe.json`，发布流程据此生成构建矩阵和预期产物文件名。增加应用只需增加配方，现有应用标识和发布文件名保持兼容。

上游测试完整保留。增强单元测试为 12 个 TypeScript 用例和 4 个 Rust 进程生命周期用例；`tests/integration/managed-local-app.mjs` 通过同一个通用原生夹具验证普通构建、并发启动、CSP 弹窗、最小化后服务存活和退出清理。Pi Web 注入测试单独维护。

同步上游后执行：

```shell
pnpm run cli:build
pnpm exec vitest run
cd src-tauri
cargo test --locked --workspace --lib
cargo test --locked --workspace --lib --features managed-server
cargo test --locked --workspace --lib --features runtime-template
cargo test --locked --workspace --lib --features managed-server,runtime-template
cargo clippy --locked --workspace --all-targets --features managed-server,runtime-template -- -D warnings
cd ..
node tests/integration/managed-local-app.mjs
```

Enhancement Compatibility 工作流在 macOS、Linux、Windows x64 和 Windows ARM64 上执行四种 feature 组合的测试、Clippy 和原生验收；ARM64 任务还检查实际 MSI 的平台元数据。Linux 原生验收使用 Xvfb 和 D-Bus 会话。

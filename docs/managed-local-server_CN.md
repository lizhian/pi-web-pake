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

## DeepSeek Harness

DeepSeek Harness 通常需要在终端中持续运行 `dsh web`。以下构建会把它转换为桌面客户端工作流：

```shell
node dist/cli.js http://127.0.0.1:3080 \
  --name "DeepSeek Harness" \
  --identifier "com.example.dshweb" \
  --server-port 3080 \
  --server-command "dsh --profile web --no-open --host 127.0.0.1 --port 3080" \
  --server-timeout 60 \
  --hide-title-bar \
  --traffic-light-x 2 \
  --traffic-light-y 6 \
  --drag-region-height 10 \
  --targets dmg
```

这里必须使用固定端口，不能使用 `dsh web --port 0`，因为桌面客户端需要稳定 URL。`--no-open` 用于阻止 DeepSeek Harness 同时打开系统浏览器。打包后的应用所使用的 Shell `PATH` 必须能够找到 `dsh`。

交通灯坐标必须配合 `--hide-title-bar` 使用，而且只在 macOS 生效。Windows/Linux 无边框客户端可以使用 `--hide-window-decorations --drag-region-height 10`；交通灯坐标会被忽略。

## Pi Web

```shell
node dist/cli.js http://127.0.0.1:30141 \
  --name "Pi Web" \
  --server-port 30141 \
  --server-command "pi-web --hostname 127.0.0.1 --port 30141 --no-open" \
  --hide-title-bar \
  --traffic-light-x 2 \
  --traffic-light-y 6 \
  --drag-region-height 10 \
  --targets dmg
```

## Fork 维护边界

扩展的大部分行为由上游不存在的独立文件负责：

- `bin/extensions/managed-local-app.ts`：CLI 参数、校验、配置规则、窗口覆盖和 loopback capability 生成。
- `src-tauri/src/local_server.rs`：通过 Cargo feature 控制的 Tauri plugin，以及跨平台进程生命周期。
- `src-tauri/src/inject/managed-window.js`：自定义拖拽区域覆盖。
- `tests/unit/server-*.test.ts`、`style-drag-region.test.js` 和 `managed-server-feature.test.ts`：fork 功能测试。

上游集成面只保留在 CLI program、参数解析、配置合并、构建 feature 列表、共享类型以及 Tauri 窗口/应用初始化中的少量挂钩。默认 `pake.json`、上游注入样式、上游 CLI 文档、Agent 契约和上游测试快照保持不变。

同步 `upstream/main` 后执行：

```shell
pnpm run cli:build
npx vitest run
cd src-tauri
cargo test
cargo test --features managed-server
cargo clippy --all-targets --all-features -- -D warnings
```

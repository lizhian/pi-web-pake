# Pi Web 桌面客户端

Pi Web 的配方、图标、注入脚本和专项测试集中在本目录。macOS 界面增强通过 Pake 现有的 `--inject` 接口加载，系统打开授权通过通用增强参数 `--allow-open-path` 启用。

macOS 文件树在悬停或键盘聚焦时显示“打开”图标，位于提及和下载按钮右侧。目录进入系统文件管理器，文件使用系统默认应用打开原路径。授权按应用的固定入口源生效，允许打开当前用户可访问的本地路径，包含隐藏项，范围不限于文件树根目录；普通浏览器不显示该按钮。

## 本地构建

先安装 `pi-web`，确保应用启动时用户登录 Shell 的 `PATH` 能找到它；服务命令必须保持前台运行。已有服务会直接复用，应用只清理自己启动的服务进程树。通用行为见[受管理服务说明](../../docs/managed-local-server_CN.md)。

在项目根目录运行 `pnpm install --frozen-lockfile` 和 `pnpm run cli:build`，然后执行完整命令：

```bash
node dist/cli.js http://127.0.0.1:30141 \
  --name "Pi Web" \
  --identifier com.lizhian.piweb \
  --icon build/pi-web/assets/pi_web.icns \
  --app-version 26.10.21 \
  --server-port 30141 \
  --server-command "pi-web --hostname 127.0.0.1 --port 30141 --no-open" \
  --server-timeout 30 \
  --hide-title-bar \
  --traffic-light-x 11 \
  --traffic-light-y 16 \
  --drag-region-height 10 \
  --targets apple \
  --new-window \
  --allow-open-path \
  --enable-drag-drop \
  --enable-find \
  --safe-domain 127.0.0.1:30141 \
  --wasm --camera --microphone \
  --inject build/pi-web/scripts/pi-web-inject.css,build/pi-web/scripts/pi-web-inject.js \
  --iterative-build \
  --install \
  --json
```

这是 macOS ARM64 本地构建命令；Intel Mac 将 `apple` 改为 `intel`。`--iterative-build` 生成 `.app`，`--install` 安装到 Applications。应用标识和服务端口沿用原约定。托盘 PNG 作为资源保留；上述命令沿用默认托盘行为。

## CI 正式安装包

[Build Pi Web 工作流](../../.github/workflows/managed-local-apps.yml)读取 [recipe.json](recipe.json)，通过通用构建脚本生成完整 CLI 参数数组。根注册表只保存配方路径和平台矩阵。

所有平台启用新窗口、拖放、查找、safe-domain 和 WASM。CSS/JS 注入仅在 macOS 启用；macOS 使用 ICNS、隐藏标题栏、交通灯坐标 `11/16`、拖拽区域高度 `10`、摄像头和麦克风权限。Windows/Linux 使用 PNG 和无边框窗口。CI 按上海日期生成版本，不传 `debug`、`iterative-build` 或 `install`。

六个构建任务生成八个安装包：macOS x64/ARM64 各一个 DMG，Windows x64/ARM64 各一个 MSI，Linux x64/ARM64 各一个 DEB 和 AppImage。发布前根据配方校验完整产物清单。

可先查看参数与预期产物，不执行构建：

```bash
node .github/scripts/managed-local-app-plan.mjs --matrix
PAKE_BUILD_APP=pi-web PAKE_BUILD_PLATFORM=macos PAKE_BUILD_ARCH=arm64 \
  PAKE_BUILD_TARGETS=apple \
  PAKE_RELEASE_TAG=v20261021 PAKE_APP_VERSION=26.10.21 \
  node .github/scripts/build-managed-local-apps.mjs --plan
```

## 核心测试

专项测试独立于上游测试，由 Enhancement Compatibility 工作流运行，保留 8 个快速用例、7 个浏览器用例（5 个标题栏／历史布局、2 个文件打开）和 1 个原生场景：

```bash
# 8 fast cases: isolation, proxies, delegation, contexts, links and failures
node --test build/pi-web/tests/popup.test.mjs

# 7 browser cases: titlebar transitions, file panel, history and native Open buttons
# Install the pinned runtime outside the project dependencies
PI_WEB_TEST_RUNTIME="$(mktemp -d)"
npm install --prefix "$PI_WEB_TEST_RUNTIME" --no-save --package-lock=false playwright@1.62.1
node "$PI_WEB_TEST_RUNTIME/node_modules/playwright/cli.js" install chromium
PAKE_PLAYWRIGHT_MODULE="$PI_WEB_TEST_RUNTIME/node_modules/playwright/index.mjs" \
  node --test build/pi-web/tests/titlebar.test.mjs build/pi-web/tests/file-open.test.mjs

# 1 macOS scenario: direct/implicit WKWebView popups, black loading, opener and main URL
node build/pi-web/tests/native-popup.mjs
```

测试资源相对脚本自身读取。浏览器和原生验收仅在 macOS CI 上执行；快速用例在所有增强兼容性平台执行。原生场景在临时目录使用同一配方的完整功能参数构建、运行应用，替换服务地址和身份为隔离夹具，不安装到 Applications。构建产物和诊断日志的位置会打印在输出中。

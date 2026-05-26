# pi extensions

这是一个个人使用的 [pi coding agent](https://github.com/earendil-works/pi-coding-agent) 扩展仓库。

## 目录结构

```text
extensions/
  *.ts              # 单文件扩展，可直接放入 pi extensions 目录
  question/         # 多文件扩展，入口为 index.ts
    index.ts
test/
  question/         # question 扩展的测试
```

> 注意：不要把整个仓库根目录直接当成 pi 的 extensions 目录使用。pi 自动发现的是 `.pi/extensions/*.ts` 和 `.pi/extensions/*/index.ts`，因此应将 `extensions/` 下面的内容复制或软链接到 pi 的 extensions 目录。

## 扩展列表

| 扩展 | 说明 |
| --- | --- |
| `question/` | 注册 `question` 工具，让 LLM 可以在执行过程中向用户提问。支持单选、多选、自定义输入、多问题确认流程，以及 Esc dismiss 抛错。实现参考 opencode 的 question tool 行为。 |
| `autogit.ts` | 提供 `/autogit` 命令，快速执行 `git add -A`、commit、push。可以传入提交信息；不传时会根据 diff 统计生成一个简单提交信息。非主分支 push 后会提示 PR URL。 |
| `custom-header.ts` | 自定义 pi 启动 header，显示彩色 π logo、当前模型、git 状态提醒、已加载 extensions / skills 数量。提供 `/custom-header` 和 `/custom-header-builtin`。 |
| `env-info.ts` | 在每轮开始前向 system prompt 注入运行环境信息，例如 OS、Shell、Terminal、Encoding，方便模型理解当前执行环境。 |
| `exit.ts` | 提供 `/exit` 命令，用于优雅退出 pi。 |
| `ghostty.ts` | Ghostty 终端集成：动态设置窗口标题，并在 agent 工作时驱动 Ghostty 原生进度条和 spinner。**目前只在 macOS + Ghostty 中测试过，其他系统/终端未测试。** |
| `git-guard.ts` | Git 安全保护：拦截可能打开交互式编辑器的 `git commit` / `git rebase --continue`；同时要求 `git commit -m` 的提交信息包含中文描述。 |
| `pi-footer.ts` | 自定义两行 footer：显示模型、provider、thinking level、上下文占用 Pac-Man 进度条、token 统计、git 分支、运行时版本、TPS；同时替换 prompt editor，使用 Claude Code 风格的 `❯` 标记。 |
| `pi-notify.ts` | agent 完成较长任务、出错或输出被截断时发送终端桌面通知，使用 OSC 777。**目前只在 macOS 中测试过，其他系统/终端未测试；实际支持取决于终端。** |
| `rainbow-spinner.ts` | 自定义 agent 工作中的提示文案和 spinner：中文动词、彩虹 shimmer、thinking 状态显示、长时间无 token 时变红提示。 |

## 安装 / 使用

### 项目级扩展

将需要的扩展复制到项目的 `.pi/extensions/`：

```bash
mkdir -p .pi/extensions
cp extensions/*.ts .pi/extensions/
cp -R extensions/question .pi/extensions/question
```

### 全局扩展

将需要的扩展复制到 `~/.pi/agent/extensions/`：

```bash
mkdir -p ~/.pi/agent/extensions
cp extensions/*.ts ~/.pi/agent/extensions/
cp -R extensions/question ~/.pi/agent/extensions/question
```

如果只想安装部分扩展，也可以只复制对应文件。例如只安装 `question`：

```bash
mkdir -p ~/.pi/agent/extensions
cp -R extensions/question ~/.pi/agent/extensions/question
```

修改已安装扩展后，在 pi 内执行：

```text
/reload
```

## 测试

当前只有 `question` 扩展有测试：

```bash
bun test test/question/state.test.ts test/question/format.test.ts
```

也可以运行全部测试：

```bash
bun test test/**/*.test.ts
```

## 备注

- `pi-footer.ts` 会替换 footer 和 prompt editor；如果同时安装其他会替换 footer/editor 的扩展，后加载的扩展可能覆盖前者。
- `rainbow-spinner.ts` 会替换工作中的 spinner / working message；如果同时安装其他 working indicator 扩展，效果可能互相覆盖。
- `ghostty.ts` 和 `pi-notify.ts` 涉及终端私有/半通用 OSC 能力，已注明测试环境限制。

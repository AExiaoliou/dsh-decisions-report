# dsh-decisions-report

记录 DeepSeek Harness 中的关键决策，并在会话视图中展示。

## 安装

```bash
npm install dsh-decisions-report
```

安装后由 DSH 插件系统加载。它注册独立的 `record_critical_decision` 工具、`criticalDecisions` 会话投影，以及 `critical-decisions` skill；不依赖可选的 action-card 服务。

## 开发

```bash
npm run check
npm run build
```

## License

[MIT](./LICENSE)

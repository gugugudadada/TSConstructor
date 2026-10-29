# TSConstructor2

TSConstructor2 是一个浏览器端的一维时序**类别构造与实验工具**：从已有样本中取材，在时间轴上选择区间、叠加模板操作、组合配方，并生成新的类别候选。

本仓库**只包含 TSConstructor2**，不包含 `TSResearchWorkbench`。

- 前端：Vue 3 + Vite
- 计算：优先在浏览器内完成，无后端服务
- 数据：UCR 格式文本，随仓库一起提供
- 运行环境：Node.js 18+（推荐 Node.js 20）

## 快速开始

```bash
git clone https://github.com/<your-name>/TSConstructor2.git
cd TSConstructor2

npm ci
npm run dev
```

浏览器打开：

```text
http://localhost:5174
```

如果 `npm ci` 因锁文件或网络失败，可以改用：

```bash
npm install
```

生产构建：

```bash
npm run build
npm run preview
```

## 数据集

数据集已经放在 `public/data/`，**clone 后不需要另外下载**。应用启动时会通过 `/data/...` 读取这些文件。

| 文件 | 内容 | 规模 |
| --- | --- | --- |
| `public/data/Wafer_TRAIN.txt` | Wafer 训练集 | 1000 条 |
| `public/data/Wafer_TEST.txt` | Wafer 测试集 | 6164 条 |
| `public/data/ECG5000_TRAIN.txt` | ECG5000 训练集 | 500 条 |

文件格式为 UCR 文本格式：

```text
<class-label> <value-1> <value-2> ... <value-n>
```

Wafer 数据来自 UCR Time Series Classification Archive。数据集的使用与再分发请遵循原始数据集页面上的许可说明：

- <https://www.timeseriesclassification.com/>

`Wafer_TEST.txt` 约 15 MB，仍低于 GitHub 单文件 100 MB 限制，因此不需要 Git LFS。

## 评估脚本

Wafer 端到端 1NN 评估：

```bash
npm run test:wafer
```

默认输出两份结果：

- 全量 `Wafer_TRAIN` 训练（1000 条）
- 仅正常类 `1.0000000e+00` 训练（903 条）

两份结果都在完整 `Wafer_TEST`（6164 条）上测试。

用导出的候选 JSON 做自定义训练：

```bash
npm run test:wafer -- --train scripts/wafer_test/<export>.json
```

也可以运行 `scripts/wafer_test/` 下所有 JSON 的一键汇总：

```bash
npm run test:wafer:suite
```

结构识别与目标匹配测试：

```bash
npm run test:structures
npm run test:structure-matching
```

## 目录

```text
public/data/          随仓库提供的数据集
src/components/       界面组件
src/engine/           波形操作、结构识别、结构匹配、评估
src/store.js          会话状态与操作入口
scripts/              Wafer 评估与测试脚本
docs/                 系统说明
```

更完整的交互说明见 [`docs/current-system-guide.md`](docs/current-system-guide.md)。

## 常见问题

### 启动后页面没有数据

确认 `public/data/` 下三个 `.txt` 文件都存在，并且是通过 `npm run dev` 或 `npm run preview` 启动，而不是直接双击 `index.html`。

### 端口被占用

Vite 默认端口是 `5174`，可以在 `vite.config.js` 中修改，或临时使用：

```bash
npm run dev -- --port 5175
```

### 需要把站点部署到 GitHub Pages 子路径

当前数据路径以 `/data/...` 开头，适合本地运行和部署在域名根路径。如果部署到 `https://<user>.github.io/<repo>/`，需要同时配置 Vite 的 `base` 并调整数据加载路径。

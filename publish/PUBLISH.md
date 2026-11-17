# 发布到 DSH 插件市场

## 状态

| 步骤 | 状态 |
|---|---|
| 仓库公开：`https://github.com/mouse985/dsh-ask-panel` | ✅ 已完成（MIT，topics 含 `dsh-plugin`） |
| `package.json` 指向该仓库（npm 关联用） | ✅ 已完成（`repository` / `homepage` / `bugs`） |
| 本机 desktop profile 安装并验证 | ✅ 已完成（host 半热加载，`ask_user` 已在工具清单里） |
| 仓库根 `screenshots.json`（市场截图，1–8 张） | ✅ 已完成（4 张，`assets/panel-*.png`） |
| `npm publish` | ⬜ 可选 |
| 向精选列表提 PR（`data/plugins/mouse985__dsh-ask-panel.yml`） | ⬜ 待做（仓库满 1 天后 CI 才放行） |

市场（`https://awesome-dsh-plugin.com/plugins.json`）只收录
`awesome-dsh-plugin/awesome-dsh-plugin` 精选列表里的条目，所以「上市场」= **仓库是一个能被
`dsh plugin add` 安装的 bundle → 向精选列表提一个 YAML 文件的 PR**。收录后站点与市场一天内自动同步。

---

## 1. 仓库里已就位的东西

| 文件 | 作用 |
|---|---|
| `package.json` | `dsh.bundle.patch` 指向 `cordis.patch.yml`（收录硬门槛）、`dsh.client` 声明 web 客户端半、`repository`/`homepage`/`bugs` 指回仓库、`keywords` 含 `dsh-plugin` |
| `cordis.patch.yml` | `insert: [{ id: ask-panel, name: 'dsh-ask-panel' }]` |
| `locale/en.json`、`locale/zh.json` | 插件管理里显示的名称与描述（`meta.title` / `meta.description`） |
| `icon.svg` | 插件行与详情页图标（包内相对路径，`exports["./icon"]` 也指向它） |
| `LICENSE` | MIT |
| `.gitignore` | 忽略 `node_modules/` |
| `screenshots.json` | 市场详情页截图顺序（4 张，相对路径） |
| `publish/mouse985__dsh-ask-panel.yml` | 精选列表投稿文件本体 |

## 2. 安装验证

```sh
dsh plugin --profile verify add github:mouse985/dsh-ask-panel
dsh web --profile verify
```

在页面里让模型问一次问题（例如「用提问工具问我下一步做什么」），应当看到卡片接管输入框、
悬停选项 0.5 秒后右侧弹出影响预览、预览底部能写意见。验证完 `dsh plugin --profile verify remove dsh-ask-panel`。

## 3. npm（可选）

```sh
npm login
npm publish --access public
```

不发也能被收录（精选列表接受纯 GitHub 安装）；发的好处是市场能显示下载量、用户安装时跳过源码构建的 `allowBuilds` 授权。
包名 `dsh-ask-panel` 若被占用，改 scoped `@mouse985/dsh-ask-panel`，同时改 `cordis.patch.yml` 里的 `name` 后重新发布。

## 4. 向精选列表提 PR（这一步才叫「上市场」）

1. Fork `https://github.com/awesome-dsh-plugin/awesome-dsh-plugin`。
2. 只加**一个文件**：`data/plugins/mouse985__dsh-ask-panel.yml`，内容取本目录的
   `publish/mouse985__dsh-ask-panel.yml`。**不要手改 README**（由 `data/plugins/*.yml` 生成）。
3. 分支名如 `add-dsh-ask-panel`，提 PR。
4. CI 检查：条目数 ≤3、`dsh.bundle` 存在、仓库满 1 天、`awesome-lint` 与站点构建。

字段取值：`url` / `name` 指向本仓库，`category: ui`（卡片接管 composer，属界面增强），
`description.en` / `description.zh` 已写好；`icon` 省略则回退到 GitHub 头像（若要显式指定，必须是 GitHub 托管的方形位图，SVG 会被拒）。

## 5. 收录之后

- 站点与市场通常一天内自动同步；市场实时拉 `https://awesome-dsh-plugin.com/plugins.json`，连不上时可指向镜像：`DSHM_REGISTRY_URL=https://mirror/plugins.json dsh web`。
- 改截图只需改本仓库的 `screenshots.json`，夜间构建自动生效，不必再提 PR。

## 一句话版本

```sh
# 1) 仓库已公开（含 dsh-plugin topic）  2) 可选 npm publish
# 3) fork 精选列表，加 data/plugins/mouse985__dsh-ask-panel.yml，提 PR
# 4) 收录后：dsh plugin --profile desktop add dsh-ask-panel
```

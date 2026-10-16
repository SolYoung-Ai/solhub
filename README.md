# SolHub — Discover. Build. Share.

**SolHub** 是一个独立产品发现平台与在线工具箱：探索独立开发者正在创造的产品，使用简单、实用、免费的在线工具。

- 品牌体系继承 [SolYoung Studio](https://solyoung.top/studio/)（同一设计令牌：米色背景、墨色文字、橙色强调、Archivo/Noto 字体）
- 信息架构参考 RankCert 的产品榜单思路，但拥有独立的品牌、规则与实现
- 静态生成，优先适配 GitHub Pages，无服务器依赖

## 技术栈

- [Astro](https://astro.build)（静态生成，`output: "static"`）
- TypeScript
- React 19 交互组件（`@astrojs/react`，islands 架构）
- Tailwind CSS v4（`@tailwindcss/vite`，设计令牌集中在 `src/styles/global.css` 的 `@theme`）
- `@astrojs/sitemap`（自动生成 sitemap）、`lucide-react`（统一图标）、`qrcode`、`marked + dompurify`

## 本地开发

```bash
npm install
npm run dev          # 本地开发，默认 http://localhost:4321
npm run build        # 构建到 dist/
npm run preview      # 预览构建产物
npm run check        # astro check 类型与模板检查
npm test             # vitest 单元测试（工具纯逻辑）
```

## 目录结构

```
├── src/
│   ├── data/            # 统一数据源：products / tools / categories / site
│   ├── lib/             # 纯逻辑：ranking 排序、search 搜索、submission 提交适配层、tools/* 工具逻辑
│   ├── components/      # Astro 组件（Logo / Header 骨架 / Footer / 卡片 / tool-ui）
│   ├── islands/         # React 交互组件（HeaderApp 搜索、LaunchesExplorer、ToolsExplorer、SubmitForm、tools/*）
│   ├── layouts/         # BaseLayout（SEO head + 导航 + 页脚）
│   ├── pages/           # 路由：/ /launches/ /tools/ /tools/[slug]/ /products/[slug]/ /submit/ /about/ /privacy/ 404 robots.txt
│   └── styles/global.css
├── tests/               # vitest 单元测试
├── public/favicon.svg
└── .github/workflows/deploy.yml   # GitHub Pages 自动部署
```

## 页面

| 路由 | 说明 |
| --- | --- |
| `/` | 首页：Hero + 本周榜单 + 热门工具 + 分类入口 + 新收录 + 提交引导 |
| `/launches/` | 产品发布榜单：分类筛选 / 关键词搜索 / 榜单顺序与最新收录排序 / 加载更多 |
| `/products/[slug]/` | 产品详情：介绍、官网、核验状态与核验方法、相关产品、结构化数据 |
| `/tools/` | 全部在线工具（16 个，全部真实可用） |
| `/tools/[slug]/` | 工具详情：统一工作区 + 说明 + FAQ + 相关工具 |
| `/submit/` | 提交产品：完整表单校验 + 预览 + Provider 适配层 |
| `/about/` | 关于、核验机制、排序规则、路线图 |
| `/privacy/` | 隐私说明（与真实实现一致） |
| `/404/` | 友好错误页 |

## 部署到 GitHub Pages

### 1. 推送到 GitHub 并启用 Pages

1. 新建仓库并推送代码（默认分支 `main`）。
2. 仓库 Settings → Pages → Source 选择 **GitHub Actions**。
3. 推送后 `.github/workflows/deploy.yml` 会自动构建并部署。

### 2. 路径适配（自动）

工作流会按仓库名自动计算 `BASE_PATH`：

- 仓库名 `SolYoung-work.github.io` → 部署到根路径 `base=/`
- 其他仓库名（如 `solhub`）→ 部署到 `/solhub/` 子路径

### 3. 自定义域名（可选）

在仓库 **Settings → Secrets and variables → Actions → Variables** 中添加：

| 变量 | 说明 |
| --- | --- |
| `ASTRO_SITE` | 生产站点地址，例如 `https://solyoung.top`（用于 canonical / sitemap / OG） |

若部署到自定义域名根路径，把工作流中 `Compute base path` 一节的输出改为 `base=/`，
并在仓库根目录添加 `CNAME` 文件（内容为你的域名）。

### 4. 提交系统配置（可选）

| 环境变量 | 说明 |
| --- | --- |
| `PUBLIC_SOLHUB_ISSUE_REPO` | 例如 `SolYoung-work/solhub`。配置后提交页生成 GitHub Issue 预填链接，由用户自行点击提交 |
| `PUBLIC_SOLHUB_SUBMIT_ENDPOINT` | 远程提交接口 URL（需服务端实现并允许 CORS） |

两者都未配置时，提交内容保存为**本地草稿**（仅当前浏览器）并提供 JSON 导出——页面会明确说明，
不会伪装成全站公开数据。**严禁把任何密钥写入前端代码或公开仓库。**

## 数据维护

所有内容数据都在 `src/data/` 下的 TypeScript 文件中，便于人工维护：

- `products.ts`：产品列表。`isDemo=true` 的条目是演示数据（不会获得核验状态）；
  `verificationStatus="verified"` 仅授予已实际核验的产品（人工访问官网核对）。
- `tools.ts`：工具注册表（id / slug / name / category / icon / component / keywords / relatedToolIds）。
  新增工具 = 添加注册表条目 + 在 `src/islands/tools/` 实现组件 + 在 `src/pages/tools/[slug].astro`
  的工具映射中加入组件。
- `categories.ts` / `product-categories.ts`：分类。

**排序规则**（`src/lib/ranking.ts`）与数据分离：核验优先 → 演示数据垫底 → 人工精选顺序 → 收录时间倒序。
不包含任何随机分数，也不允许购买排名。

## 测试

`npm test` 覆盖：JSON 格式化/校验、文本统计、URL/Base64 编解码、UUID、密码生成、时间戳转换、
UTM 构建、宽高比计算、颜色转换、robots.txt、llms.txt、JSON-LD、搜索与排序。

## 已知限制与待完成事项

- **自动域名核验**（Meta Tag / DNS TXT / 文件验证）尚未启用，当前为人工核验。
- **远程提交接口 / GitHub Issue 投稿**需按上文配置环境变量后启用。
- **投票 / 收藏 / 评论 / 账号系统**需要真实后端，当前未接入；本地收藏只保存在当前浏览器。
- **OG 分享图**目前使用 SVG（部分平台可能不渲染），后续可替换为静态 PNG。

## 许可

本项目为个人项目，版权归 SolYoung（宋杨）所有。禁止未经许可的商业使用。

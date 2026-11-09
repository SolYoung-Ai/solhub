# AdSense 接入手册（SolHub）

广告代码已经内置，**默认全关**。不配环境变量时，构建产物里连 `adsbygoogle` 字样都不会出现，
站点行为与现在完全一致。所以可以放心先把代码合上线，等 AdSense 过审后再打开开关。

---

## 0. 先说清楚：这个站能赚多少

| 流量来源 | 常见 RPM（每千次浏览收入） | 说明 |
| --- | --- | --- |
| 中国大陆 | ¥2–15（约 $0.3–2） | 中文技术流量单价低，且 AdSense 在国内加载慢、填充率不稳 |
| 北美 / 欧洲 | $5–20 | 开发者 / AI 工具类属于高单价垂类 |
| 东南亚 / 南亚 | $0.5–3 | — |

按两条广告位、月 10 万 PV、假设 RPM $1 估算，月收入约 **$100**（正好是 AdSense 起付线）。
如果流量主要来自国内，请把预期降到「覆盖域名和服务器成本」这一档，别按美国博主的数字算。

**更现实的问题：审核。** AdSense 明令不接受「低价值 / 抓取拼凑」内容。SolHub 的 Skill 索引
（1000 条来自 GitHub 的 SKILL.md）虽然每条都标了来源，仍可能被判为 *scraped content* 或
*low value inventory*。降低风险的顺序是：

1. 先补 10–20 篇**原创**内容（产品评测、Skill 使用教程、独立开发者访谈），每篇 800 字以上，
   带真实截图和自己的判断；
2. 首页 / Skill 库之外的页面要有明确导航与 About、Privacy、联系方式（已有）；
3. 有 3 个月以上的稳定自然流量再提交，首次通过率明显更高；
4. 万一被拒，按邮件里给的**具体原因**改完再申请，不要连续盲投。

---

## 1. 四步接入

```bash
# ① 过审后拿到 ca-pub-xxxxxxxxxxxxxxxx，写 ads.txt + 本地 .env
npm run ads:init -- ca-pub-1234567890123456

# ② 本地验证
npm run build
grep -c adsbygoogle dist/index.html      # 应为 0（首页没广告位）
grep -c adsbygoogle dist/skills/index.html  # 应为 1 以上
```

③ 线上开关在 **GitHub 仓库 → Settings → Secrets and variables → Actions → Variables**：

| Variable | 值 |
| --- | --- |
| `PUBLIC_ADSENSE_CLIENT` | `ca-pub-1234567890123456` |
| `PUBLIC_ADSENSE_SLOT_ARTICLE` | 产品详情页广告单元 id（纯数字） |
| `PUBLIC_ADSENSE_SLOT_LIST` | Skill 库 / 产品列表页广告单元 id |

`deploy.yml` 的 build 步骤已经读取这三个变量；**不配 = 线上不投放**（本地 `.env` 只在本地构建生效，
Actions 读不到你的 `.env`）。

④ AdSense 后台：

- 「网站」→ 添加 `solhub.solyoung.top` → 提交审核（此时代码已就位，Google 能验证所有权）；
- 「广告」→ 按广告单元 → 新建两个「展示广告 / 自适应」，把 id 填回 Variables 重新部署；
- 「隐私权和消息」→ **必须**开启 GDPR 同意消息（欧洲经济区流量没有 Google 认证 CMP 属于违规）。

---

## 2. 代码在哪里

| 文件 | 作用 |
| --- | --- |
| `src/lib/ads.ts` | 唯一的开关：校验 client / slot 格式，非法值一律当没配 |
| `src/components/AdsHead.astro` | `<head>` 里的 AdSense 脚本 + `google-adsense-account` 验证 meta |
| `src/components/AdSlot.astro` | 单个广告位；未填充 8 秒后自动收起，不留空白 |
| `src/pages/privacy.astro` | 广告章节随开关出现/消失，文案不会与实际不一致 |

广告位只在三个页面：产品详情页（CTA 之后）、Skill 库（精选区与全量索引之间）、产品列表页底部。
**登录、账号、提交、后台一律不放**，这是 AdSense 的硬性要求，也是转化率的常识。

---

## 3. 收款与税务

- 起付线 **$100**，电汇到国内银行（招商银行等支持较好），或西联汇款；每月 21–26 号结算。
- 首次收款前要在 AdSense 里填 **W-8BEN**（非美国居民税务表），否则美国流量收入会被预扣 24%。
  按中美税收协定申请协定优惠后，通常可降到 0–10%。
- 地址验证：Google 会寄一张含 PIN 码的纸质明信片到你的收款地址，**这一步最容易卡住**，
  地址务必填能收平信的（拼音 + 门牌号 + 手机号）。

---

## 4. 如果审核过不去 / 单价太低，替代方案

| 方案 | 门槛 | 特点 |
| --- | --- | --- |
| **EthicalAds** | 有内容审核，无流量硬门槛 | 开发者垂类，纯文本广告，不追踪，和 SolHub 调性最合 |
| **Carbon Ads** | 需要一定流量（约 10 万 PV/月） | 单广告位，设计干净，$3–8 RPM |
| **百度联盟 / 穿山甲** | 需国内主体 + ICP 备案 | 国内填充率高，但 GitHub Pages 无备案号，当前走不通 |
| **自家赞助位** | 无 | 产品列表页留一个「本周赞助」卡位，直接卖给提交产品的开发者，单价通常高于展示广告 |

对一个独立开发者目录站来说，**自家赞助位往往比 AdSense 更值钱**：一次 500 元的月费赞助，
相当于 5–7 万 PV 的 AdSense 收入。广告位代码已经有位置，改成赞助卡只需换 `AdSlot` 的内容。

---

## 5. 常见坑

- 本地 `.env` 配了但线上没广告 → Actions 的 Variables 没配（第 ③ 步）。
- `ads.txt` 必须能通过 `https://域名/ads.txt` 直接打开，且只有一行 `google.com, pub-xxx, ...`；
  漏了这行会在后台报「找不到授权卖方」，降低竞价参与率。
- 不要把广告放在没有内容的页面（登录、404、提交成功页），会被判 policy violation。
- 广告位上方必须有「广告」标识（《广告法》要求），`AdSlot` 自带，别删。
- Service Worker 不缓存 AdSense 请求（跨域直接放行），改广告不需要用户清缓存。
- 换域名 / 换语言前缀后，AdSense 后台要重新添加站点。

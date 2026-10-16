/**
 * SolHub 站点级配置
 * 部署时按实际情况修改。环境变量以 PUBLIC_ 开头会暴露给客户端。
 */
export const siteConfig = {
  name: "SolHub",
  tagline: "Discover. Build. Share.",
  taglineZh: "发现好产品，使用好工具，让独立创作更高效。",
  description:
    "SolHub 是一个独立产品发现平台与在线工具箱：探索独立开发者正在创造的产品，使用简单、实用、免费的在线工具。",
  /** 生产环境站点地址（与 astro.config.mjs 的 ASTRO_SITE 保持一致） */
  defaultSite: "https://solyoung.top",
  /** GitHub 项目仓库地址；配置后页脚显示 GitHub 入口 */
  githubUrl: "https://github.com/SolYoung-Ai/solhub",
  /** 联系方式（可选） */
  contactEmail: "",
  copyrightYear: 2026,
};

/**
 * 提交系统配置（客户端可读，以 PUBLIC_ 开头，不能放置任何密钥）
 * - PUBLIC_SOLHUB_ISSUE_REPO: 例如 "SolYoung-work/solhub"。配置后提交页提供
 *   「在 GitHub 上提交 Issue」入口（生成预填链接，由用户自己点击提交）。
 * - PUBLIC_SOLHUB_SUBMIT_ENDPOINT: 远程提交接口 URL（需服务端实现并允许 CORS）。
 *   两者都未配置时，提交内容保存为本地草稿并提供 JSON 导出，并明确说明不会公开。
 */
export const submissionConfig = {
  githubIssueRepo: import.meta.env.PUBLIC_SOLHUB_ISSUE_REPO as string | undefined,
  remoteEndpoint: import.meta.env.PUBLIC_SOLHUB_SUBMIT_ENDPOINT as string | undefined,
};

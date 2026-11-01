/**
 * 阿里云 DirectMail 只读自检：用真实 AK/SK 验证鉴权、权限、域名、发信地址与免费额度。
 *
 * 特点：
 *   1. 签名实现与 worker/index.js 逐行一致（percentEncode + aliyunSignature），
 *      不复用 scripts/test-aliyun-live.mjs 里那份旧编码，避免结论错误。
 *   2. 只调用只读接口，不消耗发信额度。
 *   3. AK/SK 只从环境变量读，不落盘、不打印明文。
 *
 * 用法：
 *   DM_ACCESS_KEY_ID=xxx DM_ACCESS_KEY_SECRET=yyy node scripts/aliyun-check.mjs
 *
 * Action 取值来自官方 API 元数据（api.aliyun.com/meta/v1/products/dm）：
 *   DescAccountSummary        获取账户信息（含免费额度余量）
 *   QueryDomainByParam        查询域名列表
 *   QueryMailAddressByParam   查询发信地址列表
 */
import { createHmac } from "node:crypto";

const AK = process.env.DM_ACCESS_KEY_ID || "";
const SK = process.env.DM_ACCESS_KEY_SECRET || "";
const SENDER = process.env.DM_SENDER || "";

if (!AK || !SK) {
  console.error("缺少 DM_ACCESS_KEY_ID / DM_ACCESS_KEY_SECRET 环境变量");
  process.exit(1);
}

/* ---------- 与 worker/index.js 完全一致的签名实现 ---------- */
function percentEncode(str) {
  return encodeURIComponent(String(str == null ? "" : str))
    .replace(/!/g, "%21")
    .replace(/'/g, "%27")
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29")
    .replace(/\*/g, "%2A");
}

async function aliyunSignature(params, secret) {
  const names = Object.keys(params).filter((k) => k !== "Signature").sort();
  const canonical = names.map((k) => `${percentEncode(k)}=${percentEncode(params[k])}`).join("&");
  const stringToSign = `POST&${percentEncode("/")}&${percentEncode(canonical)}`;
  return createHmac("sha1", `${secret}&`).update(stringToSign).digest("base64");
}

async function call(action, extra = {}) {
  const params = {
    AccessKeyId: AK,
    Action: action,
    Format: "JSON",
    RegionId: "cn-hangzhou",
    SignatureMethod: "HMAC-SHA1",
    SignatureNonce: crypto.randomUUID(),
    SignatureVersion: "1.0",
    Timestamp: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
    Version: "2015-11-23",
    ...extra,
  };
  const signature = await aliyunSignature(params, SK);
  const body =
    Object.keys(params).map((k) => `${percentEncode(k)}=${percentEncode(params[k])}`).join("&") +
    `&Signature=${percentEncode(signature)}`;
  const res = await fetch("https://dm.aliyuncs.com/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const text = await res.text();
  let data = {};
  try { data = JSON.parse(text); } catch { /* 非 JSON */ }
  return { status: res.status, code: data.Code || "", data, raw: text };
}

function diagnose(code) {
  if (!code) return "";
  if (code === "SignatureDoesNotMatch") return "签名不匹配 —— 签名算法或编码有问题";
  if (code.startsWith("InvalidAccessKeyId")) return "AccessKey 无效";
  if (code === "NoPermission" || code === "Forbidden") return "RAM 子账号缺少 DirectMail 权限";
  if (code === "InvalidAction.NotFound") return "Action 名不存在（脚本用的不是合法 Action）";
  return "";
}

/* ---------- 1) 账户总览 ---------- */
console.log("【1】DescAccountSummary —— 验证 AccessKey、签名与 RAM 权限");
const acc = await call("DescAccountSummary");
if (acc.code) {
  console.log(`   ❌ 失败：${acc.code}`);
  console.log(`      ${acc.data.Message || ""}`);
  const hint = diagnose(acc.code);
  if (hint) console.log(`      → ${hint}`);
  console.log(`      原始：${acc.raw.slice(0, 300)}`);
  process.exit(1);
}
const a = acc.data;
console.log("   ✅ 鉴权通过 —— AK/SK 有效，签名正确，RAM 权限已生效");
console.log(`      用户状态 UserStatus  = ${a.UserStatus}（0 正常）`);
console.log(`      信誉等级 QuotaLevel  = ${a.QuotaLevel}　最高限制 MaxQuotaLevel = ${a.MaxQuotaLevel}`);
console.log(`      日额度 DailyQuota    = ${a.DailyQuota}　月额度 MonthQuota = ${a.MonthQuota}`);
console.log(`      ⭐ 总免费额度剩余 RemainFreeQuota      = ${a.RemainFreeQuota}`);
console.log(`      ⭐ 日免费额度剩余 DailyRemainFreeQuota = ${a.DailyRemainFreeQuota}`);
console.log(`      出口通道 IpChannelType = ${a.IpChannelType}（normal = 正常通道）`);
console.log(`      域名数 Domains = ${a.Domains}　发信地址数 MailAddresses = ${a.MailAddresses}`);

/* ---------- 2) 发信域名 ---------- */
console.log("\n【2】QueryDomainByParam —— 发信域名验证状态");
const dom = await call("QueryDomainByParam", { PageNo: "1", PageSize: "20" });
if (dom.code) {
  console.log(`   ⚠️ ${dom.code} ${dom.data.Message || ""}`);
} else {
  const list = dom.data.data?.domain || [];
  console.log(`   域名总数：${dom.data.TotalCount ?? list.length}`);
  for (const d of list) {
    /* 注意官方字段语义：这些标志 0 = 成功，1 = 失败（与直觉相反） */
    console.log(
      `   · ${d.DomainName}\n` +
      `       域名状态 DomainStatus = ${d.DomainStatus}（0 = 已验证通过可用）\n` +
      `       SPF 校验 SpfAuthStatus = ${d.SpfAuthStatus}（0 成功）　` +
      `MX 校验 MxAuthStatus = ${d.MxAuthStatus}（0 成功）　` +
      `CNAME 校验 ConfirmStatus = ${d.ConfirmStatus}（0 成功）\n` +
      `       域名记录 DomainRecord = ${d.DomainRecord}（归属验证标识）`,
    );
  }
}

/* ---------- 3) 发信地址（含类型与回信地址验证状态） ---------- */
console.log("\n【3】QueryMailAddressByParam —— 发信地址与类型");
const ma = await call("QueryMailAddressByParam", { PageNo: "1", PageSize: "50" });
if (ma.code) {
  console.log(`   ⚠️ ${ma.code} ${ma.data.Message || ""}`);
} else {
  const list = ma.data.data?.mailAddress || [];
  console.log(`   发信地址总数：${ma.data.TotalCount ?? list.length}`);
  for (const m of list) {
    console.log(
      `   · ${m.SenderAddress}\n` +
      `       类型 Sendtype = ${m.Sendtype}（trigger=触发邮件 / batch=批量邮件）　` +
      `地址类型 AddressType = ${m.AddressType}\n` +
      `       账号状态 AccountStatus = ${m.AccountStatus}（0 正常）　` +
      `域名状态 DomainStatus = ${m.DomainStatus}（0 正常）\n` +
      `       回信地址 ReplyAddress = ${m.ReplyAddress || "未设置"}　` +
      `回信验证 ReplyStatus = ${m.ReplyStatus ?? "未返回"}（0 通过 / 1 未通过）\n` +
      `       地址验证 MailAddressVerificationStatus = ${m.MailAddressVerificationStatus}` +
      `（0 未验证 / 1 已验证 / 2 不需要验证，内部地址）　` +
      `日额度 DailyReqCount = ${m.DailyReqCount}`,
    );
  }
  if (SENDER) {
    const sender = list.find((m) => (m.SenderAddress || "").toLowerCase() === SENDER.toLowerCase());
    console.log(`\n   Worker 配置的发信地址：${SENDER}`);
    if (!sender) {
      console.log("   ⚠️ 未找到该发信地址 —— 需要在控制台「发信地址」里创建它");
    } else {
      const isTrigger = sender.Sendtype === "trigger";
      console.log(`   ${isTrigger ? "✅" : "❌"} 发信类型${isTrigger ? "正确（触发邮件）" : "错误（批量邮件）—— 必须改为触发邮件"}`);
      const replyOk = sender.ReplyStatus === "0" || sender.ReplyStatus === 0;
      console.log(`   ${replyOk ? "✅" : "❌"} 回信地址${replyOk ? "已验证通过（ReplyToAddress=true 可用）" : "未通过验证 —— ReplyToAddress=true 会导致发信失败"}`);
    }
  } else {
    console.log("\n   （未设置 DM_SENDER，跳过发信地址比对）");
  }
}

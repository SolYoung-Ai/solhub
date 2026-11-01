/**
 * 真实发信测试：用真实 AK/SK 发一封测试邮件。
 *
 * 会真的消耗免费额度（1 封），属于预期行为。
 * 默认发到 DM_TEST_TO，缺省用回信地址本身。
 *
 * 用法：
 *   DM_ACCESS_KEY_ID=xxx DM_ACCESS_KEY_SECRET=yyy \
 *   DM_SENDER=solhub@mail.solyoung.top DM_TEST_TO=you@example.com \
 *   node scripts/aliyun-send-test.mjs
 */
import { createHmac } from "node:crypto";

const AK = process.env.DM_ACCESS_KEY_ID || "";
const SK = process.env.DM_ACCESS_KEY_SECRET || "";
const SENDER = process.env.DM_SENDER || "";
const TO = process.env.DM_TEST_TO || "";
const REPLY_TO = process.env.DM_REPLY_TO || "";

if (!AK || !SK || !SENDER) {
  console.error("缺少 DM_ACCESS_KEY_ID / DM_ACCESS_KEY_SECRET / DM_SENDER");
  process.exit(1);
}

/* 与 worker/index.js 完全一致的签名实现 */
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

async function singleSendMail(extra) {
  const params = {
    AccessKeyId: AK,
    Action: "SingleSendMail",
    AccountName: SENDER,
    AddressType: "1",
    Subject: "【SolHub】邮件通道联调测试",
    ToAddress: TO,
    HtmlBody: "<p>这是一封 SolHub 邮件通道联调测试邮件。</p><p>如果你收到它，说明发信通道已打通。</p>",
    TextBody: "这是一封 SolHub 邮件通道联调测试邮件。如果你收到它，说明发信通道已打通。",
    FromAlias: "SolHub",
    ClickTrace: "0",
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

/* ---------- 尝试 1：ReplyToAddress=true（Worker 当前的配置） ---------- */
console.log(`发信地址：${SENDER}`);
console.log(`收件人：  ${TO}`);
console.log("\n【尝试 1】ReplyToAddress=true（Worker 现行配置）");
const r1 = await singleSendMail({ ReplyToAddress: "true", ...(REPLY_TO ? { ReplyAddress: REPLY_TO } : {}) });
if (r1.code) {
  console.log(`   ❌ ${r1.code}`);
  console.log(`      ${r1.data.Message || ""}`);
  console.log(`      RequestId: ${r1.data.RequestId || "-"}`);
} else {
  console.log(`   ✅ 发送成功  RequestId: ${r1.data.RequestId || "-"}`);
  console.log(`      EnvId: ${r1.data.EnvId || "-"}`);
}

/* ---------- 尝试 2：ReplyToAddress=false ---------- */
console.log("\n【尝试 2】ReplyToAddress=false（不启用控制台回信地址）");
const r2 = await singleSendMail({ ReplyToAddress: "false" });
if (r2.code) {
  console.log(`   ❌ ${r2.code}`);
  console.log(`      ${r2.data.Message || ""}`);
  console.log(`      RequestId: ${r2.data.RequestId || "-"}`);
} else {
  console.log(`   ✅ 发送成功  RequestId: ${r2.data.RequestId || "-"}`);
  console.log("      → 说明是回信地址未验证导致失败，应把 Worker 的 ReplyToAddress 改为 false");
}

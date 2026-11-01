/**
 * 用真实接口验证签名管线是否正确。
 * 原理：拿一对假密钥发请求。
 *   - 签名算法错误 → 返回 SignatureDoesNotMatch / MissingParameter
 *   - 签名算法正确 → 返回 InvalidAccessKeyId.NotFound（说明参数解析和签名都过了）
 */
import { createHmac } from "node:crypto";

const AK = process.env.TEST_AK || "testid";
const SK = process.env.TEST_SK || "testsecret";

function percentEncode(str) {
  return encodeURIComponent(String(str == null ? "" : str))
    .replace(/\+/g, "%20")
    .replace(/\*/g, "%2A")
    .replace(/%7E/g, "~");
}

async function aliyunSignature(params, secret) {
  const names = Object.keys(params).filter((k) => k !== "Signature").sort();
  const canonical = names.map((k) => `${percentEncode(k)}=${percentEncode(params[k])}`).join("&");
  const stringToSign = `POST&${percentEncode("/")}&${percentEncode(canonical)}`;
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(`${secret}&`), { name: "HMAC", hash: "SHA-1" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(stringToSign));
  let bin = "";
  const bytes = new Uint8Array(sig);
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

/* 与 worker/index.js 的 sendMail 保持一致 */
const params = {
  AccessKeyId: AK,
  Action: "SingleSendMail",
  AccountName: "noreply@mail.solyoung.top",
  AddressType: "1",
  ReplyToAddress: "true",
  Subject: "【SolHub】签名自检 123456",
  ToAddress: "probe@example.com",
  HtmlBody: "<p>签名自检</p>",
  TextBody: "签名自检",
  FromAlias: "SolHub",
  ClickTrace: "0",
  Format: "JSON",
  RegionId: "cn-hangzhou",
  SignatureMethod: "HMAC-SHA1",
  SignatureNonce: crypto.randomUUID(),
  SignatureVersion: "1.0",
  Timestamp: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
  Version: "2015-11-23",
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
console.log("HTTP", res.status);
console.log("响应:", text.slice(0, 500));

let code = "";
try { code = JSON.parse(text).Code || ""; } catch {}
console.log("\n判定:");
if (code === "InvalidAccessKeyId.NotFound" || code === "InvalidAccessKeyId.Forbidden") {
  console.log("  ✅ 签名正确 —— 接口已进入 AccessKey 校验阶段，说明参数编码与签名算法都对");
} else if (code === "SignatureDoesNotMatch") {
  console.log("  ❌ 签名不匹配 —— 签名算法有问题");
} else if (code === "MissingParameter" || code === "InvalidParameter") {
  console.log("  ⚠️ 参数问题:", code);
} else {
  console.log("  ? 其他返回，需要人工判断");
}

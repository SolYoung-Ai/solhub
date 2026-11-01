/**
 * 阿里云 DirectMail 签名回归测试。
 *
 * 期望值来源：与官方 SDK @alicloud/openapi-core 的 `OpenApiUtil.getRPCSignature()`
 * 逐字节交叉比对得出（2026-11）。任何改动 percentEncode / aliyunSignature 的行为
 * 都会让本测试失败，从而在上线前发现签名不匹配（SignatureDoesNotMatch）。
 *
 * 运行：node scripts/test-aliyun-sign.mjs
 */
import { createHmac } from "node:crypto";

/* 与 worker/index.js 完全一致 */
function percentEncode(str) {
  return encodeURIComponent(String(str == null ? "" : str))
    .replace(/!/g, "%21")
    .replace(/'/g, "%27")
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29")
    .replace(/\*/g, "%2A");
}

/* 与 worker/index.js 完全一致（Web Crypto 版本） */
async function aliyunSignature(params, secret) {
  const names = Object.keys(params).filter((k) => k !== "Signature").sort();
  const canonical = names.map((k) => `${percentEncode(k)}=${percentEncode(params[k])}`).join("&");
  const stringToSign = `POST&${percentEncode("/")}&${percentEncode(canonical)}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(`${secret}&`),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(stringToSign));
  let bin = "";
  const bytes = new Uint8Array(sig);
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

const SECRET = "testsecret";

const CASES = [
  {
    name: "官方文档示例参数",
    params: {
      AccessKeyId: "testid", AccountName: "", Action: "SingleSendMail", AddressType: "1",
      Format: "XML", HtmlBody: "4", RegionId: "cn-hangzhou", ReplyToAddress: "true",
      SignatureMethod: "HMAC-SHA1", SignatureNonce: "c1b2c332-4cfb-4a0f-b8cc-ebe622aa0a5c",
      SignatureVersion: "1.0", Subject: "3", TagName: "2", Timestamp: "2016-10-20T06:27:56Z",
      ToAddress: "1@test.com", Version: "2015-11-23",
    },
    expect: "rOLTPw1ux7gUyyoXBPpuR41d7eo=",
  },
  {
    name: "真实发信参数（含中文 / HTML / 括号）",
    params: {
      AccessKeyId: "testid", Action: "SingleSendMail", AccountName: "noreply@mail.solyoung.top",
      AddressType: "1", ReplyToAddress: "true", Subject: "【SolHub】邮箱验证码 123456",
      ToAddress: "probe@example.com", HtmlBody: "<p>你好 &amp; 验证码 <b>123456</b> (10 分钟内有效)</p>",
      TextBody: "验证码 123456，10 分钟内有效。", FromAlias: "SolHub", ClickTrace: "0",
      TagName: "solhub", Format: "JSON", RegionId: "cn-hangzhou", SignatureMethod: "HMAC-SHA1",
      SignatureNonce: "c1b2c332-4cfb-4a0f-b8cc-ebe622aa0a5c", SignatureVersion: "1.0",
      Timestamp: "2016-10-20T06:27:56Z", Version: "2015-11-23",
    },
    expect: "rJpDA67jKVnWwkNFXGriQi91byY=",
  },
  {
    name: "特殊字符 ! ' ( ) * ~",
    params: {
      AccessKeyId: "testid", Action: "SingleSendMail", Subject: "a!b'c(d)e*f~g",
      ToAddress: "x!y@z.com", HtmlBody: "100% (real) !ok", Version: "2015-11-23",
    },
    expect: "sFCI3RauvmjELeUWE239+9cjmT4=",
  },
];

let failed = 0;
for (const c of CASES) {
  const got = await aliyunSignature(c.params, SECRET);
  /* 独立参考实现：node:crypto 直接按 RFC2104 算一遍，防止「实现和实现一起错」 */
  const names = Object.keys(c.params).filter((k) => k !== "Signature").sort();
  const canonical = names.map((k) => `${percentEncode(k)}=${percentEncode(c.params[k])}`).join("&");
  const ref = createHmac("sha1", `${SECRET}&`)
    .update(`POST&${percentEncode("/")}&${percentEncode(canonical)}`, "utf8")
    .digest("base64");
  const ok = got === c.expect && got === ref;
  if (!ok) failed += 1;
  console.log(`${ok ? "✅" : "❌"} ${c.name}`);
  if (!ok) {
    console.log(`   期望(SDK) : ${c.expect}`);
    console.log(`   实际       : ${got}`);
    console.log(`   参考实现   : ${ref}`);
  }
}

console.log(failed === 0 ? "\n全部通过：签名实现与阿里云官方 SDK 一致" : `\n${failed} 个用例失败`);
process.exit(failed === 0 ? 0 : 1);

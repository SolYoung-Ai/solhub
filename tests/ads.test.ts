import { describe, expect, it } from "vitest";
import { adsEnabled, adSlot, adsTxtRecord, normalizeClient, normalizeSlot } from "@/lib/ads";

describe("AdSense client id", () => {
  it("接受标准 ca-pub-16 位数字", () => {
    expect(normalizeClient("ca-pub-1234567890123456")).toBe("ca-pub-1234567890123456");
  });

  it("去掉首尾空白", () => {
    expect(normalizeClient("  ca-pub-1234567890123456 \n")).toBe("ca-pub-1234567890123456");
  });

  it("拒绝带 ca- 但数字位数不足的值", () => {
    expect(normalizeClient("ca-pub-123")).toBe("");
  });

  it("拒绝漏掉 ca- 前缀的值（ads.txt 用 pub-，页面脚本必须用 ca-pub-）", () => {
    expect(normalizeClient("pub-1234567890123456")).toBe("");
  });

  it("拒绝空值与未定义 —— 这是默认关闭的保证", () => {
    expect(normalizeClient(undefined)).toBe("");
    expect(normalizeClient("")).toBe("");
    expect(normalizeClient("   ")).toBe("");
  });

  it("拒绝模板占位符", () => {
    expect(normalizeClient("ca-pub-xxxxxxxxxxxxxxxx")).toBe("");
  });
});

describe("AdSense slot id", () => {
  it("接受纯数字", () => {
    expect(normalizeSlot("1234567890")).toBe("1234567890");
  });

  it("拒绝带单位或字母的值", () => {
    expect(normalizeSlot("12345px")).toBe("");
    expect(normalizeSlot("slot-123456")).toBe("");
  });

  it("拒绝过短的数字（避免把 1 当成合法单元）", () => {
    expect(normalizeSlot("123")).toBe("");
  });
});

describe("ads.txt 记录", () => {
  it("用 pub- 前缀，附 Google 认证机构 ID", () => {
    expect(adsTxtRecord("ca-pub-1234567890123456")).toBe(
      "google.com, pub-1234567890123456, DIRECT, f08c47fec0942fa0",
    );
  });

  it("无效 client 返回空串，避免写出半截记录", () => {
    expect(adsTxtRecord("pub-123456")).toBe("");
  });
});

describe("默认关闭", () => {
  it("未配置环境变量时不启用广告、不返回广告单元", () => {
    expect(adsEnabled).toBe(false);
    expect(adSlot("article")).toBe("");
    expect(adSlot("list")).toBe("");
  });
});

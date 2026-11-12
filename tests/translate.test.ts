import { afterEach, describe, expect, it, vi } from "vitest";
import {
  looksChinese,
  needsT2S,
  normalizeZh,
  stripLine,
  toSimplified,
  translateBatch,
} from "../worker/translate.js";

/** 造一个 Pollinations 风格的响应 */
function llmReply(lines: string[]) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content: lines.join("\n") } }] }),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("stripLine", () => {
  it("去掉模型偶尔加回来的序号与项目符号", () => {
    expect(stripLine("1. 苹果发布新芯片")).toBe("苹果发布新芯片");
    expect(stripLine("2、英伟达财报超预期")).toBe("英伟达财报超预期");
    expect(stripLine("- OpenAI 融资")).toBe("OpenAI 融资");
  });

  it("去掉包裹引号（模型爱给译文加引号）", () => {
    expect(stripLine("「苹果发布新芯片」")).toBe("苹果发布新芯片");
    expect(stripLine('"英伟达财报超预期"')).toBe("英伟达财报超预期");
  });
});

describe("looksChinese", () => {
  it("正常的译文通过", () => {
    expect(looksChinese("苹果发布用于数据中心的新型 AI 芯片")).toBe(true);
  });

  it("纯英文标题不算中文（否则会把没翻的英文当成译文发出去）", () => {
    expect(looksChinese("Apple unveils new AI chips")).toBe(false);
  });

  it("专有名词很多但主体是中文，仍然通过", () => {
    expect(looksChinese("NVIDIA 与 OpenAI 签署 1000 亿美元协议")).toBe(true);
  });

  it("空串不通过", () => {
    expect(looksChinese("")).toBe(false);
  });
});

describe("繁转简", () => {
  it("港台媒体的常见字能转", () => {
    expect(toSimplified("臺灣電動車產業")).toBe("台湾电动车产业");
    expect(needsT2S("這是一個測試")).toBe(true);
  });

  it("不只高频字 —— 生僻一点的也照表转（手写表在这里翻过车）", () => {
    /* 转的是字形，不是词汇：「晶片」是台湾用语、写法本身是简体字，不该被改动 */
    expect(toSimplified("輝達晶片去向成謎")).toBe("辉达晶片去向成谜");
    expect(toSimplified("發声明表態，卻隻字未提")).toBe("发声明表态，却只字未提");
    expect(toSimplified("微軟收購動視暴雪")).toBe("微软收购动视暴雪");
  });

  it("同样是汉字的简体词不会被误转", () => {
    /* 「干」「台」「发」这些既是简体也可能是繁体表里的键，转错会读出怪词 */
    expect(toSimplified("干细胞")).toBe("干细胞");
    expect(toSimplified("台积电发货")).toBe("台积电发货");
  });

  it("简体原文不动，也不会被误判成繁体", () => {
    expect(needsT2S("这是一个测试")).toBe(false);
    expect(normalizeZh("台积电发布新一代芯片")).toBe("台积电发布新一代芯片");
  });

  it("顺手压掉译文里中文标点前的空格", () => {
    expect(normalizeZh("苹果发布新芯片 ，售价 999 美元")).toBe("苹果发布新芯片，售价 999 美元");
  });
});

describe("translateBatch", () => {
  it("按行返回译文，与原顺序一一对应", async () => {
    const fetchMock = vi.fn(async () =>
      llmReply(["苹果发布新芯片", "英伟达财报超预期", "欧盟调查谷歌广告业务"]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { out, provider } = await translateBatch(
      ["Apple unveils new chip", "Nvidia beats estimates", "EU probes Google ads"],
      "title",
    );
    expect(out).toEqual(["苹果发布新芯片", "英伟达财报超预期", "欧盟调查谷歌广告业务"]);
    expect(provider).toBe("llm");
  });

  it("行数对不上就整批作废 —— 错位会把 A 的译文贴到 B 头上", async () => {
    /* 只回两行，第三条被模型吞了 */
    const fetchMock = vi.fn(async () => llmReply(["苹果发布新芯片", "英伟达财报超预期"]));
    vi.stubGlobal("fetch", fetchMock);

    const { out, provider } = await translateBatch(
      ["Apple unveils new chip", "Nvidia beats estimates", "EU probes Google ads"],
      "title",
      { budgetMs: 3000 },
    );
    /* LLM 那批失败后走机翻兜底，这批 stub 只返回 LLM 形状，兜底也拿不到东西 */
    expect(provider).toBe("none");
    expect(out.filter(Boolean)).toHaveLength(0);
  });

  it("模型把英文原样吐回来时判失败，不放行", async () => {
    const fetchMock = vi.fn(async () => llmReply(["Apple unveils new chip"]));
    vi.stubGlobal("fetch", fetchMock);

    const { out } = await translateBatch(["Apple unveils new chip"], "title", { budgetMs: 3000 });
    expect(out[0]).toBe("");
  });

  it("空输入不发请求", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { out, provider } = await translateBatch([], "title");
    expect(out).toEqual([]);
    expect(provider).toBe("none");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("网络异常时不抛错，返回等长空串", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("ECONNRESET");
    }));
    const { out } = await translateBatch(["Apple unveils new chip"], "title", { budgetMs: 2000 });
    expect(out).toEqual([""]);
  });

  it("超过一批的条数会拆成多次请求", async () => {
    const fetchMock = vi.fn(async (_url: string, init: any) => {
      const body = JSON.parse(init.body);
      /* prompt 与正文之间隔着一个空行，正文在最后一段 */
      const payload = String(body.messages[0].content).split("\n\n").pop() || "";
      const lines = payload.split("\n").filter(Boolean);
      return llmReply(lines.map(() => "这是译文"));
    });
    vi.stubGlobal("fetch", fetchMock);

    const input = Array.from({ length: 20 }).map((_, i) => `English headline number ${i}`);
    const { out } = await translateBatch(input, "title", { budgetMs: 20000 });
    expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
    expect(out).toHaveLength(20);
  });
});

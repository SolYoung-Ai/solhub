import { useMemo, useState } from "react";
import { countText } from "@/lib/tools/text";
import { ClearButton } from "@/components/tool-ui";
import type { Locale } from "@/i18n";
import { getDict } from "@/i18n";
import { t } from "@/i18n/data";

export default function TextCounter({ locale = "zh" }: { locale?: Locale }) {
  const dict = getDict(locale);
  const [text, setText] = useState("");
  const stats = useMemo(() => countText(text), [text]);

  const RULES: { labelKey: string; key: "characters" | "charactersNoSpaces" | "charactersNoWhitespace" | "words" | "paragraphs" | "lines" }[] = [
    { labelKey: "statChars", key: "characters" },
    { labelKey: "statCharsNoSpace", key: "charactersNoSpaces" },
    { labelKey: "statCharsNoWs", key: "charactersNoWhitespace" },
    { labelKey: "statWords", key: "words" },
    { labelKey: "statParagraphs", key: "paragraphs" },
    { labelKey: "statLines", key: "lines" },
  ];
  const labels: Record<string, string> = {
    statChars: t(locale, "tools.text-counter.statChars"),
    statCharsNoSpace: locale === "en" ? "Characters (no spaces)" : "字符（不含空格）",
    statCharsNoWs: locale === "en" ? "Characters (no whitespace)" : "字符（不含所有空白）",
    statWords: t(locale, "tools.text-counter.statWords"),
    statParagraphs: t(locale, "tools.text-counter.statParagraphs"),
    statLines: locale === "en" ? "Lines" : "行数",
  };

  return (
    <div className="space-y-4">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={12}
        placeholder={locale === "en" ? "Paste or type text here; stats update live…" : "在这里粘贴或输入文本，统计结果会实时更新…"}
        className="input scroll-x w-full resize-y !text-[15px] leading-7"
        aria-label={t(locale, "tools.text-counter.inputAria")}
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {RULES.map((rule) => (
            <div key={rule.key} className="card px-3 py-2.5 text-center">
              <p className="font-display text-xl font-bold text-foreground">
                {stats[rule.key].toLocaleString()}
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">{labels[rule.labelKey]}</p>
            </div>
          ))}
        </div>
        <ClearButton onClick={() => setText("")} disabled={!text} />
      </div>

      <div className="rounded-[8px] border border-border bg-secondary/40 p-4 text-[13px] leading-6 text-muted-foreground">
        <p className="font-semibold text-foreground/80">{t(locale, "tools.text-counter.ruleTitle")}</p>
        <ul className="mt-1.5 list-disc space-y-1 pl-5">
          <li>{locale === "en" ? "English counts words by whitespace; Chinese counts consecutive Han characters (e.g. 「你好世界」 = 1 Chinese word)." : "英文按空白分词统计词数；中文按连续汉字序列计数（如「你好世界」计 1 个中文词）。"}</li>
          <li>{locale === "en" ? "Mixed text sums English and Chinese word counts." : "混合中英文文本时，英文词数与中文词数相加。"}</li>
          <li>{locale === "en" ? "Paragraphs split on blank lines; empty whitespace-only text has 0 paragraphs." : "段落按空行分隔；全部为空白文本时段落数为 0。"}</li>
          <li>{locale === "en" ? "Everything is computed locally — your text never leaves your device." : "所有计算在浏览器本地完成，文本不会离开你的设备。"}</li>
        </ul>
      </div>
    </div>
  );
}

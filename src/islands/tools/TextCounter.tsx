import { useMemo, useState } from "react";
import { countText } from "@/lib/tools/text";
import { ClearButton } from "@/components/tool-ui";

const RULES = [
  { label: "字符（含空格与换行）", key: "characters" },
  { label: "字符（不含空格）", key: "charactersNoSpaces" },
  { label: "字符（不含所有空白）", key: "charactersNoWhitespace" },
  { label: "词数", key: "words" },
  { label: "段落数", key: "paragraphs" },
  { label: "行数", key: "lines" },
] as const;

export default function TextCounter() {
  const [text, setText] = useState("");
  const stats = useMemo(() => countText(text), [text]);

  return (
    <div className="space-y-4">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={12}
        placeholder="在这里粘贴或输入文本，统计结果会实时更新…"
        className="input scroll-x w-full resize-y !text-[15px] leading-7"
        aria-label="文本输入"
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {RULES.map((rule) => (
            <div key={rule.key} className="card px-3 py-2.5 text-center">
              <p className="font-display text-xl font-bold text-foreground">
                {stats[rule.key].toLocaleString()}
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">{rule.label}</p>
            </div>
          ))}
        </div>
        <ClearButton onClick={() => setText("")} disabled={!text} />
      </div>

      <div className="rounded-[3px] border border-border bg-secondary/40 p-4 text-[13px] leading-6 text-muted-foreground">
        <p className="font-semibold text-foreground/80">统计规则说明</p>
        <ul className="mt-1.5 list-disc space-y-1 pl-5">
          <li>英文按空白分词统计词数；中文按连续汉字序列计数（如「你好世界」计 1 个中文词）。</li>
          <li>混合中英文文本时，英文词数与中文词数相加。</li>
          <li>段落按空行分隔；全部为空白文本时段落数为 0。</li>
          <li>所有计算在浏览器本地完成，文本不会离开你的设备。</li>
        </ul>
      </div>
    </div>
  );
}

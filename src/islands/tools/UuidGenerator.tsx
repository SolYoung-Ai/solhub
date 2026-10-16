import { useState } from "react";
import { generateUuids } from "@/lib/tools/uuid";
import { CopyButton, ClearButton, ResultBox, ToolSection } from "@/components/tool-ui";

export default function UuidGenerator() {
  const [count, setCount] = useState(5);
  const [uuids, setUuids] = useState<string[]>(() => generateUuids(5));

  const regenerate = () => {
    setUuids(generateUuids(count));
  };

  return (
    <div className="space-y-4">
      <ToolSection label="生成数量" hint="1–1000 个">
        <div className="flex items-center gap-3">
          <input
            type="number"
            min={1}
            max={1000}
            value={count}
            onChange={(e) => setCount(Math.max(1, Math.min(1000, Number(e.target.value) || 1)))}
            className="input !w-28"
            aria-label="生成数量"
          />
          <button type="button" onClick={regenerate} className="btn btn-accent !h-8 px-3 text-xs">
            生成
          </button>
          <ClearButton onClick={() => setUuids([])} disabled={uuids.length === 0} />
          <CopyButton
            getText={() => uuids.join("\n")}
            disabled={uuids.length === 0}
            className="ml-auto"
          />
        </div>
      </ToolSection>

      {uuids.length === 0 ? (
        <div className="card p-8 text-center text-sm text-muted-foreground">
          还没有生成的 UUID。设置数量后点击「生成」。
        </div>
      ) : (
        <ToolSection label="结果" hint={`共 ${uuids.length} 个 · UUID v4`}>
          <ResultBox>{uuids.join("\n")}</ResultBox>
        </ToolSection>
      )}

      <div className="rounded-[3px] border border-border bg-secondary/40 p-4 text-[13px] leading-6 text-muted-foreground">
        <p className="font-semibold text-foreground/80">说明</p>
        <p className="mt-1.5">
          使用浏览器 <code className="rounded-[2px] bg-secondary px-1 font-mono text-xs">crypto.randomUUID()</code>{" "}
          （Web Crypto API）生成，无需联网，不记录任何历史。
        </p>
      </div>
    </div>
  );
}

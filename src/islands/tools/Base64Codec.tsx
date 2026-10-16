import { useState } from "react";
import { base64Encode, base64Decode } from "@/lib/tools/base64";
import { CopyButton, ClearButton, Message, ResultBox, ToolSection } from "@/components/tool-ui";

export default function Base64Codec() {
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"encode" | "decode">("encode");

  const run = () => {
    if (!input.trim()) {
      setError("请输入需要处理的内容。");
      setOutput("");
      return;
    }
    if (mode === "encode") {
      setOutput(base64Encode(input));
      setError(null);
    } else {
      const result = base64Decode(input);
      if (result.ok) {
        setOutput(result.output);
        setError(null);
      } else {
        setError(result.error);
        setOutput("");
      }
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <span className="badge border-border-strong bg-secondary text-foreground">
          {mode === "encode" ? "编码（UTF-8）" : "解码"}
        </span>
        <button
          type="button"
          onClick={() => {
            setMode((m) => (m === "encode" ? "decode" : "encode"));
            setInput("");
            setOutput("");
            setError(null);
          }}
          className="btn btn-ghost !h-7 px-2 text-xs"
        >
          切换操作
        </button>
      </div>

      <ToolSection label={mode === "encode" ? "原始文本（支持中文）" : "Base64 内容"}>
        <textarea
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setError(null);
          }}
          rows={6}
          spellCheck={false}
          placeholder={mode === "encode" ? "例如：你好，SolHub！" : "例如：5L2g5aW977yMU29sSHVi77yB"}
          className="input scroll-x w-full resize-y font-mono !text-[13px] leading-6"
          aria-label="输入内容"
        />
      </ToolSection>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={run} className="btn btn-accent !h-8 px-3 text-xs">
          {mode === "encode" ? "编码" : "解码"}
        </button>
        <ClearButton onClick={() => { setInput(""); setOutput(""); setError(null); }} disabled={!input} />
        <CopyButton getText={() => output} disabled={!output} className="ml-auto" />
      </div>

      {error && <Message tone="error">{error}</Message>}

      {output && (
        <ToolSection label="结果">
          <ResultBox>{output}</ResultBox>
        </ToolSection>
      )}

      <div className="rounded-[3px] border border-border bg-secondary/40 p-4 text-[13px] leading-6 text-muted-foreground">
        <p className="font-semibold text-foreground/80">说明</p>
        <ul className="mt-1.5 list-disc space-y-1 pl-5">
          <li>编码前先将文本转为 UTF-8 字节，因此中文、emoji 等都能正确编码。</li>
          <li>解码时使用严格 UTF-8 校验：二进制数据或错误编码会给出明确错误提示。</li>
          <li>所有处理在浏览器本地完成。</li>
        </ul>
      </div>
    </div>
  );
}

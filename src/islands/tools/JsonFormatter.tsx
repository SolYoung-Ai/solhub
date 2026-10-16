import { useState } from "react";
import { Braces } from "lucide-react";
import { formatJson, minifyJson, parseJsonWithError } from "@/lib/tools/json";
import { CopyButton, ClearButton, Message, ResultBox, ToolSection } from "@/components/tool-ui";

export default function JsonFormatter() {
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [meta, setMeta] = useState<string>("");

  const run = (mode: "format" | "minify") => {
    if (!input.trim()) {
      setError("请输入 JSON 内容。");
      setOutput("");
      setMeta("");
      return;
    }
    const result = mode === "format" ? formatJson(input) : minifyJson(input);
    if (!result.ok) {
      setError(
        `JSON 解析失败（第 ${result.error.line} 行，第 ${result.error.column} 列）：${result.error.message}`,
      );
      setOutput("");
      setMeta("");
      return;
    }
    setError(null);
    setOutput(result.output);
    setMeta(
      `格式化后 ${result.output.length} 字符；源输入 ${input.length} 字符，JSON 校验通过。`,
    );
  };

  const handleValidate = () => {
    if (!input.trim()) {
      setError("请输入 JSON 内容。");
      return;
    }
    const result = parseJsonWithError(input);
    if (result.ok) {
      setError(null);
      setOutput("");
      setMeta("JSON 校验通过。点击「格式化」查看缩进后的结果。");
    } else {
      setError(
        `JSON 解析失败（第 ${result.error.line} 行，第 ${result.error.column} 列）：${result.error.message}`,
      );
      setOutput("");
      setMeta("");
    }
  };

  return (
    <div className="space-y-4">
      <ToolSection label="输入 JSON" hint="支持粘贴任意长度的 JSON 文本">
        <textarea
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setError(null);
          }}
          rows={10}
          spellCheck={false}
          placeholder={`{\n  "name": "SolHub",\n  "type": "product"\n}`}
          className="input scroll-x w-full resize-y font-mono !text-[13px] leading-6"
          aria-label="JSON 输入"
        />
      </ToolSection>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => run("format")} className="btn btn-accent !h-8 px-3 text-xs">
          <Braces className="h-3.5 w-3.5" aria-hidden="true" /> 格式化
        </button>
        <button type="button" onClick={() => run("minify")} className="btn btn-outline !h-8 px-3 text-xs">
          压缩
        </button>
        <button type="button" onClick={handleValidate} className="btn btn-outline !h-8 px-3 text-xs">
          校验
        </button>
        <ClearButton onClick={() => { setInput(""); setOutput(""); setError(null); setMeta(""); }} disabled={!input} />
        <CopyButton getText={() => output} disabled={!output} className="ml-auto" />
      </div>

      {error && <Message tone="error">{error}</Message>}
      {meta && <Message tone="success">{meta}</Message>}

      {output && (
        <ToolSection label="输出">
          <ResultBox>{output}</ResultBox>
        </ToolSection>
      )}
    </div>
  );
}

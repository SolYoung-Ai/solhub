import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { generatePassword, type PasswordOptions } from "@/lib/tools/password";
import { CopyButton, ClearButton, Message, ResultBox, ToolSection } from "@/components/tool-ui";

export default function PasswordGenerator() {
  const [options, setOptions] = useState<PasswordOptions>({
    length: 16,
    uppercase: true,
    lowercase: true,
    numbers: true,
    symbols: true,
  });
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const generate = () => {
    const result = generatePassword(options);
    if (result.ok) {
      setPassword(result.password);
      setError(null);
    } else {
      setError(result.error);
    }
  };

  const setOpt = (key: keyof PasswordOptions, value: boolean | number) => {
    setOptions((o) => ({ ...o, [key]: value }));
    setError(null);
  };

  const toggle = (key: "uppercase" | "lowercase" | "numbers" | "symbols") => {
    setOptions((o) => ({ ...o, [key]: !o[key] }));
    setError(null);
  };

  return (
    <div className="space-y-4">
      <ToolSection label="密码长度" hint="4–128">
        <input
          type="range"
          min={4}
          max={128}
          value={options.length}
          onChange={(e) => setOpt("length", Number(e.target.value))}
          className="w-full accent-[var(--color-accent)]"
          aria-label="密码长度"
        />
        <p className="mt-1 text-right font-mono text-sm text-foreground">{options.length} 位</p>
      </ToolSection>

      <ToolSection label="字符集">
        <div className="grid gap-2 sm:grid-cols-2">
          {(
            [
              ["uppercase", "大写字母 A-Z"],
              ["lowercase", "小写字母 a-z"],
              ["numbers", "数字 0-9"],
              ["symbols", "符号 !@#$…"],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="flex cursor-pointer items-center gap-2.5 rounded-[2px] border border-border bg-card px-3 py-2.5 text-sm hover:bg-secondary/50">
              <input
                type="checkbox"
                checked={options[key]}
                onChange={() => toggle(key)}
                className="h-4 w-4 accent-[var(--color-accent)]"
              />
              {label}
            </label>
          ))}
        </div>
      </ToolSection>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={generate} className="btn btn-accent !h-8 px-3 text-xs">
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> 生成密码
        </button>
        <ClearButton onClick={() => setPassword("")} disabled={!password} />
        <CopyButton getText={() => password} disabled={!password} className="ml-auto" />
      </div>

      {error && <Message tone="error">{error}</Message>}

      {password && (
        <ResultBox className="!text-base !font-bold tracking-wider">{password}</ResultBox>
      )}

      <div className="rounded-[3px] border border-border bg-secondary/40 p-4 text-[13px] leading-6 text-muted-foreground">
        <p className="font-semibold text-foreground/80">安全说明</p>
        <ul className="mt-1.5 list-disc space-y-1 pl-5">
          <li>使用浏览器原生安全随机数（crypto.getRandomValues），非伪随机。</li>
          <li>密码只在当前页面内存中生成，不会保存到本地、控制台或任何服务器。</li>
          <li>刷新页面后密码即消失，请及时复制保存。</li>
        </ul>
      </div>
    </div>
  );
}

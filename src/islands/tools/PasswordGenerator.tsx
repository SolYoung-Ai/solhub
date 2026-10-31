import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { generatePassword, type PasswordOptions } from "@/lib/tools/password";
import { CopyButton, ClearButton, Message, ResultBox, ToolSection } from "@/components/tool-ui";
import type { Locale } from "@/i18n";
import { getDict } from "@/i18n";
import { t, localizeError } from "@/i18n/data";

export default function PasswordGenerator({ locale = "zh" }: { locale?: Locale }) {
  const dict = getDict(locale);
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
      setError(localizeError(locale, result.error));
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
      <ToolSection label={t(locale, "tools.password-generator.lengthLabel")} hint="4–128">
        <input
          type="range"
          min={4}
          max={128}
          value={options.length}
          onChange={(e) => setOpt("length", Number(e.target.value))}
          className="w-full accent-[var(--color-accent)]"
          aria-label={t(locale, "tools.password-generator.lengthLabel")}
        />
        <p className="mt-1 text-right font-mono text-sm text-foreground">
          {options.length} {locale === "en" ? "chars" : "位"}
        </p>
      </ToolSection>

      <ToolSection label={locale === "en" ? "Character set" : "字符集"}>
        <div className="grid gap-2 sm:grid-cols-2">
          {(
            [
              ["uppercase", t(locale, "tools.password-generator.includeUpper")],
              ["lowercase", t(locale, "tools.password-generator.includeLower")],
              ["numbers", t(locale, "tools.password-generator.includeDigits")],
              ["symbols", t(locale, "tools.password-generator.includeSymbols")],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="flex cursor-pointer items-center gap-2.5 rounded-[6px] border border-border bg-card px-3 py-2.5 text-sm hover:bg-secondary/50">
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
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> {t(locale, "tools.password-generator.generateBtn")}
        </button>
        <ClearButton onClick={() => setPassword("")} disabled={!password} />
        <CopyButton getText={() => password} disabled={!password} className="ml-auto" />
      </div>

      {error && <Message tone="error">{error}</Message>}

      {password && (
        <ResultBox className="!text-base !font-bold tracking-wider">{password}</ResultBox>
      )}

      <div className="rounded-[8px] border border-border bg-secondary/40 p-4 text-[13px] leading-6 text-muted-foreground">
        <p className="font-semibold text-foreground/80">{locale === "en" ? "Security notes" : "安全说明"}</p>
        <ul className="mt-1.5 list-disc space-y-1 pl-5">
          <li>{locale === "en" ? "Uses the browser's native crypto.getRandomValues() — not pseudo-random." : "使用浏览器原生安全随机数（crypto.getRandomValues），非伪随机。"}</li>
          <li>{locale === "en" ? "Passwords exist only in this page's memory — never saved locally, to console or any server." : "密码只在当前页面内存中生成，不会保存到本地、控制台或任何服务器。"}</li>
          <li>{locale === "en" ? "Refreshing the page clears the password — copy it now." : "刷新页面后密码即消失，请及时复制保存。"}</li>
        </ul>
      </div>
    </div>
  );
}

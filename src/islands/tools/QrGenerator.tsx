import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { CopyButton, ClearButton, Message, ToolSection } from "@/components/tool-ui";
import type { Locale } from "@/i18n";
import { getDict } from "@/i18n";
import { t } from "@/i18n/data";

export default function QrGenerator({ locale = "zh" }: { locale?: Locale }) {
  const dict = getDict(locale);
  const [text, setText] = useState("");
  const [size, setSize] = useState(256);
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const generate = async () => {
    const content = text.trim();
    if (!content) {
      setError(t(locale, "tools.qr-generator.errEmpty"));
      return;
    }
    if (content.length > 2953) {
      setError(locale === "en" ? "Content too long (over 2953 chars) to encode as QR." : "内容过长（超过 2953 个字符），无法生成二维码。");
      return;
    }
    setError(null);
    try {
      await QRCode.toCanvas(canvasRef.current, content, {
        width: size,
        margin: 2,
        errorCorrectionLevel: "M",
        color: { dark: "#1d1a15", light: "#ffffff" },
      });
    } catch {
      setError(locale === "en" ? "QR generation failed: the content may contain unencodable characters." : "二维码生成失败：内容可能包含无法编码的字符。");
    }
  };

  const downloadPng = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = "solhub-qrcode.png";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  useEffect(() => {
    if (text.trim()) {
      void generate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size]);

  return (
    <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
      <div className="space-y-4">
        <ToolSection label={t(locale, "tools.qr-generator.inputLabel")} hint={locale === "en" ? "max 2953 chars" : "最多 2953 字符"}>
          <textarea
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setError(null);
            }}
            rows={5}
            placeholder={locale === "en" ? "Enter text or URL, e.g. https://solyoung.top" : "输入文本或网址，例如 https://solyoung.top"}
            className="input scroll-x w-full resize-y !text-[14px] leading-6"
            aria-label={locale === "en" ? "QR content" : "二维码内容"}
          />
        </ToolSection>

        <ToolSection label={t(locale, "tools.qr-generator.sizeLabel")} hint={`${locale === "en" ? "current" : "当前"} ${size}px`}>
          <input
            type="range"
            min={128}
            max={1024}
            step={32}
            value={size}
            onChange={(e) => setSize(Number(e.target.value))}
            className="w-full accent-[var(--color-accent)]"
            aria-label={locale === "en" ? "QR size" : "二维码尺寸"}
          />
        </ToolSection>

        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => void generate()} className="btn btn-accent !h-8 px-3 text-xs">
            {locale === "en" ? "Generate QR" : "生成二维码"}
          </button>
          <ClearButton
            onClick={() => {
              setText("");
              setError(null);
              const canvas = canvasRef.current;
              if (canvas) {
                const ctx = canvas.getContext("2d");
                ctx?.clearRect(0, 0, canvas.width, canvas.height);
              }
            }}
            disabled={!text}
          />
          <button type="button" onClick={downloadPng} disabled={!text.trim()} className="btn btn-outline !h-8 px-3 text-xs">
            {locale === "en" ? "Download PNG" : "下载 PNG"}
          </button>
          <CopyButton getText={() => text} disabled={!text} className="ml-auto" />
        </div>

        {error && <Message tone="error">{error}</Message>}
      </div>

      <div className="space-y-4">
        <ToolSection label={locale === "en" ? "Preview" : "预览"}>
          <div className="card flex min-h-[280px] items-center justify-center p-6">
            <canvas
              ref={canvasRef}
              className="max-h-[360px] max-w-full rounded-[6px] border border-border bg-white"
              aria-label={locale === "en" ? "QR preview" : "二维码预览"}
            />
          </div>
        </ToolSection>
        <div className="rounded-[8px] border border-border bg-secondary/40 p-4 text-[13px] leading-6 text-muted-foreground">
          <p className="font-semibold text-foreground/80">{locale === "en" ? "Notes" : "说明"}</p>
          <p className="mt-1.5">
            {locale === "en" ? "Generated locally with the proven “qrcode” library — content never leaves your browser." : "使用成熟的 QR 编码库（qrcode）在浏览器本地生成，内容不会上传到任何服务器。"}
          </p>
        </div>
      </div>
    </div>
  );
}

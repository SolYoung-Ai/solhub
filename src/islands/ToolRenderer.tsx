import JsonFormatter from "./tools/JsonFormatter";
import TextCounter from "./tools/TextCounter";
import UrlCodec from "./tools/UrlCodec";
import Base64Codec from "./tools/Base64Codec";
import UuidGenerator from "./tools/UuidGenerator";
import PasswordGenerator from "./tools/PasswordGenerator";
import TimestampConverter from "./tools/TimestampConverter";
import UtmBuilder from "./tools/UtmBuilder";
import QrGenerator from "./tools/QrGenerator";
import ImageCompressor from "./tools/ImageCompressor";
import AspectRatioCalculator from "./tools/AspectRatioCalculator";
import ColorConverter from "./tools/ColorConverter";
import RobotsGenerator from "./tools/RobotsGenerator";
import LlmsGenerator from "./tools/LlmsGenerator";
import JsonLdGenerator from "./tools/JsonLdGenerator";
import MarkdownEditor from "./tools/MarkdownEditor";
import type { Locale } from "@/i18n";

/** slug -> React 组件 的静态映射（与 tools.ts 注册表 component 字段一致） */
const toolComponents: Record<string, React.ComponentType<{ locale?: Locale }>> = {
  "json-formatter": JsonFormatter,
  "text-counter": TextCounter,
  "url-codec": UrlCodec,
  "base64-codec": Base64Codec,
  "uuid-generator": UuidGenerator,
  "password-generator": PasswordGenerator,
  "timestamp-converter": TimestampConverter,
  "utm-builder": UtmBuilder,
  "qr-generator": QrGenerator,
  "image-compressor": ImageCompressor,
  "aspect-ratio-calculator": AspectRatioCalculator,
  "color-converter": ColorConverter,
  "robots-generator": RobotsGenerator,
  "llms-generator": LlmsGenerator,
  "jsonld-generator": JsonLdGenerator,
  "markdown-editor": MarkdownEditor,
};

export default function ToolRenderer({
  component,
  locale = "zh",
}: {
  component: string;
  locale?: Locale;
}) {
  const Comp = toolComponents[component];
  if (!Comp) {
    return (
      <div className="card p-6 text-sm text-muted-foreground">
        {locale === "en"
          ? "This tool is not implemented yet — it's listed but its workspace is unavailable."
          : "该工具尚未实现。它已在分类中展示，但工作区暂不可用。"}
      </div>
    );
  }
  return <Comp locale={locale} />;
}

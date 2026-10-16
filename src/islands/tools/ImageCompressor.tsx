import { useRef, useState } from "react";
import { Download, ImagePlus, Upload } from "lucide-react";
import { Message, ToolSection } from "@/components/tool-ui";

interface CompressState {
  name: string;
  originalSize: number;
  outputSize: number;
  outputUrl: string;
  outputBlob: Blob;
  width: number;
  height: number;
}

export default function ImageCompressor() {
  const [file, setFile] = useState<File | null>(null);
  const [quality, setQuality] = useState(80);
  const [format, setFormat] = useState<"auto" | "jpeg" | "webp" | "png">("auto");
  const [state, setState] = useState<CompressState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const compress = async (f: File) => {
    if (!/^image\/(png|jpe?g|webp|gif|avif|bmp)/i.test(f.type) && !/\.(png|jpe?g|webp|gif|avif|bmp)$/i.test(f.name)) {
      setError("请选择常见图片格式（PNG / JPEG / WebP / GIF 等）。");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const dataUrl = await readAsDataURL(f);
      const img = await loadImage(dataUrl);
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("canvas");
      const outMime =
        format === "jpeg"
          ? "image/jpeg"
          : format === "webp"
            ? "image/webp"
            : format === "png"
              ? "image/png"
              : f.type === "image/png"
                ? "image/png"
                : "image/jpeg";
      // JPEG / WebP 无透明通道：先铺白色背景
      if (outMime === "image/jpeg" || outMime === "image/webp") {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      ctx.drawImage(img, 0, 0);
      const blob = await canvasToBlob(canvas, outMime, quality / 100);
      if (!blob) {
        setError("压缩失败：浏览器无法以所选格式输出。");
        setBusy(false);
        return;
      }
      const outputUrl = URL.createObjectURL(blob);
      if (state?.outputUrl) URL.revokeObjectURL(state.outputUrl);
      const ext = outMime === "image/jpeg" ? "jpg" : outMime === "image/webp" ? "webp" : "png";
      setState({
        name: `${f.name.replace(/\.[^.]+$/, "")}-compressed.${ext}`,
        originalSize: f.size,
        outputSize: blob.size,
        outputUrl,
        outputBlob: blob,
        width: img.naturalWidth,
        height: img.naturalHeight,
      });
    } catch {
      setError("图片处理失败：图片可能已损坏或尺寸过大。");
    } finally {
      setBusy(false);
    }
  };

  const download = () => {
    if (!state) return;
    const a = document.createElement("a");
    a.href = state.outputUrl;
    a.download = state.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const ratio = state ? Math.max(0, Math.round((1 - state.outputSize / state.originalSize) * 100)) : 0;

  return (
    <div className="space-y-4">
      <div
        className="card flex cursor-pointer flex-col items-center justify-center gap-2 border-dashed p-8 text-center transition-colors hover:bg-secondary/40"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const f = e.dataTransfer.files?.[0];
          if (f) {
            setFile(f);
            void compress(f);
          }
        }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
        }}
        aria-label="选择或拖入图片"
      >
        <Upload className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
        <p className="text-sm font-medium text-foreground">点击选择图片，或拖拽到此处</p>
        <p className="text-xs text-muted-foreground">支持 PNG / JPEG / WebP / GIF，图片不会上传</p>
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,image/avif,image/bmp"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) {
              setFile(f);
              void compress(f);
            }
          }}
        />
      </div>

      {file && (
        <div className="grid gap-4 sm:grid-cols-2">
          <ToolSection label="输出格式" hint="auto 保留源格式">
            <select
              value={format}
              onChange={(e) => setFormat(e.target.value as typeof format)}
              className="input"
              aria-label="输出格式"
            >
              <option value="auto">自动（保留源格式）</option>
              <option value="jpeg">JPEG（无透明通道）</option>
              <option value="webp">WebP</option>
              <option value="png">PNG（保留透明）</option>
            </select>
          </ToolSection>
          <ToolSection label="质量" hint={`${quality}%`}>
            <input
              type="range"
              min={10}
              max={100}
              value={quality}
              onChange={(e) => setQuality(Number(e.target.value))}
              className="w-full accent-[var(--color-accent)]"
              aria-label="压缩质量"
            />
          </ToolSection>
        </div>
      )}

      {file && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void compress(file)}
            disabled={busy}
            className="btn btn-accent !h-8 px-3 text-xs"
          >
            <ImagePlus className="h-3.5 w-3.5" aria-hidden="true" /> {busy ? "处理中…" : "重新压缩"}
          </button>
          <button type="button" onClick={download} disabled={!state} className="btn btn-outline !h-8 px-3 text-xs">
            <Download className="h-3.5 w-3.5" aria-hidden="true" /> 下载结果
          </button>
        </div>
      )}

      {error && <Message tone="error">{error}</Message>}

      {state && (
        <div className="grid gap-4 lg:grid-cols-2">
          <ToolSection label="压缩预览">
            <img src={state.outputUrl} alt="压缩结果预览" className="max-h-[360px] w-full rounded-[3px] border border-border object-contain" />
          </ToolSection>
          <div className="space-y-3">
            <ToolSection label="压缩统计">
              <dl className="card divide-y divide-border text-sm">
                <div className="flex justify-between px-4 py-2.5">
                  <dt className="text-muted-foreground">原始大小</dt>
                  <dd className="font-mono font-medium text-foreground">{formatSize(state.originalSize)}</dd>
                </div>
                <div className="flex justify-between px-4 py-2.5">
                  <dt className="text-muted-foreground">输出大小</dt>
                  <dd className="font-mono font-medium text-foreground">{formatSize(state.outputSize)}</dd>
                </div>
                <div className="flex justify-between px-4 py-2.5">
                  <dt className="text-muted-foreground">压缩率</dt>
                  <dd className={ratio > 0 ? "font-mono font-semibold text-success" : "font-mono font-semibold text-muted-foreground"}>
                    {ratio > 0 ? `-${ratio}%` : "0%"}
                  </dd>
                </div>
                <div className="flex justify-between px-4 py-2.5">
                  <dt className="text-muted-foreground">尺寸</dt>
                  <dd className="font-mono text-foreground">{state.width} × {state.height}</dd>
                </div>
              </dl>
            </ToolSection>
            <div className="rounded-[3px] border border-border bg-secondary/40 p-4 text-[13px] leading-6 text-muted-foreground">
              <p className="font-semibold text-foreground/80">限制说明</p>
              <ul className="mt-1.5 list-disc space-y-1 pl-5">
                <li>PNG（含透明通道）转为 JPEG 时会填充白色背景。</li>
                <li>输出格式为 PNG 时压缩率通常有限（无损格式）。</li>
                <li>超大图片受浏览器 Canvas 尺寸限制，可能处理失败。</li>
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function readAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("read"));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("load"));
    img.src = src;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, mime: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, mime, quality));
}

/**
 * 匯出格式註冊中心：format → Exporter。
 * 新增格式只需 register；orchestrator 透過 resolve 取得，不需認識具體類別。
 *
 * 註：PDF 暫不註冊（pdf-lib 會讓 service worker 過大而無法註冊；且不支援 CJK）。
 * resolvePrimary('pdf') 會自動退回 Markdown，PDF 之後以 SW 安全的方式重新加入。
 */
import type { CaptureResult } from '../capture/ContentSource';
import { type Exporter, type ExportFormatId } from './Exporter';
import { MarkdownExporter } from './MarkdownExporter';
import { TextExporter } from './TextExporter';
import { SubtitleExporter } from './SubtitleExporter';

export class ExporterRegistry {
  #map = new Map<ExportFormatId, Exporter>();

  constructor() {
    this.register(new MarkdownExporter());
    this.register(new TextExporter());
    this.register(new SubtitleExporter());
  }

  register(exporter: Exporter): void {
    this.#map.set(exporter.format, exporter);
  }

  resolve(format: ExportFormatId): Exporter | undefined {
    return this.#map.get(format);
  }

  /** 主檔匯出器（md/txt）；找不到（含 pdf）退 Markdown 保底 */
  resolvePrimary(format: ExportFormatId, result: CaptureResult): Exporter {
    const e = this.#map.get(format);
    if (e && e.supports(result)) return e;
    return this.#map.get('md')!;
  }

  subtitle(): Exporter | undefined {
    return this.#map.get('subtitle');
  }
}

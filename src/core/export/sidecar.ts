/**
 * Sidecar 中繼資料（squirl/clip-meta@1）：AI Desktop / 自動化的結構化交接。
 * 純函式，無副作用；輸出一個 ExportArtifact（role='sidecar'）。
 */
import type { CaptureResult } from '../capture/ContentSource';
import type { ExportArtifact } from './Exporter';

export interface ClipMeta {
  schema: 'squirl/clip-meta@1';
  kind: 'webpage' | 'youtube';
  url: string;
  title: string;
  byline?: string;
  capturedAt: string;
  format: string;
  files: { primary: string; subtitles?: string[]; sidecar: string };
  youtube?: {
    videoId: string;
    channel?: string;
    durationSec?: number;
    captionLangs: string[];
  };
  /** 字幕純文字（可選；併入供 KB 直接索引） */
  captionsText?: string;
  tags: string[];
  project: string | null;
  source: 'squirl';
  version: string;
}

export function buildSidecar(
  result: CaptureResult,
  args: {
    baseName: string;
    primaryFileName: string;
    subtitleFileNames: string[];
    sidecarFileName: string;
    format: string;
    tags: string[];
    project: string | null;
    version: string;
    captionsIntoSidecar: boolean;
  },
): ExportArtifact {
  const meta: ClipMeta = {
    schema: 'squirl/clip-meta@1',
    kind: result.kind,
    url: result.url,
    title: result.title,
    byline: result.byline,
    capturedAt: result.capturedAt,
    format: args.format,
    files: {
      primary: args.primaryFileName,
      subtitles: args.subtitleFileNames.length ? args.subtitleFileNames : undefined,
      sidecar: args.sidecarFileName,
    },
    tags: args.tags,
    project: args.project,
    source: 'squirl',
    version: args.version,
  };

  if (result.youtube) {
    meta.youtube = {
      videoId: result.youtube.videoId,
      channel: result.youtube.channel,
      durationSec: result.youtube.durationSec,
      captionLangs: result.youtube.captions.map((c) => c.lang),
    };
    if (args.captionsIntoSidecar) {
      const text = result.youtube.captions
        .filter((c) => c.text)
        .map((c) => `# ${c.name} (${c.lang})\n${c.text}`)
        .join('\n\n');
      if (text) meta.captionsText = text;
    }
  }

  const json = JSON.stringify(meta, null, 2);
  return {
    blob: new Blob([json], { type: 'application/json;charset=utf-8' }),
    fileName: args.sidecarFileName,
    mimeType: 'application/json',
    role: 'sidecar',
  };
}

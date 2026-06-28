/**
 * YouTube 字幕軌 → .srt / .vtt（每個語言軌一個檔，role='subtitle'）。
 * 無 cues 的軌（只有純文字）退成「無時間碼」純文字 .txt 字幕。
 */
import type { CaptionCue, CaptionTrack, CaptureResult } from '../capture/ContentSource';
import { type ExportArtifact, type Exporter, type ExportOptions } from './Exporter';

export class SubtitleExporter implements Exporter {
  readonly format = 'subtitle' as const;

  supports(result: CaptureResult): boolean {
    return result.kind === 'youtube' && (result.youtube?.captions?.length ?? 0) > 0;
  }

  async export(result: CaptureResult, opts: ExportOptions): Promise<ExportArtifact[]> {
    const tracks = result.youtube?.captions ?? [];
    const out: ExportArtifact[] = [];
    for (const t of tracks) {
      if (!t.text && !t.cues?.length) continue;
      out.push(renderTrack(t, opts));
    }
    return out;
  }
}

function renderTrack(track: CaptionTrack, opts: ExportOptions): ExportArtifact {
  const langTag = track.lang + (track.auto ? '.auto' : '');
  if (track.cues?.length) {
    if (opts.subtitleFormat === 'vtt') {
      return {
        blob: new Blob([toVtt(track.cues)], { type: 'text/vtt;charset=utf-8' }),
        fileName: `${opts.baseName}.${langTag}.vtt`,
        mimeType: 'text/vtt',
        role: 'subtitle',
      };
    }
    return {
      blob: new Blob([toSrt(track.cues)], { type: 'application/x-subrip;charset=utf-8' }),
      fileName: `${opts.baseName}.${langTag}.srt`,
      mimeType: 'application/x-subrip',
      role: 'subtitle',
    };
  }
  // 只有純文字
  return {
    blob: new Blob([track.text ?? ''], { type: 'text/plain;charset=utf-8' }),
    fileName: `${opts.baseName}.${langTag}.txt`,
    mimeType: 'text/plain',
    role: 'subtitle',
  };
}

function toSrt(cues: CaptionCue[]): string {
  return cues
    .map((c, i) => `${i + 1}\n${ts(c.startSec, ',')} --> ${ts(c.endSec, ',')}\n${c.text}\n`)
    .join('\n');
}

function toVtt(cues: CaptionCue[]): string {
  return 'WEBVTT\n\n' + cues.map((c) => `${ts(c.startSec, '.')} --> ${ts(c.endSec, '.')}\n${c.text}\n`).join('\n');
}

function ts(sec: number, msSep: ',' | '.'): string {
  const s = Math.max(0, sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = Math.floor(s % 60);
  const ms = Math.round((s - Math.floor(s)) * 1000);
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(h)}:${p(m)}:${p(ss)}${msSep}${p(ms, 3)}`;
}

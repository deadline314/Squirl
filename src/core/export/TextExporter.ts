/**
 * ContentTree → 純文字（縮排表達階層；表格以欄位對齊；保留大綱）。
 */
import type { CaptureResult, ContentNode } from '../capture/ContentSource';
import { type ExportArtifact, type Exporter, type ExportOptions } from './Exporter';

export class TextExporter implements Exporter {
  readonly format = 'txt' as const;

  supports(): boolean {
    return true;
  }

  async export(result: CaptureResult, opts: ExportOptions): Promise<ExportArtifact[]> {
    const head = [result.title, result.url, result.capturedAt].filter(Boolean).join('\n');
    const body = renderNodes(result.tree, opts, 0).trim();
    const txt = `${head}\n${'='.repeat(40)}\n\n${body}\n`;
    const blob = new Blob([txt], { type: 'text/plain;charset=utf-8' });
    return [{ blob, fileName: `${opts.baseName}.txt`, mimeType: 'text/plain', role: 'primary' }];
  }
}

function renderNodes(nodes: ContentNode[], opts: ExportOptions, indent: number): string {
  return nodes.map((n) => renderNode(n, opts, indent)).filter(Boolean).join('\n\n');
}

function renderNode(n: ContentNode, opts: ExportOptions, indent: number): string {
  const pad = '  '.repeat(indent);
  switch (n.type) {
    case 'section': {
      const head = n.text ? `${pad}${n.text}\n${pad}${'-'.repeat(Math.min(40, n.text.length))}` : '';
      const body = renderNodes(n.children ?? [], opts, n.level && n.level > 0 ? indent + 1 : indent);
      return [head, body].filter(Boolean).join('\n');
    }
    case 'heading':
      return `${pad}${n.text ?? ''}`;
    case 'paragraph':
      return wrap(n.text ?? '', pad);
    case 'quote':
      return wrap(n.text ?? '', `${pad}| `);
    case 'code':
      return (n.text ?? '')
        .split('\n')
        .map((l) => `${pad}    ${l}`)
        .join('\n');
    case 'list':
      return renderList(n, indent);
    case 'table':
      return renderTable(n.rows ?? [], pad);
    case 'image':
      return opts.includeImages && n.src ? `${pad}[圖片] ${n.alt ?? ''} <${n.src}>` : '';
    case 'divider':
      return `${pad}${'—'.repeat(20)}`;
    default:
      return '';
  }
}

function renderList(list: ContentNode, indent: number): string {
  const pad = '  '.repeat(indent);
  const out: string[] = [];
  let i = 1;
  for (const item of list.children ?? []) {
    const marker = list.ordered ? `${i++}.` : '•';
    out.push(`${pad}${marker} ${(item.text ?? '').trim()}`);
    for (const child of item.children ?? []) {
      if (child.type === 'list') out.push(renderList(child, indent + 1));
    }
  }
  return out.join('\n');
}

function renderTable(rows: string[][], pad: string): string {
  if (!rows.length) return '';
  const cols = Math.max(...rows.map((r) => r.length));
  const widths = Array(cols).fill(0);
  for (const r of rows) {
    for (let c = 0; c < cols; c++) widths[c] = Math.max(widths[c], (r[c] ?? '').length);
  }
  return rows
    .map((r) => pad + Array.from({ length: cols }, (_, c) => (r[c] ?? '').padEnd(widths[c])).join('  '))
    .join('\n');
}

function wrap(text: string, pad: string, width = 90): string {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    if ((line + ' ' + w).trim().length > width) {
      lines.push(pad + line.trim());
      line = w;
    } else {
      line += ' ' + w;
    }
  }
  if (line.trim()) lines.push(pad + line.trim());
  return lines.join('\n');
}

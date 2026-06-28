/**
 * ContentTree → 階層式 Markdown（表格保留、清單巢狀、code fence、front-matter）。
 */
import type { CaptureResult, ContentNode } from '../capture/ContentSource';
import { type ExportArtifact, type Exporter, type ExportOptions } from './Exporter';

export class MarkdownExporter implements Exporter {
  readonly format = 'md' as const;

  supports(): boolean {
    return true;
  }

  async export(result: CaptureResult, opts: ExportOptions): Promise<ExportArtifact[]> {
    const md = frontMatter(result) + '\n' + renderNodes(result.tree, opts).trim() + '\n';
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    return [{ blob, fileName: `${opts.baseName}.md`, mimeType: 'text/markdown', role: 'primary' }];
  }
}

function frontMatter(r: CaptureResult): string {
  const esc = (s: string) => '"' + s.replace(/"/g, '\\"') + '"';
  const lines = [
    '---',
    `title: ${esc(r.title)}`,
    `source: ${esc(r.url)}`,
    `kind: ${r.kind}`,
    `clipped_at: ${esc(r.capturedAt)}`,
  ];
  if (r.byline) lines.push(`author: ${esc(r.byline)}`);
  if (r.lang) lines.push(`lang: ${esc(r.lang)}`);
  if (r.youtube?.channel) lines.push(`channel: ${esc(r.youtube.channel)}`);
  lines.push('source_app: squirl', '---');
  return lines.join('\n') + '\n';
}

function renderNodes(nodes: ContentNode[], opts: ExportOptions, depth = 0): string {
  return nodes.map((n) => renderNode(n, opts, depth)).filter(Boolean).join('\n\n');
}

function renderNode(n: ContentNode, opts: ExportOptions, depth: number): string {
  switch (n.type) {
    case 'section': {
      const head = n.text && n.level ? `${'#'.repeat(Math.min(6, n.level))} ${n.text}` : '';
      const body = renderNodes(n.children ?? [], opts, depth);
      return [head, body].filter(Boolean).join('\n\n');
    }
    case 'heading':
      return `${'#'.repeat(Math.min(6, n.level ?? 2))} ${n.text ?? ''}`;
    case 'paragraph':
      return n.text ?? '';
    case 'quote':
      return (n.text ?? '')
        .split('\n')
        .map((l) => `> ${l}`)
        .join('\n');
    case 'code':
      return '```' + (n.lang ?? '') + '\n' + (n.text ?? '') + '\n```';
    case 'list':
      return renderList(n, opts, 0);
    case 'table':
      return renderTable(n.rows ?? []);
    case 'image':
      return opts.includeImages && n.src ? `![${n.alt ?? ''}](${n.src})` : '';
    case 'divider':
      return '---';
    default:
      return '';
  }
}

function renderList(list: ContentNode, opts: ExportOptions, indent: number): string {
  const pad = '  '.repeat(indent);
  const out: string[] = [];
  let i = 1;
  for (const item of list.children ?? []) {
    const marker = list.ordered ? `${i++}.` : '-';
    const text = (item.text ?? '').trim();
    out.push(`${pad}${marker} ${text}`);
    for (const child of item.children ?? []) {
      if (child.type === 'list') out.push(renderList(child, opts, indent + 1));
    }
  }
  return out.join('\n');
}

function renderTable(rows: string[][]): string {
  if (!rows.length) return '';
  const cols = Math.max(...rows.map((r) => r.length));
  const norm = rows.map((r) => {
    const cells = r.map((c) => c.replace(/\|/g, '\\|').replace(/\n/g, ' '));
    while (cells.length < cols) cells.push('');
    return cells;
  });
  const header = norm[0]!;
  const sep = Array(cols).fill('---');
  const lines = [`| ${header.join(' | ')} |`, `| ${sep.join(' | ')} |`];
  for (const r of norm.slice(1)) lines.push(`| ${r.join(' | ')} |`);
  return lines.join('\n');
}

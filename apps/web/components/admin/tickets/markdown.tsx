'use client';

import { useMemo } from 'react';

/**
 * Minimal, safe Markdown → HTML for ticket bodies (bold, italic, code, links, lists, quotes, line breaks).
 * Everything is HTML-escaped first; only our own tags are emitted.
 */
export function renderMarkdown(src: string): string {
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const blocks = src.replace(/\r\n/g, '\n').split(/\n{2,}/);
  const inline = (s: string) =>
    esc(s)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|\W)_([^_]+)_(?=\W|$)/g, '$1<em>$2</em>')
      .replace(
        /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
        '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>',
      )
      .replace(
        /(^|\s)(https?:\/\/[^\s<]+)/g,
        '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>',
      )
      .replace(/\n/g, '<br />');
  return blocks
    .map((b) => {
      const fence = b.match(/^```[a-z]*\n?([\s\S]*?)\n?```$/);
      if (fence) return `<pre><code>${esc(fence[1] ?? '')}</code></pre>`;
      if (/^(\s*[-*] .+\n?)+$/.test(b))
        return `<ul>${b
          .split('\n')
          .map((l) => `<li>${inline(l.replace(/^\s*[-*] /, ''))}</li>`)
          .join('')}</ul>`;
      if (/^(\s*\d+\. .+\n?)+$/.test(b))
        return `<ol>${b
          .split('\n')
          .map((l) => `<li>${inline(l.replace(/^\s*\d+\. /, ''))}</li>`)
          .join('')}</ol>`;
      if (/^> /.test(b)) return `<blockquote>${inline(b.replace(/^> ?/gm, ''))}</blockquote>`;
      const h = b.match(/^(#{1,3}) (.+)$/);
      if (h) return `<h${h[1]?.length}>${inline(h[2] ?? '')}</h${h[1]?.length}>`;
      return `<p>${inline(b)}</p>`;
    })
    .join('');
}

export function Markdown({ children, className }: { children: string; className?: string }) {
  const html = useMemo(() => renderMarkdown(children), [children]);
  return (
    <div
      className={`prose-ticket text-sm [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:text-xs [&_h1]:font-semibold [&_h2]:font-semibold [&_h3]:font-semibold [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-2 [&_pre]:overflow-auto [&_pre]:rounded [&_pre]:bg-muted [&_pre]:p-2 [&_ul]:list-disc [&_ul]:pl-5 ${className ?? ''}`}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: output is produced by our escaping renderer above
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

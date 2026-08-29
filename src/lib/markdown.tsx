import React from 'react';

/**
 * Renders a limited subset of Markdown suitable for chat messages:
 *  - **bold**  → <strong>
 *  - *italic*  → <em>
 *  - `code`    → <code>
 *  - # / ## / ### headings → bold lines with size scaling
 *  - - or * bullet lists   → <ul><li>
 *  - 1. numbered lists     → <ol><li>
 *  - line breaks           → preserved
 *
 * No raw HTML is passed through — everything is text-only, preventing XSS.
 */
function formatMarkdown(md: string): React.ReactNode {
  if (!md) return null;

  const lines = md.split('\n');
  const blocks: React.ReactNode[] = [];
  let listItems: string[] = [];
  let listType: 'ul' | 'ol' | null = null;
  let key = 0;

  const flushList = () => {
    if (listItems.length === 0) return;
    if (listType === 'ol') {
      blocks.push(
        <ol key={key++} className="list-decimal pl-5 my-1 space-y-0.5">
          {listItems.map((item, i) => (
            <li key={i}>{renderInline(item)}</li>
          ))}
        </ol>
      );
    } else {
      blocks.push(
        <ul key={key++} className="list-disc pl-5 my-1 space-y-0.5">
          {listItems.map((item, i) => (
            <li key={i}>{renderInline(item)}</li>
          ))}
        </ul>
      );
    }
    listItems = [];
    listType = null;
  };

  for (const rawLine of lines) {
    const line = rawLine;

    // Bullet list item:  - text  or  * text  (but not ** bold)
    const bulletMatch = line.match(/^\s*[-*]\s+(.+)$/);
    if (bulletMatch && !line.match(/^\s*\*\*[^*]/)) {
      if (listType !== 'ul') { flushList(); listType = 'ul'; }
      listItems.push(bulletMatch[1]);
      continue;
    }

    // Numbered list item:  1. text
    const numMatch = line.match(/^\s*\d+\.\s+(.+)$/);
    if (numMatch) {
      if (listType !== 'ol') { flushList(); listType = 'ol'; }
      listItems.push(numMatch[1]);
      continue;
    }

    // Flush any pending list
    flushList();

    // Headings
    const h3 = line.match(/^###\s+(.+)$/);
    if (h3) {
      blocks.push(<p key={key++} className="font-bold text-sm mt-2 mb-1">{renderInline(h3[1])}</p>);
      continue;
    }
    const h2 = line.match(/^##\s+(.+)$/);
    if (h2) {
      blocks.push(<p key={key++} className="font-bold text-base mt-2 mb-1">{renderInline(h2[1])}</p>);
      continue;
    }
    const h1 = line.match(/^#\s+(.+)$/);
    if (h1) {
      blocks.push(<p key={key++} className="font-bold text-base mt-2 mb-1">{renderInline(h1[1])}</p>);
      continue;
    }

    // Empty line → small gap
    if (line.trim() === '') {
      blocks.push(<div key={key++} className="h-2" />);
      continue;
    }

    // Regular paragraph
    blocks.push(<p key={key++} className="leading-relaxed">{renderInline(line)}</p>);
  }

  flushList();

  return <div className="space-y-0.5">{blocks}</div>;
}

/** Render inline markdown: **bold**, *italic*, `code` */
function renderInline(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;

  // Pattern matches **bold**, *italic*, or `code`
  const pattern = /(\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`)/;

  while (remaining.length > 0) {
    const match = remaining.match(pattern);
    if (!match) {
      nodes.push(<React.Fragment key={key++}>{remaining}</React.Fragment>);
      break;
    }

    const before = remaining.slice(0, match.index);
    if (before) {
      nodes.push(<React.Fragment key={key++}>{before}</React.Fragment>);
    }

    if (match[2] !== undefined) {
      // **bold**
      nodes.push(<strong key={key++} className="font-bold">{match[2]}</strong>);
    } else if (match[3] !== undefined) {
      // *italic*
      nodes.push(<em key={key++}>{match[3]}</em>);
    } else if (match[4] !== undefined) {
      // `code`
      nodes.push(
        <code key={key++} className="px-1 py-0.5 rounded bg-black/10 text-xs font-mono">
          {match[4]}
        </code>
      );
    }

    remaining = remaining.slice((match.index ?? 0) + match[0].length);
  }

  return nodes;
}

export default formatMarkdown;

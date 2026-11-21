import { Fragment, ReactNode } from 'react';

/**
 * Small, safe Markdown subset for LLM replies in a narrow chat bubble. Builds React elements
 * (never innerHTML), so model output can't inject markup or scripts.
 *
 * Supports: paragraphs, headings (rendered as bold lines), "-", "*", "•" and "1." / "1)" lists
 * (start number kept, indented items rendered one level nested, wrapped continuation lines
 * joined), fenced code, tables (flattened to "a · b" lines), horizontal rules (dropped),
 * **bold**, __bold__, *italic*, _italic_, `code`, and [links](https://…).
 */

const LIST_RE = /^(\s*)([-*•+]|\d+[.)])\s+(.*)$/;
const HR_RE = /^\s*([-*_])(\s*\1){2,}\s*$/;
const TABLE_SEP_RE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

type Item = { text: string; nested: boolean };

export default function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let i = 0;
  const key = () => blocks.length;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed || HR_RE.test(line)) {
      i++;
      continue;
    }

    if (trimmed.startsWith('```')) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) code.push(lines[i++]);
      i++;
      blocks.push(
        <pre key={key()}>
          <code>{code.join('\n')}</code>
        </pre>,
      );
      continue;
    }

    const heading = /^#{1,6}\s+(.*)$/.exec(trimmed);
    if (heading) {
      blocks.push(
        <p key={key()} className="md-heading">
          <strong>{inline(heading[1].replace(/\*\*/g, ''))}</strong>
        </p>,
      );
      i++;
      continue;
    }

    // Tables don't fit a 380px bubble: flatten each row to "cell · cell".
    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      const rows: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        if (!TABLE_SEP_RE.test(lines[i])) {
          rows.push(
            lines[i]
              .trim()
              .replace(/^\||\|$/g, '')
              .split('|')
              .map((c) => c.trim())
              .filter(Boolean)
              .join(' · '),
          );
        }
        i++;
      }
      blocks.push(
        <ul key={key()}>
          {rows.map((r, k) => (
            <li key={k}>{inline(r)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    const first = LIST_RE.exec(line);
    if (first) {
      const ordered = /\d/.test(first[2]);
      const start = ordered ? parseInt(first[2], 10) : undefined;
      const baseIndent = first[1].length;
      const items: Item[] = [];
      while (i < lines.length) {
        const m = LIST_RE.exec(lines[i]);
        if (m) {
          items.push({ text: m[3], nested: m[1].length > baseIndent + 1 });
          i++;
        } else if (lines[i].trim() && /^\s{2,}/.test(lines[i]) && items.length) {
          items[items.length - 1].text += ' ' + lines[i].trim(); // wrapped continuation line
          i++;
        } else if (!lines[i].trim() && i + 1 < lines.length && LIST_RE.exec(lines[i + 1])) {
          i++; // blank line between items of the same list
        } else break;
      }
      const List = ordered ? 'ol' : 'ul';
      blocks.push(
        <List key={key()} start={start !== 1 ? start : undefined}>
          {items.map((it, k) => (
            <li key={k} className={it.nested ? 'md-nested' : undefined}>
              {inline(it.text)}
            </li>
          ))}
        </List>,
      );
      continue;
    }

    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !LIST_RE.test(lines[i]) && !/^\s*(#{1,6}\s|```|\|)/.test(lines[i]) && !HR_RE.test(lines[i])) {
      para.push(lines[i++].trim());
    }
    blocks.push(
      <p key={key()}>
        {para.map((p, k) => (
          <Fragment key={k}>
            {k > 0 && <br />}
            {inline(p)}
          </Fragment>
        ))}
      </p>,
    );
  }
  return <>{blocks}</>;
}

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+?\*\*|__[^_]+?__|`[^`]+`|\[[^\]]+\]\((https?:\/\/[^)\s]+)\)|\*[^*\s][^*]*?\*|(?<![\w])_[^_\s][^_]*?_(?![\w]))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    const k = m.index;
    if (t.startsWith('**') || t.startsWith('__')) out.push(<strong key={k}>{t.slice(2, -2)}</strong>);
    else if (t.startsWith('`')) out.push(<code key={k}>{t.slice(1, -1)}</code>);
    else if (t.startsWith('[')) {
      out.push(
        <a key={k} href={m[2]} target="_blank" rel="noopener noreferrer nofollow">
          {t.slice(1, t.indexOf(']('))}
        </a>,
      );
    } else out.push(<em key={k}>{t.slice(1, -1)}</em>);
    last = k + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

import { esc } from './dom.js';
import { highlight } from './highlight.js';
// Minimal Markdown -> HTML. Supports: #..#### headings, paragraphs, - / 1. lists (one nesting level),
// ``` fenced code, | tables |, > blockquote, **bold**, *italic*, `code`, [text](url), [[glossary term]].
export function inline(t) {
  const codes = [];
  t = t.replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
  t = esc(t);
  t = t.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, term, label) => `<a class="gloss" href="#/glossary/${encodeURIComponent(term.toLowerCase())}">${label || term}</a>`);
  t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, a, u) => /^(https?:|#|mailto:)/.test(u) ? `<a href="${u}"${u.startsWith('http') ? ' target="_blank" rel="noopener"' : ''}>${a}</a>` : a);
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
  return t.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${esc(codes[+i])}</code>`);
}
export function md(src) {
  if (!src) return '';
  const lines = String(src).replace(/\r/g, '').split('\n');
  // strip common indentation so template literals can be indented in source
  const ind = Math.min(...lines.filter((l) => l.trim()).map((l) => l.match(/^ */)[0].length), 99);
  const L = lines.map((l) => l.slice(Math.min(ind, l.match(/^ */)[0].length)));
  let out = '', i = 0;
  const para = [];
  const flush = () => { if (para.length) { out += `<p>${inline(para.join(' '))}</p>`; para.length = 0; } };
  while (i < L.length) {
    const l = L[i];
    let m;
    if ((m = l.match(/^```(\w*)\s*$/))) {
      flush(); const buf = []; i++;
      while (i < L.length && !/^```\s*$/.test(L[i])) buf.push(L[i++]);
      i++;
      out += `<pre class="code" data-lang="${m[1] || 'text'}"><code>${highlight(buf.join('\n'), m[1] || 'text')}</code></pre>`;
    } else if ((m = l.match(/^(#{1,4})\s+(.*)$/))) {
      flush(); const n = Math.min(m[1].length + 1, 5); out += `<h${n}>${inline(m[2])}</h${n}>`; i++;
    } else if (/^\s*\|.*\|\s*$/.test(l)) {
      flush(); const rows = [];
      while (i < L.length && /^\s*\|.*\|\s*$/.test(L[i])) rows.push(L[i++].trim().slice(1, -1).replace(/`[^`]*`/g, (m) => m.replace(/\|/g, '\u0001')).split('|').map((c) => c.trim().replace(/\u0001/g, '|')));
      const hasHead = rows[1] && rows[1].every((c) => /^:?-+:?$/.test(c));
      out += '<div class="table-wrap"><table>';
      if (hasHead) out += `<thead><tr>${rows[0].map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead>`;
      out += `<tbody>${rows.slice(hasHead ? 2 : 0).map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
    } else if (/^\s*([-*]|\d+\.)\s+/.test(l)) {
      flush();
      const ordered = /^\s*\d+\./.test(l); const base = l.match(/^\s*/)[0].length;
      out += ordered ? '<ol>' : '<ul>';
      let open = false;
      while (i < L.length && (/^\s*([-*]|\d+\.)\s+/.test(L[i]) || (/^\s{2,}\S/.test(L[i]) && open))) {
        const cur = L[i]; const lead = cur.match(/^\s*/)[0].length;
        const li = cur.match(/^\s*([-*]|\d+\.)\s+(.*)$/);
        if (li && lead <= base + 1) { if (open) out += '</li>'; out += `<li>${inline(li[2])}`; open = true; i++; }
        else if (li) { // nested list
          const o2 = /^\s*\d+\./.test(cur); out += o2 ? '<ol>' : '<ul>';
          while (i < L.length && /^\s*([-*]|\d+\.)\s+/.test(L[i]) && L[i].match(/^\s*/)[0].length > base + 1) { out += `<li>${inline(L[i].replace(/^\s*([-*]|\d+\.)\s+/, ''))}</li>`; i++; }
          out += o2 ? '</ol>' : '</ul>';
        } else { out += ' ' + inline(cur.trim()); i++; }
      }
      if (open) out += '</li>';
      out += ordered ? '</ol>' : '</ul>';
    } else if (/^>\s?/.test(l)) {
      flush(); const buf = [];
      while (i < L.length && /^>\s?/.test(L[i])) buf.push(L[i++].replace(/^>\s?/, ''));
      out += `<blockquote>${md(buf.join('\n'))}</blockquote>`;
    } else if (!l.trim()) { flush(); i++; }
    else { para.push(l.trim()); i++; }
  }
  flush();
  return out;
}

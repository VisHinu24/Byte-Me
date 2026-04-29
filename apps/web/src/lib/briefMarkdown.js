/**
 * Tiny markdown renderer tuned for the agent brief.
 *
 * Supports:
 *   **bold**, _italic_, headings via **Section** lines, bullet lists, and
 *   the [cite:ResourceType/id] custom token which renders as a provenance pin.
 *
 * Keeps deps zero — `marked` is overkill and `react-markdown` would force us
 * to thread custom node renderers for the cite token.
 */

function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderInline(s) {
  let out = escapeHtml(s);

  // Provenance pins
  out = out.replace(/\[cite:([A-Za-z]+)\/([^\]]+)\]/g, (_, type, id) => {
    return `<a class="cite" data-resource-type="${type}" data-resource-id="${id}" title="${type}/${id}">📌 ${type.slice(0, 3).toLowerCase()}</a>`;
  });

  // **bold**
  out = out.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // _italic_
  out = out.replace(/(^|\W)_([^_\n]+)_(\W|$)/g, '$1<em>$2</em>$3');

  return out;
}

export function renderBriefMarkdown(md) {
  if (!md) return '';
  const lines = md.split('\n');
  const html = [];
  let inList = false;

  const closeList = () => {
    if (inList) {
      html.push('</ul>');
      inList = false;
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();

    // Section heading: a line that is just **Section name**
    const headingMatch = line.match(/^\*\*(.+?)\*\*$/);
    if (headingMatch) {
      closeList();
      html.push(`<h3>${escapeHtml(headingMatch[1])}</h3>`);
      continue;
    }

    if (line.startsWith('- ') || line.startsWith('* ')) {
      if (!inList) {
        html.push('<ul>');
        inList = true;
      }
      html.push(`<li>${renderInline(line.slice(2))}</li>`);
      continue;
    }

    closeList();

    if (line === '') {
      html.push('');
      continue;
    }

    html.push(`<p>${renderInline(line)}</p>`);
  }
  closeList();
  return html.join('\n');
}

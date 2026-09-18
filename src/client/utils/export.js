function copyDebate() {
  const md = buildMarkdown();
  navigator.clipboard.writeText(md).then(() => showToast('Copied!', 'success')).catch(() => showToast('Copy failed', 'error'));
}

function exportMarkdown() {
  const md = buildMarkdown();
  downloadFile(md, 'debate.md', 'text/markdown');
}

function exportJSON() {
  const data = window.currentDebateData || {};
  downloadFile(JSON.stringify(data, null, 2), 'debate.json', 'application/json');
}

function buildMarkdown() {
  const d = window.currentDebateData;
  if (!d) return '';
  let md = '# AI Debate\n\n## Problem\n' + d.question + '\n';
  if (d.round1) {
    md += '\n## Round 1 — Independent Analysis\n';
    for (const [model, resp] of Object.entries(d.round1)) {
      md += '\n### ' + model + '\n' + resp + '\n';
    }
  }
  if (d.round2) {
    md += '\n## Round 2 — Cross Examination\n';
    for (const [model, resp] of Object.entries(d.round2)) {
      md += '\n### ' + model + '\n' + resp + '\n';
    }
  }
  if (d.round3) {
    md += '\n## Final Positions\n';
    for (const [model, resp] of Object.entries(d.round3)) {
      md += '\n### ' + model + '\n' + resp + '\n';
    }
  }
  if (d.moderator) md += '\n## Moderator\n' + d.moderator + '\n';
  return md;
}

function downloadFile(content, name, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

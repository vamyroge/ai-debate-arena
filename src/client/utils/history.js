function saveToHistory(data) {
  try {
    const h = JSON.parse(localStorage.getItem('debate_history') || '[]');
    h.unshift({ ...data, timestamp: Date.now(), id: Date.now().toString() });
    localStorage.setItem('debate_history', JSON.stringify(h.slice(0, 50)));
  } catch(e) {}
}

function getHistory() {
  try { return JSON.parse(localStorage.getItem('debate_history') || '[]'); } catch(e) { return []; }
}

function deleteFromHistory(id) {
  try {
    let h = getHistory().filter(x => x.id !== id);
    localStorage.setItem('debate_history', JSON.stringify(h));
  } catch(e) {}
}

function renderHistory() {
  const list = document.getElementById('history-list');
  if (!list) return;
  const h = getHistory();
  if (h.length === 0) { list.innerHTML = '<p style="color:var(--text-muted)">No debates yet.</p>'; return; }
  list.innerHTML = h.map(d => `<div class="history-item" onclick="loadHistoryItem('${d.id}')"><h4>${d.question}</h4><span>${new Date(d.timestamp).toLocaleString()}</span></div>`).join('');
}

function loadHistoryItem(id) {
  const item = getHistory().find(x => x.id === id);
  if (item) { window.currentDebateData = item; showToast('Loaded', 'success'); }
}

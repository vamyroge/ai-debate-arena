let savedApiKey = '';
window.currentDebateData = null;

async function checkApiKeyStatus() {
  try {
    const r = await fetch('/api/api-key/status');
    const d = await r.json();
    const s = document.getElementById('api-key-status');
    const section = document.getElementById('api-key-section');
    if (d.configured) {
      if (s) { s.textContent = 'API key configured'; s.style.color = 'var(--success)'; }
      if (section) section.classList.add('hidden');
    } else {
      if (s) { s.textContent = 'API key required'; s.style.color = 'var(--error)'; }
      if (section) section.classList.remove('hidden');
    }
  } catch(e) {}
}

async function saveApiKey() {
  const i = document.getElementById('api-key-input');
  const k = i ? i.value.trim() : '';
  if (!k) { showToast('Please enter an API key', 'error'); return; }
  try {
    const r = await fetch('/api/api-key', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: k })
    });
    if (r.ok) {
      savedApiKey = k;
      showToast('API key saved successfully!', 'success');
      const section = document.getElementById('api-key-section');
      if (section) section.classList.add('hidden');
      checkApiKeyStatus();
    } else {
      showToast('Failed to save API key', 'error');
    }
  } catch(e) {
    showToast('Failed to save API key', 'error');
  }
}

function startDebate() {
  const question = document.getElementById('question-input').value.trim();
  if (!question) { showToast('Enter a question first', 'error'); return; }
  const rounds = parseInt(document.getElementById('rounds-select').value);
  const intensity = document.getElementById('intensity-select').value;
  const length = document.getElementById('length-select').value;
  const checkboxes = document.querySelectorAll('.model-checkboxes input:checked');
  const models = Array.from(checkboxes).map(c => c.value);
  if (models.length === 0) { showToast('Select at least one AI model', 'error'); return; }

  document.getElementById('demo-section').classList.add('hidden');
  document.getElementById('debate-section').classList.remove('hidden');
  document.getElementById('btn-start').classList.add('hidden');
  document.getElementById('btn-cancel').classList.remove('hidden');
  document.getElementById('export-bar').classList.add('hidden');

  window.currentDebateData = { question, rounds, intensity, models, round1: {}, round2: {}, round3: {}, moderator: '' };

  const agentCards = document.getElementById('agent-cards');
  agentCards.innerHTML = '';
  agentCards.classList.remove('hidden');
  const modelInfo = {
    'qwen/qwen3.5-plus:free': { name: 'Qwen', role: 'LOGICAL ANALYST', color: 'var(--qwen)' },
    'minimax/minimax-m3:free': { name: 'MiniMax', role: 'STRATEGIC THINKER', color: 'var(--minimax)' },
    'mistralai/mistral-large-2512': { name: 'Mistral', role: "DEVIL'S ADVOCATE", color: 'var(--mistral)' },
    'mistralai/devstral-medium': { name: 'Devstral', role: 'INDEPENDENT ANALYST', color: 'var(--devstral)' }
  };
  models.forEach(m => {
    const info = modelInfo[m] || { name: m, role: 'AI', color: 'var(--accent)' };
    const card = document.createElement('div');
    card.className = 'agent-card';
    card.id = 'card-' + m.replace(/[^a-zA-Z0-9]/g, '');
    card.innerHTML = `<h4 style="color:${info.color}">${info.name}</h4><p class="role">${info.role}</p><p class="status" id="status-${m.replace(/[^a-zA-Z0-9]/g, '')}">WAITING</p>`;
    agentCards.appendChild(card);
  });

  updateTimeline(0);

  fetch('/api/debate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, rounds, intensity, models, apiKey: savedApiKey })
  }).then(response => {
    if (!response.ok) {
      response.json().then(d => showToast(d.error || 'Error', 'error'));
      resetButtons();
      return;
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    function read() {
      reader.read().then(({ done, value }) => {
        if (done) { finishDebate(); return; }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();
        lines.forEach(line => {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              handleSSE(data);
            } catch(e) {}
          }
        });
        read();
      });
    }
    read();
  }).catch(e => {
    showToast('Connection error', 'error');
    resetButtons();
  });
}

function handleSSE(data) {
  switch(data.type) {
    case 'round_start':
      if (data.round === 1) {
        document.getElementById('round1-container').classList.remove('hidden');
        updateTimeline(1);
      } else if (data.round === 2) {
        document.getElementById('round2-container').classList.remove('hidden');
        updateTimeline(2);
      } else if (data.round === 3) {
        document.getElementById('round3-container').classList.remove('hidden');
        updateTimeline(3);
      } else if (data.round === 'moderator') {
        document.getElementById('moderator-container').classList.remove('hidden');
        updateTimeline(4);
      }
      break;
    case 'agent_status':
      const sid = 'status-' + data.model.replace(/[^a-zA-Z0-9]/g, '');
      const sel = document.getElementById(sid);
      if (sel) sel.textContent = data.status;
      break;
    case 'stream':
      appendStream(data.model, data.chunk, data.round);
      break;
    case 'round1_result':
      if (window.currentDebateData) window.currentDebateData.round1[data.model] = data.content;
      break;
    case 'round2_result':
      if (window.currentDebateData) window.currentDebateData.round2[data.model] = data.content;
      break;
    case 'round3_result':
      if (window.currentDebateData) window.currentDebateData.round3[data.model] = data.content;
      break;
    case 'moderator_result':
      if (window.currentDebateData) window.currentDebateData.moderator = data.content;
      renderModerator(data.content);
      break;
    case 'error':
      showToast(data.message, 'error');
      break;
    case 'complete':
      finishDebate();
      break;
  }
}

function appendStream(model, chunk, round) {
  let containerId = '';
  if (round === 1 || round === '1') containerId = 'round1-panels';
  else if (round === 2 || round === '2') containerId = 'round2-timeline';
  else if (round === 3 || round === '3') containerId = 'round3-panels';
  else if (round === 'moderator') containerId = 'moderator-dashboard';
  const container = document.getElementById(containerId);
  if (!container) return;
  let panel = document.getElementById('stream-' + model.replace(/[^a-zA-Z0-9]/g, '') + '-' + round);
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'stream-' + model.replace(/[^a-zA-Z0-9]/g, '') + '-' + round;
    panel.className = 'stream-panel';
    panel.innerHTML = '<h4>' + model + '</h4><div class="stream-content"></div>';
    container.appendChild(panel);
  }
  const content = panel.querySelector('.stream-content');
  if (content) content.textContent += chunk;
}

function renderModerator(content) {
  const dash = document.getElementById('moderator-dashboard');
  if (!dash) return;
  dash.innerHTML = '';
  const sections = content.split(/\n## /);
  sections.forEach(sec => {
    const div = document.createElement('div');
    div.className = 'mod-section';
    const lines = sec.split('\n');
    const title = lines[0].trim();
    const body = lines.slice(1).join('\n');
    div.innerHTML = '<h3>' + title + '</h3><div>' + body.replace(/\n/g, '<br>') + '</div>';
    dash.appendChild(div);
  });
}

function updateTimeline(step) {
  document.querySelectorAll('.timeline-step').forEach((el, i) => {
    el.classList.toggle('active', i <= step);
  });
  const prog = document.getElementById('timeline-progress');
  if (prog) prog.style.width = (step / 4 * 100) + '%';
}

function finishDebate() {
  resetButtons();
  document.getElementById('export-bar').classList.remove('hidden');
  if (window.currentDebateData) saveToHistory(window.currentDebateData);
  showToast('Debate complete!', 'success');
}

function resetButtons() {
  document.getElementById('btn-start').classList.remove('hidden');
  document.getElementById('btn-cancel').classList.add('hidden');
  document.getElementById('btn-pause').classList.add('hidden');
}

function cancelDebate() { showToast('Cancelled', 'info'); resetButtons(); }
function pauseDebate() { showToast('Pause not supported yet', 'info'); }
function restartDebate() { location.reload(); }

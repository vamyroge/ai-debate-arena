let savedApiKey = '';
window.currentDebateData = null;

const ROUND_LABELS = {
  1: 'Independent Analysis',
  2: 'Cross Review',
  3: 'Deep Analysis',
  4: 'Adversarial Debate',
  5: 'Final Reasoning'
};

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
  const checkboxes = document.querySelectorAll('.model-checkboxes input:checked');
  const models = Array.from(checkboxes).map(c => c.value);
  if (models.length === 0) { showToast('Select at least one AI model', 'error'); return; }

  document.getElementById('demo-section').classList.add('hidden');
  document.getElementById('debate-section').classList.remove('hidden');
  document.getElementById('btn-start').classList.add('hidden');
  document.getElementById('btn-cancel').classList.remove('hidden');
  document.getElementById('export-bar').classList.add('hidden');

  window.currentDebateData = { question, rounds, intensity, models, results: {}, synthesis: '' };

  const agentCards = document.getElementById('agent-cards');
  agentCards.innerHTML = '';
  agentCards.classList.remove('hidden');
  const modelInfo = {
    'qwen/qwen3.5-plus:free': { name: 'Qwen', role: 'LOGICAL ANALYST', color: 'var(--qwen)' },
    'minimax/minimax-m3:free': { name: 'MiniMax', role: 'STRATEGIC THINKER', color: 'var(--minimax)' },
    'mistralai/mistral-large-2512': { name: 'Mistral', role: "DEVIL'S ADVOCATE", color: 'var(--mistral)' },
    'mistralai/devstral-medium': { name: 'Devstral', role: 'INDEPENDENT ANALYST', color: 'var(--devstral)' },
    'deepseek/deepseek-chat-v3-0324:free': { name: 'DeepSeek', role: 'CRITICAL THINKER', color: 'var(--deepseek)' }
  };
  models.forEach(m => {
    const info = modelInfo[m] || { name: m, role: 'AI', color: 'var(--accent)' };
    const card = document.createElement('div');
    card.className = 'agent-card';
    card.id = 'card-' + m.replace(/[^a-zA-Z0-9]/g, '');
    card.innerHTML = `<h4 style="color:${info.color}">${info.name}</h4><p class="role">${info.role}</p><p class="status" id="status-${m.replace(/[^a-zA-Z0-9]/g, '')}">WAITING</p>`;
    agentCards.appendChild(card);
  });

  document.getElementById('rounds-container').innerHTML = '';
  document.getElementById('synthesis-container').classList.add('hidden');
  updateTimeline(0);
  updateProgress(0, rounds);

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

function ensureRoundContainer(round) {
  const container = document.getElementById('rounds-container');
  let rc = document.getElementById('round-' + round + '-container');
  if (!rc) {
    rc = document.createElement('div');
    rc.id = 'round-' + round + '-container';
    rc.className = 'round-container';
    rc.innerHTML = `<h2 class="round-title">Round ${round} — ${ROUND_LABELS[round] || 'Round ' + round}</h2><div id="round-${round}-panels" class="panels-grid"></div>`;
    container.appendChild(rc);
  }
  return rc;
}

function handleSSE(data) {
  switch(data.type) {
    case 'round_start':
      if (data.round === 'synthesis') {
        document.getElementById('synthesis-container').classList.remove('hidden');
        updateTimeline(6);
      } else {
        ensureRoundContainer(data.round);
        updateTimeline(data.round);
      }
      break;
    case 'progress':
      updateProgress(data.percent, data.total);
      break;
    case 'agent_status':
      const sid = 'status-' + data.model.replace(/[^a-zA-Z0-9]/g, '');
      const sel = document.getElementById(sid);
      if (sel) {
        sel.textContent = data.status;
        const card = document.getElementById('card-' + data.model.replace(/[^a-zA-Z0-9]/g, ''));
        if (card) {
          card.classList.remove('thinking', 'completed', 'error');
          if (data.status === 'THINKING') card.classList.add('thinking');
          else if (data.status === 'COMPLETED') card.classList.add('completed');
          else if (data.status === 'FAILED') card.classList.add('error');
        }
      }
      break;
    case 'stream':
      appendStream(data.model, data.chunk, data.round);
      break;
    case 'round_result':
      if (window.currentDebateData) {
        if (!window.currentDebateData.results[data.round]) window.currentDebateData.results[data.round] = {};
        window.currentDebateData.results[data.round][data.model] = data.content;
      }
      break;
    case 'synthesis_result':
      if (window.currentDebateData) window.currentDebateData.synthesis = data.content;
      renderSynthesis(data.content);
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
  if (round === 'synthesis') {
    const dash = document.getElementById('synthesis-dashboard');
    if (!dash) return;
    let panel = document.getElementById('stream-synthesizer');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'stream-synthesizer';
      panel.className = 'stream-panel';
      panel.innerHTML = '<h4>Synthesizer</h4><div class="stream-content"></div>';
      dash.appendChild(panel);
    }
    const content = panel.querySelector('.stream-content');
    if (content) content.textContent += chunk;
    return;
  }

  ensureRoundContainer(round);
  const container = document.getElementById('round-' + round + '-panels');
  if (!container) return;
  const safeId = model.replace(/[^a-zA-Z0-9]/g, '');
  let panel = document.getElementById('stream-' + safeId + '-' + round);
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'stream-' + safeId + '-' + round;
    panel.className = 'stream-panel';
    const modelInfo = {
      'qwen/qwen3.5-plus:free': { name: 'Qwen', color: 'var(--qwen)' },
      'minimax/minimax-m3:free': { name: 'MiniMax', color: 'var(--minimax)' },
      'mistralai/mistral-large-2512': { name: 'Mistral', color: 'var(--mistral)' },
      'mistralai/devstral-medium': { name: 'Devstral', color: 'var(--devstral)' },
      'deepseek/deepseek-chat-v3-0324:free': { name: 'DeepSeek', color: 'var(--deepseek)' }
    };
    const info = modelInfo[model] || { name: model, color: 'var(--accent)' };
    panel.innerHTML = `<h4 style="color:${info.color}">${info.name}</h4><div class="stream-content"></div>`;
    container.appendChild(panel);
  }
  const content = panel.querySelector('.stream-content');
  if (content) content.textContent += chunk;
}

function renderSynthesis(content) {
  const dash = document.getElementById('synthesis-dashboard');
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
    el.classList.toggle('completed', i < step);
  });
  const prog = document.getElementById('timeline-progress');
  if (prog) prog.style.width = (step / 5 * 100) + '%';
}

function updateProgress(percent, totalRounds) {
  const container = document.getElementById('progress-bar-container');
  const fill = document.getElementById('progress-bar-fill');
  const text = document.getElementById('progress-bar-text');
  if (!container || !fill || !text) return;
  container.classList.remove('hidden');
  fill.style.width = percent + '%';
  text.textContent = percent + '%';
}

function finishDebate() {
  resetButtons();
  document.getElementById('export-bar').classList.remove('hidden');
  updateProgress(100, 5);
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
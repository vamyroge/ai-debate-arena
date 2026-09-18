const https = require('https');
const crypto = require('crypto');
const contextManager = require('./contextManager');
const { buildMessages, getRoundLabel } = require('./promptEngine');

const MODEL_INFO = {
  'qwen/qwen3.5-plus:free': { name: 'Qwen', role: 'LOGICAL ANALYST' },
  'minimax/minimax-m3:free': { name: 'MiniMax', role: 'STRATEGIC THINKER' },
  'mistralai/mistral-large-2512': { name: 'Mistral', role: "DEVIL'S ADVOCATE" },
  'mistralai/devstral-medium': { name: 'Devstral', role: 'INDEPENDENT ANALYST' },
  'deepseek/deepseek-chat-v3-0324:free': { name: 'DeepSeek', role: 'CRITICAL THINKER' }
};

const DEFAULT_MODELS = Object.keys(MODEL_INFO);
const TOTAL_ROUNDS = 5;
const MAX_RETRIES = 2;
const REQUEST_TIMEOUT = 120000;

function callAI({ model, messages, stream, onChunk, apiKey }) {
  if (!apiKey) throw new Error('API key is missing. Please enter your API key in Settings.');
  const key = apiKey;

  const body = JSON.stringify({ model, messages, stream: stream || false, max_tokens: 4096 });
  const url = new URL('https://api.xkiro.com/v1/chat/completions');
  const options = {
    hostname: url.hostname,
    port: 443,
    path: url.pathname,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`,
      'Content-Length': Buffer.byteLength(body)
    }
  };

  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const req = https.request(options, (res) => {
      if (res.statusCode !== 200) {
        let errBody = '';
        res.on('data', chunk => errBody += chunk);
        res.on('end', () => {
          console.error(`[XKIRO API ERROR] status=${res.statusCode} model=${model} body=${errBody}`);
          const err = new Error(`API error ${res.statusCode}: ${errBody}`);
          err.statusCode = res.statusCode;
          reject(err);
        });
        return;
      }
      if (stream) {
        let full = '', buf = '';
        res.on('data', (chunk) => {
          buf += chunk.toString();
          const lines = buf.split('\n');
          buf = lines.pop() || '';
          for (const line of lines) {
            const t = line.trim();
            if (!t || !t.startsWith('data: ')) continue;
            const d = t.slice(6);
            if (d === '[DONE]') continue;
            try {
              const p = JSON.parse(d);
              const c = p.choices?.[0]?.delta?.content;
              if (c) { full += c; if (onChunk) onChunk(c); }
            } catch (e) {}
          }
        });
        res.on('end', () => resolve({ content: full, latency: Date.now() - startTime }));
        res.on('error', reject);
      } else {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const p = JSON.parse(data);
            resolve({ content: p.choices?.[0]?.message?.content || '', latency: Date.now() - startTime });
          } catch (e) { reject(new Error(`Parse error: ${e.message}`)); }
        });
        res.on('error', reject);
      }
    });
    req.on('error', reject);
    req.setTimeout(REQUEST_TIMEOUT, () => { req.destroy(); reject(new Error('Timeout')); });
    req.write(body);
    req.end();
  });
}

async function callAIWithRetry(params, retries) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      return await callAI(params);
    } catch (err) {
      lastErr = err;
      if (i < retries) await new Promise(r => setTimeout(r, 1000 * (i + 1)));
    }
  }
  throw lastErr;
}

function sendSSE(res, data) {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

async function runAgentInRound({ sessionId, round, model, question, apiKey, res }) {
  const info = MODEL_INFO[model] || { name: model, role: 'AI' };
  sendSSE(res, { type: 'agent_status', model, round, status: 'THINKING' });

  try {
    const context = round === 1 ? '' : contextManager.getRoundContext(sessionId, round, model);
    const messages = buildMessages(round, question, info.role, context);

    const result = await callAIWithRetry({
      model,
      messages,
      stream: true,
      apiKey,
      onChunk: (chunk) => sendSSE(res, { type: 'stream', model, round, chunk })
    }, MAX_RETRIES);

    contextManager.saveRoundOutput(sessionId, round, model, result.content, 'completed');
    sendSSE(res, { type: 'agent_status', model, round, status: 'COMPLETED' });
    sendSSE(res, { type: 'round_result', round, model, content: result.content, info });
    return { model, content: result.content, status: 'completed' };
  } catch (error) {
    contextManager.saveRoundOutput(sessionId, round, model, `[Error: ${error.message}]`, 'failed');
    sendSSE(res, { type: 'agent_status', model, round, status: 'FAILED' });
    sendSSE(res, { type: 'round_result', round, model, content: `[Error: ${error.message}]`, info, error: true });
    return { model, content: error.message, status: 'failed' };
  }
}

async function runSynthesis({ sessionId, question, models, apiKey, res }) {
  sendSSE(res, { type: 'round_start', round: 'synthesis', label: 'Final Synthesis' });
  const transcript = contextManager.getFullTranscript(sessionId);
  const synthesizerPrompt = require('./synthesizer');
  const synthModel = models[0];

  try {
    const result = await callAIWithRetry({
      model: synthModel,
      messages: [
        { role: 'system', content: synthesizerPrompt },
        { role: 'user', content: `Problem: ${question}\n\nFull debate transcript (5 AIs x 5 Rounds):\n\n${transcript}\n\nProduce the final synthesis report in Vietnamese.` }
      ],
      stream: true,
      apiKey,
      onChunk: (chunk) => sendSSE(res, { type: 'stream', model: 'synthesizer', round: 'synthesis', chunk })
    }, MAX_RETRIES);

    sendSSE(res, { type: 'synthesis_result', content: result.content });
  } catch (error) {
    sendSSE(res, { type: 'synthesis_result', content: `[Synthesis error: ${error.message}]`, error: true });
  }
  sendSSE(res, { type: 'round_end', round: 'synthesis' });
}

async function runDebate({ question, rounds, intensity, models, apiKey, res }) {
  const sessionId = crypto.randomUUID();
  const selectedModels = models && models.length > 0 ? models : DEFAULT_MODELS;
  const totalRounds = Math.min(rounds || TOTAL_ROUNDS, TOTAL_ROUNDS);

  contextManager.createSession(sessionId, question, selectedModels);

  try {
    sendSSE(res, {
      type: 'start',
      question,
      rounds: totalRounds,
      intensity,
      models: selectedModels.map(m => ({ id: m, ...(MODEL_INFO[m] || { name: m, role: 'AI' }) }))
    });

    for (let round = 1; round <= totalRounds; round++) {
      const label = getRoundLabel(round);
      sendSSE(res, { type: 'round_start', round, label });
      sendSSE(res, { type: 'progress', current: round, total: totalRounds, percent: Math.round(((round - 1) / totalRounds) * 100) });

      const agentPromises = selectedModels.map(model =>
        runAgentInRound({ sessionId, round, model, question, apiKey, res })
      );

      await Promise.allSettled(agentPromises);
      sendSSE(res, { type: 'round_end', round });
    }

    sendSSE(res, { type: 'progress', current: totalRounds, total: totalRounds, percent: 100 });
    await runSynthesis({ sessionId, question, models: selectedModels, apiKey, res });

    sendSSE(res, { type: 'complete' });
    res.end();
  } catch (error) {
    console.error('[FATAL]', error);
    sendSSE(res, { type: 'error', message: error.message });
    res.end();
  } finally {
    contextManager.cleanup(sessionId);
  }
}

module.exports = { runDebate, MODEL_INFO, DEFAULT_MODELS };

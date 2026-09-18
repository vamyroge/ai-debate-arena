const https = require('https');
const http = require('http');

const MODEL_INFO = {
  'qwen/qwen3.5-plus:free': { name: 'Qwen', role: 'LOGICAL ANALYST' },
  'minimax/minimax-m3:free': { name: 'MiniMax', role: 'STRATEGIC THINKER' },
  'mistralai/mistral-large-2512': { name: 'Mistral', role: "DEVIL'S ADVOCATE" },
  'mistralai/devstral-medium': { name: 'Devstral', role: 'INDEPENDENT ANALYST' }
};

function getPrompts(intensity) {
  const logicalAnalyst = require('../prompts/logicalAnalyst');
  const strategicThinker = require('../prompts/strategicThinker');
  const devilsAdvocate = require('../prompts/devilsAdvocate');
  const independentAnalyst = require('../prompts/independentAnalyst');
  const moderator = require('../prompts/moderator');
  return { logicalAnalyst, strategicThinker, devilsAdvocate, independentAnalyst, moderator };
}

function getModelPrompt(model, intensity) {
  const prompts = getPrompts(intensity);
  const roleMap = {
    'qwen/qwen3.5-plus:free': prompts.logicalAnalyst,
    'minimax/minimax-m3:free': prompts.strategicThinker,
    'mistralai/mistral-large-2512': prompts.devilsAdvocate,
    'mistralai/devstral-medium': prompts.independentAnalyst
  };
  return roleMap[model] || prompts.logicalAnalyst;
}

async function callAI({ model, messages, stream, onChunk, apiKey: providedKey }) {
  const apiKey = providedKey || process.env.XKIRO_API_KEY;
  if (!apiKey) {
    throw new Error('XKIRO_API_KEY not configured');
  }

  const body = JSON.stringify({
    model,
    messages,
    stream: stream || false,
    max_tokens: 4096
  });

  const url = new URL('https://api.xkiro.com/v1/chat/completions');
  const options = {
    hostname: url.hostname,
    port: 443,
    path: url.pathname,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'Content-Length': Buffer.byteLength(body)
    }
  };

  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const req = https.request(options, (res) => {
      if (res.statusCode !== 200) {
        let errorBody = '';
        res.on('data', chunk => errorBody += chunk);
        res.on('end', () => {
          const err = new Error(`API error ${res.statusCode}: ${errorBody}`);
          err.statusCode = res.statusCode;
          reject(err);
        });
        return;
      }

      if (stream) {
        let fullContent = '';
        let buffer = '';

        res.on('data', (chunk) => {
          buffer += chunk.toString();
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith('data: ')) continue;
            const data = trimmed.slice(6);
            if (data === '[DONE]') continue;

            try {
              const parsed = JSON.parse(data);
              const content = parsed.choices?.[0]?.delta?.content;
              if (content) {
                fullContent += content;
                if (onChunk) onChunk(content);
              }
            } catch (e) {}
          }
        });

        res.on('end', () => {
          const latency = Date.now() - startTime;
          console.log(`[AI] ${model} completed in ${latency}ms`);
          resolve({ content: fullContent, latency });
        });

        res.on('error', reject);
      } else {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices?.[0]?.message?.content || '';
            const latency = Date.now() - startTime;
            console.log(`[AI] ${model} completed in ${latency}ms`);
            resolve({ content, latency });
          } catch (e) {
            reject(new Error(`Failed to parse response: ${e.message}`));
          }
        });
        res.on('error', reject);
      }
    });

    req.on('error', reject);
    req.setTimeout(120000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
    req.write(body);
    req.end();
  });
}

function sendSSE(res, data) {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

async function runDebate({ question, rounds, intensity, models, apiKey, res }) {
  try {
    sendSSE(res, { type: 'start', question, rounds, intensity, models: models.map(m => ({ id: m, ...MODEL_INFO[m] })) });

    const round1Results = {};
    sendSSE(res, { type: 'round_start', round: 1, label: 'Independent Analysis' });

    const round1Promises = models.map(async (model) => {
      const info = MODEL_INFO[model];
      sendSSE(res, { type: 'agent_status', model, status: 'THINKING' });

      try {
        const systemPrompt = getModelPrompt(model, intensity);
        const result = await callAI({
          model,
          apiKey,
          stream: true,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: `Analyze the following problem independently:\n\n${question}` }
          ],
          onChunk: (chunk) => {
            sendSSE(res, { type: 'stream', model, round: 1, chunk });
          }
        });

        round1Results[model] = result.content;
        sendSSE(res, { type: 'agent_status', model, status: 'COMPLETED', round: 1 });
        sendSSE(res, { type: 'round1_result', model, content: result.content, info });
      } catch (error) {
        console.error(`[ERROR] ${model}:`, error.message);
        round1Results[model] = `[Error: ${error.message}]`;
        sendSSE(res, { type: 'agent_status', model, status: 'ERROR', error: error.message });
        sendSSE(res, { type: 'round1_result', model, content: `[Error: ${error.message}]`, info, error: true });
      }
    });

    await Promise.all(round1Promises);
    sendSSE(res, { type: 'round_end', round: 1 });

    if (rounds >= 2) {
      const round2Results = {};
      sendSSE(res, { type: 'round_start', round: 2, label: 'Cross Examination' });

      const round2Promises = models.map(async (model) => {
        const info = MODEL_INFO[model];
        sendSSE(res, { type: 'agent_status', model, status: 'THINKING' });

        try {
          const otherResults = Object.entries(round1Results)
            .filter(([m]) => m !== model)
            .map(([m, content]) => `${MODEL_INFO[m].name} (${MODEL_INFO[m].role}): ${content}`)
            .join('\n\n---\n\n');

          const systemPrompt = getModelPrompt(model, intensity);
          const result = await callAI({
            model,
            apiKey,
            stream: true,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: `Original problem: ${question}\n\nHere are the analyses from other AI panelists:\n\n${otherResults}\n\nRead the analyses above. Critique weak arguments, point out valid points, revise your own position if needed, and add new perspectives.` }
            ],
            onChunk: (chunk) => {
              sendSSE(res, { type: 'stream', model, round: 2, chunk });
            }
          });

          round2Results[model] = result.content;
          sendSSE(res, { type: 'agent_status', model, status: 'COMPLETED', round: 2 });
          sendSSE(res, { type: 'round2_result', model, content: result.content, info });
        } catch (error) {
          console.error(`[ERROR] ${model} R2:`, error.message);
          round2Results[model] = `[Error: ${error.message}]`;
          sendSSE(res, { type: 'agent_status', model, status: 'ERROR', error: error.message });
          sendSSE(res, { type: 'round2_result', model, content: `[Error: ${error.message}]`, info, error: true });
        }
      });

      await Promise.all(round2Promises);
      sendSSE(res, { type: 'round_end', round: 2 });

      if (rounds >= 3) {
        const round3Results = {};
        sendSSE(res, { type: 'round_start', round: 3, label: 'Final Positions' });

        const round3Promises = models.map(async (model) => {
          const info = MODEL_INFO[model];
          sendSSE(res, { type: 'agent_status', model, status: 'THINKING' });

          try {
            const systemPrompt = getModelPrompt(model, intensity);
            const result = await callAI({
              model,
              apiKey,
              stream: true,
              messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: `Based on the entire debate about "${question}", provide your final structured position:\n\n1. **Position**: Your clear stance\n2. **Strongest argument**: Your best point\n3. **Weakest argument**: Where your position is most vulnerable\n4. **What could change my conclusion**: Conditions that would flip your view\n5. **Remaining uncertainty**: What you're still unsure about\n\nBe concise and precise.` }
              ],
              onChunk: (chunk) => {
                sendSSE(res, { type: 'stream', model, round: 3, chunk });
              }
            });

            round3Results[model] = result.content;
            sendSSE(res, { type: 'agent_status', model, status: 'COMPLETED', round: 3 });
            sendSSE(res, { type: 'round3_result', model, content: result.content, info });
          } catch (error) {
            console.error(`[ERROR] ${model} R3:`, error.message);
            round3Results[model] = `[Error: ${error.message}]`;
            sendSSE(res, { type: 'agent_status', model, status: 'ERROR', error: error.message });
            sendSSE(res, { type: 'round3_result', model, content: `[Error: ${error.message}]`, info, error: true });
          }
        });

        await Promise.all(round3Promises);
        sendSSE(res, { type: 'round_end', round: 3 });
      }
    }

    sendSSE(res, { type: 'round_start', round: 'moderator', label: 'Moderator Synthesis' });

    try {
      const allRound1 = Object.entries(round1Results).map(([m, c]) => `${MODEL_INFO[m].name} (${MODEL_INFO[m].role}):\n${c}`).join('\n\n===\n\n');
      const allRound2 = rounds >= 2 ? Object.entries(round1Results).map(([m]) => {
        return '';
      }).join('') : '';

      let debateTranscript = `ROUND 1 - INDEPENDENT ANALYSIS:\n\n${allRound1}`;

      const moderatorPrompt = require('../prompts/moderator');
      const moderatorModel = models[0] || 'qwen/qwen3.5-plus:free';

      const modResult = await callAI({
        model: moderatorModel, apiKey, stream: true,
        messages: [
          { role: 'system', content: moderatorPrompt },
          { role: 'user', content: `Problem: ${question}\n\nFull debate transcript:\n\n${debateTranscript}\n\nProvide a comprehensive moderator synthesis. Do NOT vote or declare a winner. Structure your response with these sections:\n\n## EXECUTIVE SUMMARY\n## KEY FACTS\n## KEY ASSUMPTIONS\n## MAIN ARGUMENTS\n## POINTS OF AGREEMENT\n## POINTS OF DISAGREEMENT\n## UNCERTAINTIES\n## WHAT WOULD CHANGE THE ANALYSIS\n## QUESTIONS TO INVESTIGATE` }
        ],
        onChunk: (chunk) => {
          sendSSE(res, { type: 'stream', model: 'moderator', round: 'moderator', chunk });
        }
      });

      sendSSE(res, { type: 'moderator_result', content: modResult.content });
    } catch (error) {
      console.error('[ERROR] Moderator:', error.message);
      sendSSE(res, { type: 'moderator_result', content: `[Moderator error: ${error.message}]`, error: true });
    }

    sendSSE(res, { type: 'round_end', round: 'moderator' });
    sendSSE(res, { type: 'complete' });
    res.end();

  } catch (error) {
    console.error('[FATAL]', error);
    sendSSE(res, { type: 'error', message: error.message });
    res.end();
  }
}

module.exports = { runDebate, MODEL_INFO };

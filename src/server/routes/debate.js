const express = require('express');
const router = express.Router();
const debateService = require('../services/debateService');

router.post('/api-key', (req, res) => {
  const { key } = req.body;
  if (!key || typeof key !== 'string') {
    return res.status(400).json({ error: 'API key is required' });
  }
  res.json({ status: 'ok' });
});

router.get('/api-key/status', (req, res) => {
  res.json({ configured: false });
});

router.post('/debate', async (req, res) => {
  try {
    const { question, rounds, intensity, models, apiKey } = req.body;
    if (!apiKey) {
      return res.status(400).json({ error: 'API key not configured. Enter your XKIRO_API_KEY in Settings.' });
    }
    const effectiveKey = apiKey;

    if (!question || typeof question !== 'string' || question.trim().length === 0) {
      return res.status(400).json({ error: 'Question is required' });
    }

    if (question.length > 2000) {
      return res.status(400).json({ error: 'Question too long (max 2000 chars)' });
    }

    const numRounds = Math.min(Math.max(parseInt(rounds) || 5, 1), 5);

    const validIntensities = ['normal', 'deep', 'extreme'];
    const debateIntensity = validIntensities.includes(intensity) ? intensity : 'normal';

    const availableModels = debateService.DEFAULT_MODELS;

    let selectedModels = availableModels;
    if (Array.isArray(models) && models.length > 0) {
      selectedModels = models.filter(m => availableModels.includes(m));
      if (selectedModels.length === 0) {
        selectedModels = availableModels;
      }
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    await debateService.runDebate({
      question: question.trim(),
      rounds: numRounds,
      intensity: debateIntensity,
      models: selectedModels,
      apiKey: effectiveKey,
      res
    });

  } catch (error) {
    console.error('Debate error:', error.message);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' });
    } else {
      res.write(`data: ${JSON.stringify({ type: 'error', message: error.message })}\n\n`);
      res.end();
    }
  }
});

router.post('/debate/cancel', (req, res) => {
  res.json({ status: 'cancel_requested' });
});

module.exports = router;

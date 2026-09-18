const MAX_CONTEXT_CHARS = 12000;

class ContextManager {
  constructor() {
    this.sessions = new Map();
  }

  createSession(sessionId, question, models) {
    const session = {
      id: sessionId,
      question,
      models,
      rounds: {},
      metadata: {
        createdAt: Date.now(),
        totalRounds: 5
      }
    };
    this.sessions.set(sessionId, session);
    return session;
  }

  getSession(sessionId) {
    return this.sessions.get(sessionId);
  }

  saveRoundOutput(sessionId, round, model, output, status) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    if (!session.rounds[round]) {
      session.rounds[round] = {};
    }
    session.rounds[round][model] = {
      output,
      status: status || 'completed',
      timestamp: Date.now(),
      model,
      round
    };
  }

  getRoundContext(sessionId, targetRound, excludeModel) {
    const session = this.sessions.get(sessionId);
    if (!session) return '';
    const parts = [];
    for (let r = 1; r < targetRound; r++) {
      const roundData = session.rounds[r];
      if (!roundData) continue;
      const roundParts = [];
      Object.entries(roundData).forEach(([model, data]) => {
        if (model === excludeModel) return;
        if (data.status === 'failed') return;
        roundParts.push(`[${data.model}]: ${this.compress(data.output)}`);
      });
      if (roundParts.length > 0) {
        parts.push(`=== ROUND ${r} ===\n${roundParts.join('\n\n---\n\n')}`);
      }
    }
    const context = parts.join('\n\n');
    if (context.length > MAX_CONTEXT_CHARS) {
      return this.truncate(context, MAX_CONTEXT_CHARS);
    }
    return context;
  }

  getAllOutputs(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return {};
    return session.rounds;
  }

  getFullTranscript(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return '';
    const parts = [];
    for (let r = 1; r <= 5; r++) {
      const roundData = session.rounds[r];
      if (!roundData) continue;
      const entries = Object.entries(roundData)
        .filter(([, d]) => d.status !== 'failed')
        .map(([model, d]) => `[${d.model}]: ${d.output}`)
        .join('\n\n---\n\n');
      if (entries) {
        parts.push(`ROUND ${r}:\n${entries}`);
      }
    }
    return parts.join('\n\n================\n\n');
  }

  compress(text) {
    if (!text) return '';
    if (text.length <= 2000) return text;
    return text.substring(0, 1900) + '\n...[truncated]';
  }

  truncate(text, maxChars) {
    if (text.length <= maxChars) return text;
    return text.substring(0, maxChars - 100) + '\n\n...[context compressed]';
  }

  cleanup(sessionId) {
    this.sessions.delete(sessionId);
  }
}

module.exports = new ContextManager();

</content>
const ROUND_CONFIG = {
  1: {
    label: 'Independent Analysis',
    buildUserPrompt: (question) => `Analyze the following problem independently. Do NOT reference or assume any other analyst's input.

Problem: ${question}

Structure your response as:
1. Key variables and their relationships
2. Hidden assumptions identified
3. Your hypothesis and proposed solution
4. Evidence and reasoning
5. Points of uncertainty`
  },
  2: {
    label: 'Cross Review',
    buildUserPrompt: (question, context) => `Original problem: ${question}

Here are the independent analyses from all AI panelists in Round 1:

${context}

Your task:
- Critique weak arguments from other analysts
- Identify logical flaws and hidden assumptions in their reasoning
- Point out valid points you agree with
- Add new perspectives they missed
- Revise your own position if their arguments are stronger
- Do NOT simply agree because others seem confident`
  },
  3: {
    label: 'Deep Analysis',
    buildUserPrompt: (question, context) => `Original problem: ${question}

Full debate history from Rounds 1-2:

${context}

Your task:
- Deep-dive into the core issues raised across both rounds
- Compare and contrast different approaches
- Identify contradictions between analysts
- Test feasibility of each proposed solution
- Propose improved solutions that address weaknesses found
- Be specific about what evidence supports each position`
  },
  4: {
    label: 'Adversarial Debate',
    buildUserPrompt: (question, context) => `Original problem: ${question}

Full debate history from Rounds 1-3:

${context}

You are now in ADVERSARIAL mode. Your job is to be the strongest possible critic:
- Find failure cases for every conclusion presented
- Challenge ALL positions aggressively, including your own previous ones
- Identify risks and edge cases others missed
- Stress-test logic under extreme conditions
- Propose how each argument could be broken
- Do NOT agree just because a majority agrees. If 4 AIs say X, your job is to find why X might be wrong.
- Suggest concrete fixes for each weakness found`
  },
  5: {
    label: 'Final Reasoning',
    buildUserPrompt: (question, context) => `Original problem: ${question}

Complete debate history from all 4 previous rounds:

${context}

This is the FINAL round. Synthesize everything into your definitive position:

1. **Conclusion**: Your final clear stance
2. **Strongest reasoning**: The best argument supporting your conclusion
3. **Evidence basis**: What facts/data support this
4. **Trade-offs acknowledged**: What you're sacrificing with this position
5. **Risks**: Remaining dangers or failure modes
6. **Confidence level**: How certain are you (0-100%) and why
7. **Final recommendation**: Concrete actionable proposal

Be precise. No hedging. Take a position and defend it honestly.`
  }
};

function getSystemPrompt(role) {
  const prompts = {
    'LOGICAL ANALYST': require('../prompts/logicalAnalyst'),
    'STRATEGIC THINKER': require('../prompts/strategicThinker'),
    "DEVIL'S ADVOCATE": require('../prompts/devilsAdvocate'),
    'INDEPENDENT ANALYST': require('../prompts/independentAnalyst'),
    'CRITICAL THINKER': require('../prompts/criticalThinker')
  };
  return prompts[role] || prompts['LOGICAL ANALYST'];
}

function buildMessages(round, question, role, context) {
  const config = ROUND_CONFIG[round];
  if (!config) throw new Error(`Invalid round: ${round}`);
  const systemPrompt = getSystemPrompt(role);
  const userPrompt = round === 1
    ? config.buildUserPrompt(question)
    : config.buildUserPrompt(question, context);
  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ];
}

function getRoundLabel(round) {
  return ROUND_CONFIG[round]?.label || `Round ${round}`;
}

module.exports = { buildMessages, getRoundLabel, ROUND_CONFIG };

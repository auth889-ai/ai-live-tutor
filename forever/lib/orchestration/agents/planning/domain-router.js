// Domain Router — classifies the subject so the Teacher can teach it as a SPECIALIST.
// Fast (qwen3.6-flash), one focused job. Falls back to 'general' on any doubt.

import { z } from 'zod';

import { callQwenJson } from '../../../qwen/client.js';
import { DOMAINS } from './domain-teaching.js';

export async function routeDomain({ sourcePack }) {
  const sample = sourcePack.chunks.map((c) => c.text).join(' ').slice(0, 2000);
  const system = `Classify the subject of this learning material into EXACTLY one domain.
Domains: ${DOMAINS.join(', ')}.
- dsa: data structures & algorithms (trees, graphs, sorting, DP, complexity)
- programming: general coding/languages/APIs (not algorithm-focused)
- ml_ai: machine learning, deep learning, AI, data science
- math: pure math (algebra, calculus, linear algebra, probability, proofs)
- science: physics, chemistry, biology
- systems_swe: software architecture, databases, networking, OS, system design
- history_humanities: history, law, literature, social science
- business_finance: economics, business, finance, accounting
- general: anything else
Output ONLY JSON: {"domain": "<one domain>"}`;

  const { json, usage } = await callQwenJson({
    schema: z.object({ domain: z.string() }),
    agent: 'domain_router',
    system,
    user: sample,
    model: process.env.MODEL_FAST || 'qwen3.6-flash',
    temperature: 0,
    maxTokens: 50,
  });
  const domain = DOMAINS.includes(json.domain) ? json.domain : 'general';
  return { domain, usage };
}

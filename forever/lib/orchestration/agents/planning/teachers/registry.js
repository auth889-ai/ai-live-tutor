// Teacher registry (one job): route a classified domain to ITS specialist teacher agent.
// 14 named course teachers + the coding instructor + the universal teacher — the user's
// one-teacher-per-course design, physically one file per teacher.

import * as architecture from './architecture-teacher.js';
import * as networking from './networking-teacher.js';
import * as srs from './srs-teacher.js';
import * as sqa from './sqa-teacher.js';
import * as osArch from './os-teacher.js';
import * as math from './math-teacher.js';
import * as physics from './physics-teacher.js';
import * as chemistry from './chemistry-teacher.js';
import * as biology from './biology-teacher.js';
import * as mlAi from './ml-teacher.js';
import * as agentsRag from './agents-rag-teacher.js';
import * as history from './history-teacher.js';
import * as law from './law-teacher.js';
import * as economics from './econ-teacher.js';
import * as universal from './universal-teacher.js';

const TEACHERS = new Map([
  ['architecture', architecture], ['networking', networking], ['srs', srs], ['sqa', sqa],
  ['os_arch', osArch], ['math', math], ['physics', physics], ['chemistry', chemistry],
  ['biology', biology], ['ml_ai', mlAi], ['agents_rag', agentsRag], ['history', history],
  ['law', law], ['economics', economics],
]);

export function teacherFor(domain) {
  return TEACHERS.get(domain) ?? universal;
}

export const SPECIALIST_DOMAINS = [...TEACHERS.keys()];

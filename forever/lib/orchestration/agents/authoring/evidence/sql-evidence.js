// SQL EVIDENCE ENGINE — the database course's dry-run equivalent (engine=truth law):
// the AI plan DECLARES {schemaSql, queries}; this module EXECUTES them on real SQLite and
// returns measured facts — result tables, join counts, VM opcode costs, and same-answer
// proofs between schema variants. Boards may only narrate these numbers, never invent them.
//
// World-best pedigree (researched 2026-07-20): CMU 15-445 teaches by build-and-measure on
// a real DBMS; Kimball teaches star-schema trade-offs as measured performance-vs-storage.
// This module gives every Forever student that measurement, per lesson, in their own run —
// server-side via python3 today, browser-side via the same source under Pyodide.

import { execFileSync } from 'node:child_process';

export function buildSqlEvidenceProgram({ schemaSql, queries, samePairs = [] }) {
  const payload = JSON.stringify({ schemaSql, queries, samePairs });
  return [
    'import sqlite3, json, sys',
    `spec = json.loads(${JSON.stringify(payload)})`,
    "db = sqlite3.connect(':memory:')",
    'c = db.cursor()',
    "c.executescript(spec['schemaSql'])",
    'out = {"queries": [], "samePairs": []}',
    "for q in spec['queries']:",
    "    rows = c.execute(q['sql']).fetchall()",
    "    cols = [d[0] for d in (c.description or [])]",
    "    opcodes = len(c.execute('EXPLAIN ' + q['sql']).fetchall())",
    "    joins = (' ' + ' '.join(q['sql'].upper().split())).count(' JOIN ')",
    "    out['queries'].append({'id': q['id'], 'label': q.get('label', q['id']), 'columns': cols,",
    "                           'rows': rows[:30], 'rowCount': len(rows), 'joinCount': joins, 'opcodes': opcodes})",
    "byId = {q['id']: q for q in out['queries']}",
    "for pair in spec['samePairs']:",
    "    a, b = byId.get(pair['a']), byId.get(pair['b'])",
    "    same = bool(a and b and sorted(map(tuple, a['rows'])) == sorted(map(tuple, b['rows'])))",
    "    out['samePairs'].append({'a': pair['a'], 'b': pair['b'], 'sameAnswers': same,",
    "                             'joinReduction': (a['joinCount'] - b['joinCount']) if same else None,",
    "                             'opcodeReduction': (a['opcodes'] - b['opcodes']) if same else None})",
    "print('@@SQLEV ' + json.dumps(out))",
  ].join('\n');
}

export function parseSqlEvidence(stdout) {
  for (const line of String(stdout ?? '').split('\n')) {
    const at = line.indexOf('@@SQLEV ');
    if (at !== -1) {
      try { return JSON.parse(line.slice(at + '@@SQLEV '.length)); } catch { return null; }
    }
  }
  return null;
}

// Server-side runner. In the browser the SAME program string runs under pyodideExec.
export function runSqlEvidence({ schemaSql, queries, samePairs = [] }) {
  const program = buildSqlEvidenceProgram({ schemaSql, queries, samePairs });
  const stdout = execFileSync('python3', ['-c', program], { encoding: 'utf8', timeout: 15000 });
  const parsed = parseSqlEvidence(stdout);
  if (!parsed) throw new Error('sql evidence produced no payload — schema or query failed');
  return parsed;
}

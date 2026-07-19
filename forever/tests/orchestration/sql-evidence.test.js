import assert from 'node:assert/strict';
import test from 'node:test';

import { runSqlEvidence } from '../../lib/orchestration/agents/authoring/evidence/sql-evidence.js';

// The Kid's Shop fixture — the DB course's seeded world. Every number a board shows about
// joins, costs and equivalence must come from THIS kind of measured run.

const SCHEMA = `
CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT, city TEXT);
CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT, category TEXT, price REAL);
CREATE TABLE orders (id INTEGER PRIMARY KEY, cust_id INT, prod_id INT, qty INT, day TEXT);
INSERT INTO customers VALUES (1,'Ayesha','Dhaka'),(2,'Rafi','Chittagong');
INSERT INTO products VALUES (1,'Blocks','Toys',12.5),(2,'Robot Kit','Electronics',49.0);
INSERT INTO orders VALUES (1,1,2,1,'2026-01-03'),(2,2,1,3,'2026-01-04'),(3,1,1,2,'2026-01-05');
CREATE TABLE sales_flat AS
  SELECT o.day, c.name AS cust_name, p.category, p.price*o.qty AS amount
  FROM orders o JOIN customers c ON c.id=o.cust_id JOIN products p ON p.id=o.prod_id;
`;

test('queries execute for real: results, join counts and opcode costs are measured', () => {
  const ev = runSqlEvidence({
    schemaSql: SCHEMA,
    queries: [
      { id: 'norm', label: 'revenue by category (normalized)', sql: 'SELECT p.category, SUM(p.price*o.qty) AS revenue FROM orders o JOIN products p ON p.id=o.prod_id GROUP BY p.category ORDER BY p.category' },
      { id: 'flat', label: 'revenue by category (star/flat)', sql: 'SELECT category, SUM(amount) AS revenue FROM sales_flat GROUP BY category ORDER BY category' },
    ],
    samePairs: [{ a: 'norm', b: 'flat' }],
  });
  const norm = ev.queries.find((q) => q.id === 'norm');
  const flat = ev.queries.find((q) => q.id === 'flat');
  assert.equal(norm.joinCount, 1);
  assert.equal(flat.joinCount, 0);
  assert.deepEqual(norm.rows, [['Electronics', 49], ['Toys', 62.5]]);
  assert.ok(norm.opcodes > flat.opcodes, 'denormalization is measured, not asserted');
  assert.deepEqual(ev.samePairs[0], { a: 'norm', b: 'flat', sameAnswers: true, joinReduction: 1, opcodeReduction: norm.opcodes - flat.opcodes });
});

test('a broken query fails loudly — no silent numbers', () => {
  assert.throws(() => runSqlEvidence({ schemaSql: 'CREATE TABLE t (x INT);', queries: [{ id: 'bad', sql: 'SELECT nope FROM missing' }] }));
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { latencyFloor, packetCount, slowStart, transmissionTime, networkEvidence } from '../../lib/orchestration/agents/authoring/evidence/network-evidence.js';

test('Dhaka->London latency floor matches the material (~80ms RTT over 8000km)', () => {
  const l = latencyFloor({ distanceKm: 8000 });
  assert.equal(l.oneWayMs, 40);   // 8000/200000 s = 0.04s = 40ms
  assert.equal(l.rttMs, 80);
});

test('packet count is ceil(payload/MTU) — 3MB at 1500B = 2000 packets', () => {
  assert.equal(packetCount({ payloadBytes: 3000000, mtuBytes: 1500 }).packets, 2000);
  assert.equal(packetCount({ payloadBytes: 1501, mtuBytes: 1500 }).packets, 2); // one byte over -> 2
});

test('TCP slow-start doubles the window: 1,2,4,8,16', () => {
  assert.deepEqual(slowStart({ rounds: 5 }).windowsPerRound, [1, 2, 4, 8, 16]);
  // with ssthresh it switches to +1 (congestion avoidance)
  assert.deepEqual(slowStart({ rounds: 6, ssthresh: 8 }).windowsPerRound, [1, 2, 4, 8, 9, 10]);
});

test('transmission time = bits / bandwidth', () => {
  // 1500 bytes = 12000 bits at 12 Mbps = 1 ms
  assert.equal(transmissionTime({ bytes: 1500, bandwidthMbps: 12 }).ms, 1);
});

test('evidence rows assembled for a lesson spec', () => {
  const rows = networkEvidence({ latencyFloor: { distanceKm: 8000 }, packetCount: { payloadBytes: 3000000, mtuBytes: 1500 }, slowStart: { rounds: 5 } });
  assert.ok(rows.some((r) => String(r[2]).includes('80 ms')));
  assert.ok(rows.some((r) => String(r[2]).includes('2000 packets')));
});

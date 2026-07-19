// NETWORK TIMING ENGINE — networking's engine=truth, PURE JS (no install). Computes the
// numbers a networking lesson must not fudge: the speed-of-light latency FLOOR, round-trip
// time, transmission time, packet counts, and TCP slow-start congestion windows. So a lesson
// proves "Dhaka->London is at least 80ms RTT" from distance and fiber speed, and shows the
// real 1,2,4,8,... window growth — computed, never narrated.

const C_FIBER_KM_PER_S = 200000; // light in fiber ≈ 2/3 c

// One-way propagation latency floor from distance — pure physics, no protocol beats it.
export function latencyFloor({ distanceKm }) {
  const oneWayMs = (Number(distanceKm) / C_FIBER_KM_PER_S) * 1000;
  return {
    oneWayMs: Math.round(oneWayMs * 1000) / 1000,
    rttMs: Math.round(oneWayMs * 2 * 1000) / 1000,
  };
}

// How many packets a payload splits into (payload and MTU in bytes).
export function packetCount({ payloadBytes, mtuBytes }) {
  const n = Math.ceil(Number(payloadBytes) / Number(mtuBytes));
  return { packets: n, payloadBytes: Number(payloadBytes), mtuBytes: Number(mtuBytes) };
}

// Transmission time to push bytes onto a link of a given bandwidth (Mbps).
export function transmissionTime({ bytes, bandwidthMbps }) {
  const bits = Number(bytes) * 8;
  const bps = Number(bandwidthMbps) * 1e6;
  return { ms: Math.round((bits / bps) * 1000 * 1000) / 1000 };
}

// TCP slow-start: window doubles each RTT until it hits ssthresh, then +1 (congestion avoidance).
export function slowStart({ rounds, ssthresh = Infinity }) {
  const window = [];
  let cwnd = 1;
  for (let i = 0; i < Number(rounds); i += 1) {
    window.push(cwnd);
    cwnd = cwnd < ssthresh ? cwnd * 2 : cwnd + 1;
  }
  return { windowsPerRound: window }; // e.g. [1,2,4,8,16,...]
}

export function networkEvidence(spec) {
  const rows = [];
  if (spec.latencyFloor) {
    const l = latencyFloor(spec.latencyFloor);
    rows.push([`Speed-of-light RTT floor over ${spec.latencyFloor.distanceKm} km fiber`, 'distance / (2/3 c) x 2', `${l.rttMs} ms`]);
  }
  if (spec.packetCount) {
    const p = packetCount(spec.packetCount);
    rows.push([`Packets for a ${p.payloadBytes}-byte payload at ${p.mtuBytes}-byte MTU`, 'ceil(payload / MTU)', `${p.packets} packets`]);
  }
  if (spec.transmissionTime) {
    const t = transmissionTime(spec.transmissionTime);
    rows.push([`Transmission time for ${spec.transmissionTime.bytes} bytes at ${spec.transmissionTime.bandwidthMbps} Mbps`, 'bits / bandwidth', `${t.ms} ms`]);
  }
  if (spec.slowStart) {
    const s = slowStart(spec.slowStart);
    rows.push([`TCP slow-start window per RTT`, 'cwnd doubles until ssthresh', s.windowsPerRound.join(', ')]);
  }
  return rows;
}

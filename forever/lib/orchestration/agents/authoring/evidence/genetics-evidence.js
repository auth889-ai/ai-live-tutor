// GENETICS ENGINE — biology's engine=truth for inheritance, PURE JS (no install). Computes a
// Punnett cross (genotype + phenotype ratios) and Hardy-Weinberg frequencies exactly, so a
// biology lesson proves "Tt x Tt gives 3:1" and "p^2:2pq:q^2" by RUNNING the cross, never
// asserting it. Deterministic; the ratios are counted, not claimed.
//
// Contract:
//   punnett: { parent1: "Tt", parent2: "Tt", dominant: "T" }   (single-gene monohybrid)
//   hardyWeinberg: { p: 0.6 }   (freq of one allele; q = 1 - p)

// Split a genotype string like "Tt" or "BB" into its two alleles.
function alleles(genotype) {
  const g = String(genotype).trim();
  if (g.length !== 2) throw new Error(`genotype must be two alleles, got "${genotype}"`);
  return [g[0], g[1]];
}

export function punnettCross({ parent1, parent2, dominant }) {
  const a1 = alleles(parent1);
  const a2 = alleles(parent2);
  const dom = String(dominant);
  const genotypes = {};
  // 4 equally-likely offspring: each parent contributes one allele
  for (const x of a1) {
    for (const y of a2) {
      const g = [x, y].sort((p, q) => (p === dom ? -1 : q === dom ? 1 : p.localeCompare(q))).join('');
      genotypes[g] = (genotypes[g] ?? 0) + 1;
    }
  }
  // phenotype: dominant shows if at least one dominant allele present
  const phen = { dominant: 0, recessive: 0 };
  for (const [g, n] of Object.entries(genotypes)) {
    if (g.includes(dom)) phen.dominant += n; else phen.recessive += n;
  }
  const gcd = (a, b) => (b ? gcd(b, a % b) : a);
  const ratio = (obj) => {
    const vals = Object.values(obj).filter((v) => v > 0);
    const g = vals.reduce((a, b) => gcd(a, b));
    return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, v / g]));
  };
  return {
    genotypeCounts: genotypes,           // e.g. { TT:1, Tt:2, tt:1 }
    genotypeRatio: ratio(genotypes),
    phenotypeCounts: phen,               // { dominant:3, recessive:1 }
    phenotypeRatio: ratio(phen),         // { dominant:3, recessive:1 }
  };
}

export function hardyWeinberg({ p }) {
  const pp = Number(p);
  if (!(pp >= 0 && pp <= 1)) throw new Error('p must be a frequency in [0,1]');
  const q = 1 - pp;
  const r = (x) => Math.round(x * 1e6) / 1e6;
  return {
    p: r(pp), q: r(q),
    homozygousDominant: r(pp * pp),   // p^2
    heterozygous: r(2 * pp * q),      // 2pq
    homozygousRecessive: r(q * q),    // q^2
    sum: r(pp * pp + 2 * pp * q + q * q), // must be 1 — built-in check
  };
}

// Build citable evidence rows for a biology lesson.
export function geneticsEvidence(spec) {
  const rows = [];
  if (spec.punnett) {
    const c = punnettCross(spec.punnett);
    rows.push([`Genotype ratio of ${spec.punnett.parent1} x ${spec.punnett.parent2}`, 'Punnett cross', Object.entries(c.genotypeRatio).map(([k, v]) => `${v} ${k}`).join(' : ')]);
    rows.push([`Phenotype ratio (dominant ${spec.punnett.dominant})`, 'Punnett cross', `${c.phenotypeRatio.dominant} dominant : ${c.phenotypeRatio.recessive} recessive`]);
  }
  if (spec.hardyWeinberg) {
    const h = hardyWeinberg(spec.hardyWeinberg);
    rows.push([`Hardy-Weinberg genotype frequencies (p=${h.p})`, 'p^2 : 2pq : q^2', `${h.homozygousDominant} : ${h.heterozygous} : ${h.homozygousRecessive}`]);
  }
  return rows;
}

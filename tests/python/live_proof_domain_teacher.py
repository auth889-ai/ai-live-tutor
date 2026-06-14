"""
tests/python/live_proof_domain_teacher.py
===============================================================================
LIVE PROOF — calls real Gemini API and shows exactly what the AI returns.

Runs:
  1. DomainRouterAgent  — what domain does AI detect?
  2. Specialist teacher — what LessonDesignContract does AI produce?

Output saved to:
  agent_output/live_proof_domain_router.json
  agent_output/live_proof_lesson_design_contract.json
  agent_output/live_proof_domain_teacher.md   ← human-readable

Usage:
  conda activate live-tutor-adk
  python tests/python/live_proof_domain_teacher.py
===============================================================================
"""

import asyncio
import json
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent.parent
sys.path.insert(0, str(ROOT))

OUTPUT_DIR = ROOT / "agent_output"


def _load_real_payload() -> dict:
    """Build a real payload from saved proof files."""
    vision_path = OUTPUT_DIR / "stage2_step3_vision_proof.json"
    preview_path = OUTPUT_DIR / "backend_preview.json"

    if not vision_path.exists():
        raise FileNotFoundError("Run step 3 first: stage2_step3_vision_proof.json missing")

    vision = json.loads(vision_path.read_text())
    vision_index = vision.get("visionIndex") or []

    # Build evidence chunks from real sourceRefs quotes in backend_preview
    evidence = []
    if preview_path.exists():
        preview = json.loads(preview_path.read_text())
        seen = set()
        for ref in (preview.get("sourceRefs") or []):
            quote = ref.get("quote") or ""
            page  = ref.get("page") or 1
            if quote and quote not in seen:
                seen.add(quote)
                evidence.append({
                    "chunkId":     f"chunk_p{page}_{len(evidence)}",
                    "page":        page,
                    "text":        quote,
                    "textPreview": quote,
                    "sourceRef":   f"page {page}",
                })

    if not evidence:
        raise RuntimeError("No evidence found — backend_preview.json has no sourceRefs")

    return {
        "selectedNode":    {"title": "Database Schema Changes", "nodeId": "node_test_live"},
        "studentLevel":    "beginner",
        "visionIndex":     vision_index,
        "pageImages":      [],
        "selectedEvidence": evidence,
        "chunks":          evidence,
        "sourceRefs":      [{"page": e["page"], "quote": e["text"]} for e in evidence[:20]],
        "fullPdfSummary":  "A database design course covering normalization, denormalization, schema changes, ERDs, and SQL query patterns.",
        "fullPdfOutline":  "1. Introduction to databases 2. Normalization 3. Denormalization 4. Schema changes 5. ERD diagrams 6. SQL queries",
    }


def _print_section(title: str) -> None:
    width = 72
    print(f"\n{'═' * width}")
    print(f"  {title}")
    print(f"{'═' * width}")


def _print_json_block(label: str, data: dict, indent: int = 2) -> None:
    print(f"\n{label}:")
    print(json.dumps(data, indent=indent, ensure_ascii=False))


async def run_domain_router_live(payload: dict) -> dict:
    from google_agent.planning.domain_router import DomainRouterAgent

    _print_section("STEP 4 — DomainRouterAgent (Gemini Flash LIVE CALL)")
    print(f"  Input: {len(payload['visionIndex'])} vision regions, "
          f"{len(payload['selectedEvidence'])} evidence chunks")
    print(f"  Node:  {payload['selectedNode']['title']}")

    agent = DomainRouterAgent()
    result = await agent.run(payload)

    if not result.ok:
        print(f"\n  ❌ FAILED: {result.errors}")
        raise RuntimeError(f"DomainRouterAgent failed: {result.errors}")

    r = result.result
    print(f"\n  ✅ DOMAIN DETECTED: {r['domain'].upper()}")
    print(f"  Confidence:  {r['confidence']:.0%}")
    print(f"  Reasoning:   {r['reasoning']}")
    print(f"\n  Evidence signals AI used:")
    for s in r.get("signals") or []:
        print(f"    • {s}")

    return r


async def run_domain_teacher_live(payload: dict, domain_route: dict) -> dict:
    from google_agent.planning.teachers import get_teacher

    domain = domain_route["domain"]
    teacher = get_teacher(domain)

    _print_section(f"STEP 5 — {teacher.agent_name} (Gemini Pro + Thinking LIVE CALL)")
    print(f"  Domain:  {domain}")
    print(f"  Teacher: {teacher.agent_name}")
    print(f"  Level:   {payload['studentLevel']}")
    print(f"  Model:   Pro + Thinking mode")
    print(f"  (This call takes 20-60 seconds...)")

    result = await teacher.run({**payload, "domainProfile": domain_route})

    if not result.ok:
        print(f"\n  ❌ FAILED: {result.errors}")
        raise RuntimeError(f"{teacher.agent_name} failed: {result.errors}")

    contract = result.result

    _print_section("LESSON DESIGN CONTRACT — Full AI Output")

    print(f"\n  ScreenCountTarget: {contract.get('screenCountTarget')} screens")
    print(f"  ScreenFamilies:    {contract.get('screenFamilies')}")
    print(f"  DomainTeacher:     {contract.get('domainTeacher')}")

    print(f"\n  HOOK:")
    print(f"    {contract.get('hook','')}")

    objectives = contract.get("learningObjectives") or []
    print(f"\n  LEARNING OBJECTIVES ({len(objectives)}):")
    for i, obj in enumerate(objectives, 1):
        print(f"    {i}. {obj}")

    concepts = contract.get("keyConcepts") or []
    print(f"\n  KEY CONCEPTS ({len(concepts)}):")
    for c in concepts:
        print(f"    • {c}")

    misconceptions = contract.get("misconceptions") or []
    print(f"\n  MISCONCEPTIONS TO FIX ({len(misconceptions)}):")
    for m in misconceptions:
        print(f"    ✗ {m}")

    phases = contract.get("instructionalProcedures") or []
    print(f"\n  INSTRUCTIONAL PHASES ({len(phases)}) with vision region grounding:")
    for i, phase in enumerate(phases, 1):
        region_ids = phase.get("useRegionIds") or []
        screen_types = phase.get("screenTypes") or []
        print(f"\n    Phase {i}: [{phase.get('phase','').upper()}] {phase.get('title','')}")
        print(f"      Duration:    {phase.get('minutes')} min, {phase.get('screenCount')} screens")
        print(f"      Description: {phase.get('description','')[:120]}")
        print(f"      ScreenTypes: {', '.join(screen_types[:5])}")
        if region_ids:
            print(f"      Grounded to: {', '.join(region_ids)}")
        else:
            print(f"      ⚠ NO REGION IDs — not vision-grounded!")

    diff = contract.get("differentiationStrategies") or []
    if diff:
        print(f"\n  DIFFERENTIATION STRATEGIES ({len(diff)}):")
        for s in diff[:3]:
            print(f"    • {s}")

    assessment = contract.get("assessmentPlan") or []
    if assessment:
        print(f"\n  ASSESSMENT PLAN ({len(assessment)}):")
        for a in assessment[:3]:
            print(f"    • {a}")

    return contract


def save_output(domain_route: dict, contract: dict) -> None:
    router_path   = OUTPUT_DIR / "live_proof_domain_router.json"
    contract_path = OUTPUT_DIR / "live_proof_lesson_design_contract.json"

    router_path.write_text(json.dumps(domain_route, indent=2, ensure_ascii=False))
    contract_path.write_text(json.dumps(contract, indent=2, ensure_ascii=False))

    phases = contract.get("instructionalProcedures") or []
    grounded_phases = [p for p in phases if p.get("useRegionIds")]
    total_region_refs = sum(len(p.get("useRegionIds") or []) for p in phases)

    md = f"""# Live Proof — Domain Teacher System
**Date:** 2026-06-13
**Test:** Real Gemini API calls — no mocks

---

## Step 4: DomainRouterAgent (Gemini Flash)

| Field | Value |
|---|---|
| Domain detected | `{domain_route.get('domain')}` |
| Confidence | {domain_route.get('confidence', 0):.0%} |
| Reasoning | {domain_route.get('reasoning', '')[:200]} |

**Evidence signals AI used:**
{chr(10).join(f'- {s}' for s in (domain_route.get('signals') or []))}

---

## Step 5: {contract.get('domainTeacher')} (Gemini Pro + Thinking)

| Field | Value |
|---|---|
| Screen count target | {contract.get('screenCountTarget')} |
| Phases | {len(phases)} |
| Vision-grounded phases | {len(grounded_phases)} / {len(phases)} |
| Total region references | {total_region_refs} |
| Screen families | {', '.join(contract.get('screenFamilies') or [])} |

### Hook
> {contract.get('hook', '')}

### Learning Objectives
{chr(10).join(f'{i+1}. {o}' for i, o in enumerate(contract.get('learningObjectives') or []))}

### Key Concepts
{chr(10).join(f'- {c}' for c in (contract.get('keyConcepts') or []))}

### Misconceptions to fix
{chr(10).join(f'- {m}' for m in (contract.get('misconceptions') or []))}

### Instructional Phases
{chr(10).join(
    f"**Phase {i+1}: [{p.get('phase','').upper()}] {p.get('title','')}**  " + chr(10) +
    f"- Duration: {p.get('minutes')} min, {p.get('screenCount')} screens  " + chr(10) +
    f"- Description: {p.get('description','')[:150]}  " + chr(10) +
    f"- ScreenTypes: {', '.join((p.get('screenTypes') or [])[:5])}  " + chr(10) +
    f"- Vision regions: {', '.join(p.get('useRegionIds') or ['⚠ NONE'])}"
    for i, p in enumerate(phases)
)}

---
*Saved: live_proof_domain_router.json, live_proof_lesson_design_contract.json*
"""
    (OUTPUT_DIR / "live_proof_domain_teacher.md").write_text(md)
    print(f"\n  Saved:")
    print(f"    {router_path}")
    print(f"    {contract_path}")
    print(f"    {OUTPUT_DIR / 'live_proof_domain_teacher.md'}")


async def main() -> None:
    print("\n" + "█" * 72)
    print("  LIVE PROOF — Domain Router + Domain Teacher (REAL GEMINI CALLS)")
    print("█" * 72)

    payload = _load_real_payload()
    print(f"\n  Payload built:")
    print(f"    visionIndex:   {len(payload['visionIndex'])} regions")
    print(f"    evidence:      {len(payload['selectedEvidence'])} chunks")
    print(f"    studentLevel:  {payload['studentLevel']}")

    domain_route = await run_domain_router_live(payload)
    contract     = await run_domain_teacher_live(payload, domain_route)
    save_output(domain_route, contract)

    _print_section("SUMMARY")
    phases = contract.get("instructionalProcedures") or []
    grounded = [p for p in phases if p.get("useRegionIds")]
    print(f"  DomainRouter  → {domain_route['domain']} ({domain_route['confidence']:.0%})")
    print(f"  Teacher       → {contract.get('domainTeacher')}")
    print(f"  Screens       → {contract.get('screenCountTarget')}")
    print(f"  Phases        → {len(phases)}")
    print(f"  Grounded      → {len(grounded)}/{len(phases)} phases have real visionIndex regionIds")
    print(f"  Status        → {'✅ READY for Step 6 (SegmentGenerator)' if grounded else '❌ NOT grounded'}")


if __name__ == "__main__":
    asyncio.run(main())

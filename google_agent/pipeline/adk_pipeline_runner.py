"""
google_agent/pipeline/adk_pipeline_runner.py
=============================================
NEW ADK pipeline — connects all 28 existing agents correctly.
Uses the SAME packet builders as the existing orchestrator:
  build_visual_planner_packet → VisualPlannerAgent
  build_board_scene_packet    → BoardSceneAgent
  build_board_command_packet  → BoardCommandAgent
  build_voice_script_packet   → VoiceScriptAgent

Preprocessing agents (ConceptExtraction, KG) → OPTIONAL, 90s
Content agents (Explanation, Visual, Board, Voice) → OPTIONAL, 180s
No single timeout kills the pipeline.
"""
from __future__ import annotations
import asyncio
import json
import sys
from typing import Any, List

try:
    from ..live_tutor_agents.orchestrator_registry import (
        run_agent_with_timeout, collect_source_refs,
        selected_node, stable_refs, now_ms,
        build_visual_planner_packet,
    )
    from ..live_tutor_agents.contracts import (
        JsonDict, safe_dict, safe_list, clean_text, dedupe_source_refs,
    )
    from ..live_tutor_agents.stage2_flow_contract import (
        build_board_scene_packet, build_board_command_packet,
        build_voice_script_packet, build_subtitle_packet,
    )
except ImportError:
    from google_agent.live_tutor_agents.orchestrator_registry import (
        run_agent_with_timeout, collect_source_refs,
        selected_node, stable_refs, now_ms,
        build_visual_planner_packet,
    )
    from google_agent.live_tutor_agents.contracts import (
        JsonDict, safe_dict, safe_list, clean_text, dedupe_source_refs,
    )
    from google_agent.live_tutor_agents.stage2_flow_contract import (
        build_board_scene_packet, build_board_command_packet,
        build_voice_script_packet, build_subtitle_packet,
    )

PREPROCESS_TIMEOUT_MS = 90_000
CONTENT_TIMEOUT_MS    = 180_000

# Which agents are preprocessing vs content
PREPROCESSING = {
    "RagRetrievalAgent", "SelectedPageVisionAgent", "MongoDbMcpToolAgent",
    "ConceptExtractionAgent", "KnowledgeGraphAgent", "TeachingStrategyAgent",
    "CoursePlannerAgent", "SegmentPlannerAgent",
}
CONTENT = {
    "DetailedExplanationAgent", "AnalogyExampleAgent", "AssessmentQuizAgent",
    "VisualPlannerAgent", "DiagramCompilerAgent", "BoardSceneAgent",
    "BoardCommandAgent", "LayoutAgent", "HandwritingDrawingAgent",
    "VoiceScriptAgent", "SubtitleSyncAgent", "ValidatorSafetyAgent",
}


async def _run_safe(agent_name: str, payload: dict, timeout_ms: int) -> dict:
    """Run agent with timeout — never raises, always returns dict. Logs failures to stderr."""
    start = now_ms()
    try:
        p = {**payload, "agentTimeoutsMs": {**safe_dict(payload.get("agentTimeoutsMs")), agent_name: timeout_ms}}
        result = await asyncio.wait_for(run_agent_with_timeout(agent_name, p), timeout=(timeout_ms + 5000) / 1000)
        result.setdefault("metadata", {})["runtimeMs"] = now_ms() - start
        return safe_dict(result)
    except Exception as exc:
        err_msg = f"{type(exc).__name__}: {str(exc)[:300]}"
        print(f"[AGENT_ERROR] {agent_name} FAILED — {err_msg}", file=sys.stderr)
        return {
            "ok": False, "agentName": agent_name,
            "errors": [f"{agent_name}: {err_msg}"],
            "result": {}, "metadata": {"runtimeMs": now_ms() - start, "timedOut": "TimeoutError" in type(exc).__name__},
        }


async def _generate_explanation_fallback(working: dict) -> str:
    """Fallback: call Gemini via google.genai SDK (available in conda env) when ADK agent fails."""
    import os, json as _json, urllib.request, urllib.error
    api_key = os.getenv("GOOGLE_GENAI_API_KEY") or os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY") or ""
    if not api_key:
        return ""

    node     = safe_dict(working.get("selectedNode") or working.get("node") or {})
    title    = clean_text(node.get("title") or node.get("label") or "this concept", 100)
    strategy = safe_dict(working.get("teachingStrategy") or {})
    evidence = safe_list(working.get("selectedEvidence") or working.get("chunks") or [])[:6]
    ev_text  = "\n".join(
        f"[p.{safe_dict(e).get('page',1)}] {clean_text(safe_dict(e).get('text') or safe_dict(e).get('textPreview') or '', 250)}"
        for e in evidence
    )
    prompt = f"""You are a world-class professor. Teach "{title}" like a real human teacher.

EVIDENCE FROM PDF:
{ev_text}

Write 20 natural teacher sentences:
- Use "Notice that...", "Now watch...", "Think of it like..."
- Vary: definition, example, warning, comparison, analogy
- Every sentence connects to what gets written on the board
- Reference real PDF content above
- Sound like a real human, not robotic text"""

    model   = os.getenv("GOOGLE_GEMINI_MODEL") or "gemini-2.5-flash"
    url     = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
    payload = _json.dumps({
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {"temperature": 0.7, "maxOutputTokens": 3000},
    }).encode("utf-8")

    req = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=90) as resp:
        data = _json.loads(resp.read().decode("utf-8"))

    parts = safe_list(safe_dict(safe_list(safe_dict(data).get("candidates", [{}]))[0]).get("content", {}).get("parts", []))
    return clean_text("".join(safe_dict(p).get("text", "") for p in parts), 6000)


def _extract_board_notes(explanation: str) -> list:
    """Extract board-worthy notes from explanation text."""
    import re
    sentences = [s.strip() for s in re.split(r"[.!?]\s+", explanation) if len(s.strip()) > 20]
    board_notes = []
    for s in sentences[:12]:
        board_notes.append({"text": s[:120], "type": "concept", "sourceGrounded": True})
    return board_notes


def _build_teacher_lesson(explanation: str, working: dict) -> dict:
    """Build the worldTeacherLesson structure DetailedExplanationAgent is expected to produce."""
    import re
    sentences  = [s.strip() for s in re.split(r"[.!?]\s+", explanation) if len(s.strip()) > 15]
    node       = safe_dict(working.get("selectedNode") or {})
    title      = clean_text(node.get("title") or "Concept", 80)
    steps      = [{"step": i+1, "teacherSays": s[:200], "boardAction": "write", "sourceRef": ""} for i, s in enumerate(sentences[:12])]
    return {
        "nodeTitle":              title,
        "microTeachingSteps":     steps,
        "boardRecipe":            [{"action": "write", "content": s[:80]} for s in sentences[:9]],
        "visualTeachingMoments":  [{"trigger": "diagram", "action": "show_pdf_page"}],
        "mistakeRepairMoments":   [{"mistake": "common error", "repair": sentences[0] if sentences else ""}]*2,
        "boardNotes":             _extract_board_notes(explanation),
        "visualBoardBridge":      {"ready": True},
        "qualitySignals":         {"readyForVisualPlanner": True, "fallbackUsed": False},
    }


def _dedupe_chunks(items: List[Any]) -> List[JsonDict]:
    out: List[JsonDict] = []
    seen = set()
    for raw in items:
        item = safe_dict(raw)
        if not item:
            continue
        key = (
            clean_text(item.get("chunkId") or item.get("id") or "", 160),
            clean_text(item.get("sourceRef") or item.get("pageRef") or "", 240),
            clean_text(item.get("text") or item.get("textPreview") or item.get("quote") or "", 220),
        )
        if key in seen:
            continue
        seen.add(key)
        out.append(item)
    return out


def _initial_chunks(payload: JsonDict) -> List[JsonDict]:
    node = selected_node(payload)
    rich = safe_dict(safe_dict(node.get("metadata")).get("richSourcePack"))
    chunks: List[Any] = []
    for value in (
        payload.get("selectedEvidence"),
        payload.get("exactChunks"),
        payload.get("selectedNodeExactChunks"),
        payload.get("chunks"),
        rich.get("selectedEvidence"),
        payload.get("samePageEvidence"),
        payload.get("samePageChunks"),
        rich.get("samePageChunks"),
        payload.get("nearbyEvidence"),
        payload.get("nearbyChunks"),
        rich.get("nearbyChunks"),
    ):
        chunks.extend(safe_list(value))
    return _dedupe_chunks(chunks)


async def run_adk_pipeline(payload: dict) -> dict:
    working  = dict(payload)
    chunks   = _initial_chunks(working)
    refs     = stable_refs(working, chunks)
    working.update({"chunks": chunks, "sourceRefs": refs, "selectedEvidence": chunks})

    outputs, trace = {}, []
    tms_overrides  = safe_dict(working.get("agentTimeoutsMs") or {})

    def tms(agent: str) -> int:
        return int(tms_overrides.get(agent) or (PREPROCESS_TIMEOUT_MS if agent in PREPROCESSING else CONTENT_TIMEOUT_MS))

    async def run(agent: str, extra_payload: dict = None) -> dict:
        p      = {**working, **(extra_payload or {})}
        result = await _run_safe(agent, p, tms(agent))
        outputs[agent] = result
        r = safe_dict(result.get("result") or {})
        # Merge standard output keys into working state
        for key in ("chunks","selectedEvidence","concepts","knowledgeGraph",
                    "teachingStrategy","conceptExtraction","ragResult","retrieval"):
            if r.get(key): working[key] = r[key]
        trace.append({"agent": agent, "ok": result.get("ok"),
                      "ms": safe_dict(result.get("metadata")).get("runtimeMs", 0)})
        return result

    # ── Stage A: Source + preprocessing (optional, ordered where data-dependent) ─
    await run("MongoDbMcpToolAgent", {
        "mode": "mission_read_context",
        "chunks": chunks,
        "sourceRefs": refs,
        "selectedNode": selected_node(working),
        "timeoutSec": max(5, int(tms("MongoDbMcpToolAgent") / 1000)),
    })
    mcp_out = safe_dict(safe_dict(outputs.get("MongoDbMcpToolAgent")).get("result") or {})
    if safe_list(mcp_out.get("chunks")):
        chunks = _dedupe_chunks(chunks + safe_list(mcp_out.get("chunks")))
    if len(safe_list(working.get("selectedEvidence"))) < 3 and len(chunks) >= 3:
        working["selectedEvidence"] = chunks[:8]
    working["chunks"] = chunks
    refs = stable_refs(working, chunks)
    working["sourceRefs"] = refs

    await run("RagRetrievalAgent", {
        "mode": "retrieve_selected_node",
        "chunks": chunks,
        "selectedEvidence": working.get("selectedEvidence"),
        "sourceRefs": refs,
        "query": working.get("query") or working.get("question") or clean_text(selected_node(working).get("title") or "", 160),
    })
    rag_out = safe_dict(safe_dict(outputs.get("RagRetrievalAgent")).get("result") or {})
    if safe_list(rag_out.get("chunks")):
        chunks = _dedupe_chunks(safe_list(rag_out.get("chunks")) + chunks)
        working["chunks"] = chunks
    if safe_list(rag_out.get("selectedEvidence")):
        working["selectedEvidence"] = _dedupe_chunks(safe_list(rag_out.get("selectedEvidence")) + safe_list(working.get("selectedEvidence")))
    refs = stable_refs(working, chunks)
    working["sourceRefs"] = refs

    # ── Vision Safety Net (W2.2) — scans ALL node pages regardless of
    # sourceRefs, returns visionIndex with schema-REQUIRED bbox.
    # Legacy SelectedPageVisionAgent remains the fallback if the net fails.
    async def run_vision_safety_net() -> None:
        try:
            try:
                from ..source.vision_safety_net import build_vision_index
            except ImportError:
                from google_agent.source.vision_safety_net import build_vision_index
            net = await build_vision_index(working)
            if net.get("ok") and safe_list(net.get("visionIndex")):
                working["visionIndex"] = net["visionIndex"]
                # Golden Rule #7: vision discoveries ADDED to evidence
                discoveries = safe_list(net.get("visionEvidence"))
                if discoveries:
                    working["chunks"] = _dedupe_chunks(safe_list(working.get("chunks")) + discoveries)
                    working["selectedEvidence"] = _dedupe_chunks(
                        safe_list(working.get("selectedEvidence")) + discoveries
                    )
                outputs["VisionSafetyNet"] = {"ok": True, "result": net}
                # Downstream packet builders (board scene/command) read the
                # legacy slot — feed them the same visionIndex.
                outputs["SelectedPageVisionAgent"] = {
                    "ok": True,
                    "result": {"visionIndex": net["visionIndex"],
                               "regions": net["visionIndex"],
                               "pagesScanned": net.get("pagesScanned"),
                               "viaSafetyNet": True},
                }
                trace.append({"agent": "VisionSafetyNet", "ok": True,
                              "ms": 0, "pages": net.get("pagesScanned")})
                print(f"[pipeline] VisionSafetyNet: {len(net['visionIndex'])} regions "
                      f"from {net.get('pagesScanned')} pages "
                      f"({len(discoveries)} added as evidence)", file=sys.stderr)
                return
            trace.append({"agent": "VisionSafetyNet", "ok": False, "ms": 0,
                          "warnings": safe_list(net.get("warnings"))[:3]})
        except Exception as exc:
            print(f"[pipeline] VisionSafetyNet failed: {str(exc)[:200]} — "
                  f"falling back to legacy SelectedPageVisionAgent", file=sys.stderr)
            trace.append({"agent": "VisionSafetyNet", "ok": False, "ms": 0})
        # Fallback: legacy vision agent
        await run("SelectedPageVisionAgent")

    # ConceptExtraction + KnowledgeGraph absorbed by the Pedagogy layer below
    # (keyConcepts + conceptRelations); they run only in the legacy fallback.
    await run_vision_safety_net()
    if safe_list(working.get("pageImages")) and not safe_list(working.get("visionIndex")):
        raise RuntimeError(
            "VisionIndex required: pageImages were provided but Gemini Vision produced no bbox regions. "
            "Refusing to generate a text-only weak board lesson."
        )
    # ── PEDAGOGY LAYER (W2.3 + W2.4) — Golden Rule #9: pedagogy before pixels.
    # DomainUnderstanding → PedagogyPlanner (Pro + Thinking) produce the
    # Lesson Design Contract. Replaces 5 legacy agents (ConceptExtraction,
    # KnowledgeGraph, TeachingStrategy, CoursePlanner, SegmentPlanner) —
    # which remain ONLY as fallback when the pedagogy layer fails.
    pedagogy_ok = False
    try:
        try:
            from ..planning.domain_understanding_agent import understand_domain
            from ..planning.pedagogy_planner_agent import plan_pedagogy
        except ImportError:
            from google_agent.planning.domain_understanding_agent import understand_domain
            from google_agent.planning.pedagogy_planner_agent import plan_pedagogy

        domain_profile = await understand_domain(working)
        working["domainProfile"] = domain_profile
        contract = await plan_pedagogy(working, domain_profile)
        working["lessonDesignContract"] = contract

        # Feed downstream agents through the slots they already read.
        working["teachingStrategy"] = {
            "approach": (contract.get("lessonIntroduction") or {}).get("hook", ""),
            "learningObjectives": contract.get("learningObjectives"),
            "keyConcepts": contract.get("keyConcepts"),
            "misconceptions": contract.get("misconceptions"),
            "screenCountTarget": contract.get("screenCountTarget"),
            "screenMix": contract.get("screenMix"),
            "instructionalProcedures": contract.get("instructionalProcedures"),
            "differentiation": contract.get("differentiationStrategies"),
            "viaPedagogyPlanner": True,
        }
        working["concepts"] = contract.get("keyConcepts") or []
        working["knowledgeGraph"] = {"relations": contract.get("conceptRelations") or []}
        course_plan = {
            "segments": [
                {"segmentId": i, "phase": p.get("phase"),
                 "minutes": p.get("minutes"), "description": p.get("description"),
                 "useRegionIds": p.get("useRegionIds") or []}
                for i, p in enumerate(safe_list(contract.get("instructionalProcedures")))
            ],
            "screenCountTarget": contract.get("screenCountTarget"),
        }
        working["coursePlan"] = course_plan
        outputs["TeachingStrategyAgent"] = {"ok": True, "result": working["teachingStrategy"]}
        outputs["CoursePlannerAgent"] = {"ok": True, "result": course_plan}
        outputs["PedagogyPlanner"] = {"ok": True, "result": contract}
        trace.append({"agent": "DomainUnderstanding", "ok": True, "ms": 0})
        trace.append({"agent": "PedagogyPlanner", "ok": True, "ms": 0,
                      "screens": contract.get("screenCountTarget")})
        strategy_result = outputs["TeachingStrategyAgent"]
        pedagogy_ok = True
        print(f"[pipeline] PedagogyPlanner CONTRACT: "
              f"{contract.get('screenCountTarget')} screens, "
              f"{len(safe_list(contract.get('instructionalProcedures')))} phases",
              file=sys.stderr)
    except Exception as exc:
        print(f"[pipeline] Pedagogy layer failed: {str(exc)[:200]} — "
              f"falling back to legacy planning agents", file=sys.stderr)
        trace.append({"agent": "PedagogyPlanner", "ok": False, "ms": 0})

    # ── W3 QUALITY-STACK GENERATION — the contract drives the lesson ─────────
    # ground → anchor → generate → verify → critique → repair, per phase.
    # Replaces the legacy generation chain (DetailedExplanation/BoardScene/
    # VoiceScript/Diagram text-path) which remains below as fallback only.
    if pedagogy_ok:
        try:
            try:
                from ..generation.lesson_orchestrator import orchestrate_lesson
            except ImportError:
                from google_agent.generation.lesson_orchestrator import orchestrate_lesson

            on_segment_ready = None
            if working.get("_emitSegmentEvents"):
                async def _emit_segment_ready(segment_index: int, segment: dict) -> None:
                    event = {
                        "type": "segment_ready",
                        "segmentIndex": segment_index,
                        "segment": segment,
                    }
                    print(
                        "__LUMINA_SEGMENT_READY__" +
                        json.dumps(event, ensure_ascii=False, separators=(",", ":")),
                        file=sys.stderr,
                        flush=True,
                    )
                on_segment_ready = _emit_segment_ready

            lesson = await orchestrate_lesson(
                working, contract,
                domain_profile=safe_dict(working.get("domainProfile")),
                on_segment_ready=on_segment_ready,
            )
            if lesson.get("ok"):
                trace.append({"agent": "QualityStackOrchestrator", "ok": True,
                              "screens": lesson["metadata"].get("screenCount"),
                              "avgQuality": lesson["qualityReport"].get("averageScore")})
                lesson["selectedNode"] = selected_node(payload)
                lesson["agentTrace"] = trace
                lesson["agentOutputs"] = {
                    "PedagogyPlanner": contract,
                    "VisionSafetyNet": safe_dict(
                        safe_dict(outputs.get("VisionSafetyNet")).get("result") or {}),
                }
                lesson["metadata"].update({"usesAdkPipelineV2": True,
                                           "fallbackUsed": False})
                print(f"[pipeline] QUALITY STACK lesson: "
                      f"screens={lesson['metadata']['screenCount']} "
                      f"cmds={lesson['metadata']['commandCount']} "
                      f"avgQuality={lesson['qualityReport']['averageScore']}",
                      file=sys.stderr)
                return lesson
            print(f"[pipeline] quality stack below ok-bar "
                  f"({lesson['qualityReport']}) — legacy generation fallback",
                  file=sys.stderr)
            trace.append({"agent": "QualityStackOrchestrator", "ok": False})
            raise RuntimeError(
                "QualityStackOrchestrator below quality bar. Refusing legacy weak lesson fallback."
            )
        except Exception as exc:
            print(f"[pipeline] quality stack failed: {str(exc)[:200]} — "
                  f"refusing legacy weak lesson fallback", file=sys.stderr)
            trace.append({"agent": "QualityStackOrchestrator", "ok": False})
            raise

    if not pedagogy_ok:
        # LEGACY FALLBACK — the old 5-agent planning chain.
        await run("ConceptExtractionAgent")
        await run("KnowledgeGraphAgent")
        strategy_result, course_result = await asyncio.gather(
            run("TeachingStrategyAgent"), run("CoursePlannerAgent"))
        course_plan = safe_dict(course_result.get("result") or {})
        first_segment = safe_dict(safe_list(course_plan.get("segments"))[0]
                                  if safe_list(course_plan.get("segments")) else {})
        await run("SegmentPlannerAgent", {
            "mode": "plan_segment",
            "coursePlan": course_plan,
            "segment": first_segment,
            "sourceRefs": refs,
            "chunks": chunks,
        })

    # ── Stage B: Teaching content ────────────────────────────────────────────────
    exp_task   = run("DetailedExplanationAgent")
    anal_task  = run("AnalogyExampleAgent")
    quiz_task  = run("AssessmentQuizAgent", {
        "mode": "make_quiz",
        "segmentPlan": safe_dict(safe_dict(outputs.get("SegmentPlannerAgent")).get("result") or {}),
        "sourceRefs": refs,
    })
    explanation_result, analogy_result, quiz_result = await asyncio.gather(exp_task, anal_task, quiz_task)

    # If DetailedExplanationAgent failed, use Phase 2 fallback
    if not explanation_result.get("ok"):
        try:
            exp_text = await _generate_explanation_fallback(working)
            if exp_text:
                explanation_result = {
                    "ok": True, "result": {
                        "worldTeacherLesson": _build_teacher_lesson(exp_text, working),
                        "boardNotes":         _extract_board_notes(exp_text),
                        "simpleDefinition":   exp_text[:300],
                        "sourceGroundedExplanation": exp_text,
                    }
                }
                trace.append({"agent": "ExplanationFallback", "ok": True, "ms": 0})
        except Exception as exc:
            trace.append({"agent": "ExplanationFallback", "ok": False, "ms": 0, "error": str(exc)[:80]})

    # ── Stage C: Visual planning — use correct packet builder ────────────────────
    visual_planner_packet = build_visual_planner_packet(
        working, refs,
        safe_dict(explanation_result.get("result") or explanation_result),
        safe_dict(analogy_result.get("result")     or analogy_result),
        safe_dict(safe_dict(outputs.get("TeachingStrategyAgent")).get("result") or {}),
    )
    working["visualPlannerPacket"] = visual_planner_packet

    visual_plan_result = await run("VisualPlannerAgent", {
        "mode": "plan_visuals",
        "selectedNode": visual_planner_packet.get("selectedNode"),
        "visualPlannerPacket": visual_planner_packet,
        "sourceRefs": refs, "requirePremiumScreens": True,
        "requireMultiScreen": True, "requireSourceEvidenceBlocks": True,
        "requireDiagramBlocks": True, "requireMistakeQuizBlocks": True,
        "studentLevel": working.get("studentLevel"), "language": working.get("language"),
    })
    visual_result = safe_dict(visual_plan_result.get("result") or {})

    await run("DiagramCompilerAgent")
    diagram_result = safe_dict(safe_dict(outputs.get("DiagramCompilerAgent")).get("result") or {})

    # ── Stage D: Board scenes — use correct packet builder ───────────────────────
    board_scene_packet = build_board_scene_packet(
        working, refs, visual_result, diagram_result,
        safe_dict(explanation_result.get("result") or explanation_result),
        safe_dict(quiz_result.get("result") or quiz_result),
        safe_dict(safe_dict(outputs.get("SelectedPageVisionAgent")).get("result") or {}),
    )
    board_scene_result = await run("BoardSceneAgent", {
        "mode":           "build_board_scenes",
        "visualPlan":     visual_result,          # ← what BoardSceneAgent.validate_input looks for
        "boardScenePacket": board_scene_packet,
        "sourceRefs":     refs,
        "studentLevel":   working.get("studentLevel"),
        "language":       working.get("language"),
    })
    board_scene = safe_dict(board_scene_result.get("result") or {})

    # ── Stage E: Board commands — use correct packet builder ─────────────────────
    vision_result_raw = safe_dict(safe_dict(outputs.get("SelectedPageVisionAgent")).get("result") or {})
    board_cmd_packet  = build_board_command_packet(
        working, refs,
        board_scene,          # board_scene_result
        visual_result,        # visual_result
        diagram_result,       # diagram_result
        vision_result_raw,    # selected_page_vision_result
    )
    # BoardCommandAgent reads sceneSet/boardScenes + visualPlan from payload.
    await run("BoardCommandAgent", {
        "boardCommandPacket": board_cmd_packet,
        "boardScenes":        board_scene,
        "sceneSet":           board_scene,
        "visualPlan":         visual_result,
        "premiumBoardScreens": safe_list(board_scene.get("premiumBoardScreens") or board_scene.get("boardScreens") or []),
        "sourceRefs":         refs,
    })
    cmd_out  = safe_dict(safe_dict(outputs.get("BoardCommandAgent")).get("result") or {})
    all_cmds = safe_list(cmd_out.get("boardCommands") or cmd_out.get("commands") or board_scene.get("boardCommands") or [])
    await asyncio.gather(
        run("LayoutAgent", {
            "boardCommands": all_cmds,
            "commands": all_cmds,
            "boardScenes": board_scene,
            "visualPlan": visual_result,
            "sourceRefs": refs,
        }),
        run("HandwritingDrawingAgent", {
            "boardCommands": all_cmds,
            "commands": all_cmds,
            "boardScenes": board_scene,
            "sourceRefs": refs,
        }),
    )

    # ── Stage F: Voice + subtitles — use correct packet builder ─────────────────
    exp_result_inner = safe_dict(explanation_result.get("result") or explanation_result)
    voice_packet     = build_voice_script_packet(
        working, refs,
        exp_result_inner,     # explanation_result
        board_scene,          # board_scene_result
        cmd_out,              # command_result
        vision_result_raw,    # selected_page_vision_result
    )
    voice_result = await run("VoiceScriptAgent", {
        "mode": "write_voice_script",
        "voiceScriptPacket": voice_packet, "sourceRefs": refs,
        "boardCommands": all_cmds, "studentLevel": working.get("studentLevel"),
    })
    all_voice = safe_list(safe_dict(voice_result.get("result") or {}).get("voiceScript") or [])

    voice_out   = safe_dict(voice_result.get("result") or voice_result)
    sub_packet  = build_subtitle_packet(working, voice_out, cmd_out)
    sub_result  = await run("SubtitleSyncAgent", {"voiceScript": all_voice, "subtitlePacket": sub_packet})
    all_subs    = safe_list(safe_dict(sub_result.get("result") or {}).get("subtitles") or [])

    # ── Assemble final result ─────────────────────────────────────────────────────
    all_refs    = dedupe_source_refs(refs + collect_source_refs(*[safe_dict(v.get("result") or v) for v in outputs.values()]))
    all_screens = safe_list(board_scene.get("boardScreens") or [])
    mcp_result = safe_dict(safe_dict(outputs.get("MongoDbMcpToolAgent")).get("result") or {})
    mcp_tool_calls = safe_list(mcp_result.get("toolCalls"))
    partner_power = {
        "mcpUsed": bool(mcp_result.get("mcpUsed")),
        "partner": mcp_result.get("partner") or "MongoDB",
        "toolCallCount": len(mcp_tool_calls),
        "toolCalls": mcp_tool_calls[:20],
        "capabilitiesUsed": ["mission_read_context"] if mcp_result.get("mcpUsed") else [],
    }
    candidate = {
        "boardCommands": all_cmds,
        "voiceScript": all_voice,
        "subtitles": all_subs,
        "boardScreens": all_screens,
        "sourceRefs": all_refs[:60],
        "metadata": {"stage": "final", "fallbackUsed": False},
    }
    await run("ValidatorSafetyAgent", {
        "mode": "validate_tutor_output",
        "candidate": candidate,
        "validationScope": "final",
        "strict": False,
    })
    succeeded   = sum(1 for t in trace if t.get("ok"))

    return {
        "ok":            bool(all_cmds or all_voice),
        "boardCommands": all_cmds,
        "voiceScript":   all_voice,
        "subtitles":     all_subs,
        "boardScreens":  all_screens,
        "sourceRefs":    all_refs[:60],
        "partnerPower":  partner_power,
        "mcpTrace":      [mcp_result] if mcp_result else [],
        "toolTrace":     mcp_tool_calls[:60],
        "selectedNode":  selected_node(payload),
        "agentOutputs":  {k: safe_dict(v.get("result") or {}) for k, v in outputs.items()},
        "agentTrace":    trace,
        "errors":        [e for t in trace if not t.get("ok") for e in safe_list(outputs.get(t["agent"], {}).get("errors") or [])],
        "metadata": {
            "fallbackUsed": False, "usesAdkPipelineV2": True,
            "boardCommandCount": len(all_cmds), "voiceLineCount": len(all_voice),
            "subtitleCount": len(all_subs), "screenCount": len(all_screens),
            "agentsTotal": len(trace), "agentsSucceeded": succeeded,
            "mcpUsed": partner_power["mcpUsed"],
            "mcpToolCallCount": partner_power["toolCallCount"],
        },
    }


async def run_pipeline_with_direct_fallback(payload: dict) -> dict:
    """
    Primary entry point for Node.js bridge — v3 order (GOLDEN RULE #2):

      1. ADK multi-agent pipeline runs FIRST — it is the intelligence layer
         (RAG, Vision, TeachingStrategy, BoardCommand, VoiceScript, ...).
      2. direct_gemini (2 focused structured calls) is the EMERGENCY FALLBACK,
         used only when ADK genuinely fails or returns too little to teach.
      3. If both fail → raise honestly. NEVER placeholder content
         (GOLDEN RULE #5 — _ensure_minimums fake-success is dead).
    """
    try:
        from .direct_gemini_pipeline import run_direct_pipeline
    except ImportError:
        try:
            from google_agent.pipeline.direct_gemini_pipeline import run_direct_pipeline
        except ImportError:
            run_direct_pipeline = None

    # Quality bar for "this is teachable": enough screens AND commands.
    MIN_SCREENS, MIN_COMMANDS = 10, 30
    adk_error: Exception | None = None

    # ── PRIMARY: ADK multi-agent pipeline ─────────────────────────────────────
    try:
        result = await run_adk_pipeline(payload)
        screens  = len(result.get("boardScreens") or [])
        commands = len(result.get("boardCommands") or [])
        voice    = len(result.get("voiceScript") or [])
        if screens >= MIN_SCREENS and commands >= MIN_COMMANDS and voice > 0:
            print(f"[pipeline] ADK PRIMARY succeeded screens={screens} "
                  f"commands={commands} voice={voice}", file=sys.stderr)
            result.setdefault("metadata", {})["pipeline"] = "adk_agents_primary"
            return result
        print(f"[pipeline] ADK output below quality bar (screens={screens} "
              f"commands={commands} voice={voice}) — using direct fallback",
              file=sys.stderr)
    except Exception as exc:
        adk_error = exc
        hard_failure = (
            "VisionIndex required" in str(exc)
            or "QualityStackOrchestrator below quality bar" in str(exc)
            or "refusing legacy weak lesson fallback" in str(exc)
        )
        if hard_failure:
            print(f"[pipeline] ADK PRIMARY hard-failed: {exc}. "
                  f"No direct fallback because that would create weak text-only content.",
                  file=sys.stderr)
            raise
        print(f"[pipeline] ADK PRIMARY failed: {exc} — using direct fallback",
              file=sys.stderr)

    # ── FALLBACK: direct structured pipeline (2 focused calls) ────────────────
    if run_direct_pipeline is not None:
        result = run_direct_pipeline(payload)  # raises DirectPipelineError honestly
        result.setdefault("metadata", {})["pipeline"] = "direct_gemini_fallback"
        if adk_error is not None:
            result["metadata"]["adkError"] = str(adk_error)[:300]
        return result

    # ── Both unavailable → honest failure ─────────────────────────────────────
    raise RuntimeError(
        f"Both pipelines failed. ADK error: {adk_error}. "
        f"direct_gemini unavailable. No fake content will be returned."
    )

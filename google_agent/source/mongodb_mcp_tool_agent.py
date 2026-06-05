"""
google_agent/source/mongodb_mcp_tool_agent.py
===============================================================================
FULL REPLACEMENT

MongoDB MCP Tool Agent for real Partner Power proof.

This version matches the MCP server you actually have working:
  MONGODB_MCP_COMMAND=npx
  MONGODB_MCP_ARGS=-y mongodb-mcp-server

Your MCP server exposes read tools such as:
  - aggregate
  - aggregate-db
  - collection-schema
  - collection-indexes
  - collection-storage-size

So this agent does NOT depend on a missing find tool.
It uses aggregate for reads and schema/index tools for Partner Power proof.

It never fakes MCP success:
  - mcpUsed=true only if real MCP tools/list or tools/call succeeds.
  - fallbackUsed is always false.
===============================================================================
"""

from __future__ import annotations

import json
import os
import shlex
import subprocess
import time
from typing import Any, Dict, List, Tuple

try:
    from ..live_tutor_agents.base_agent import BaseLiveTutorAgent
    from ..live_tutor_agents.contracts import (
        AgentContext,
        JsonDict,
        ValidationResult,
        clean_text,
        safe_dict,
        safe_list,
    )
except Exception:
    from google_agent.live_tutor_agents.base_agent import BaseLiveTutorAgent
    from google_agent.live_tutor_agents.contracts import (
        AgentContext,
        JsonDict,
        ValidationResult,
        clean_text,
        safe_dict,
        safe_list,
    )


# =============================================================================
# Basic helpers
# =============================================================================


def _short(value: Any, limit: int = 1600) -> str:
    try:
        text = json.dumps(value, ensure_ascii=False)
    except Exception:
        text = str(value)
    return clean_text(text, limit)


def split_args(args_text: str) -> List[str]:
    args_text = clean_text(args_text, 8000)
    if not args_text:
        return []

    pieces = shlex.split(args_text)
    out: List[str] = []

    for item in pieces:
        if item.startswith("$"):
            out.append(os.getenv(item[1:], ""))
        else:
            out.append(os.path.expandvars(item))

    return [x for x in out if x]


def get_mcp_command() -> str:
    return os.getenv("MONGODB_MCP_COMMAND") or os.getenv("MCP_MONGODB_COMMAND") or ""


def get_mcp_args() -> List[str]:
    raw = os.getenv("MONGODB_MCP_ARGS") or os.getenv("MCP_MONGODB_ARGS") or ""
    return split_args(raw)


def configured() -> bool:
    return bool(get_mcp_command())


def db_name() -> str:
    return (
        os.getenv("MONGODB_MCP_DATABASE")
        or os.getenv("MONGODB_DATABASE")
        or os.getenv("MONGO_DB_NAME")
        or "live-tutor"
    )


def collection_names() -> JsonDict:
    return {
        "resources": os.getenv("MONGODB_MCP_RESOURCES_COLLECTION", "googlelivetutorresources"),
        "chunks": os.getenv("MONGODB_MCP_CHUNKS_COLLECTION", "googlelivetutorresourcechunks"),
        "trees": os.getenv("MONGODB_MCP_TREES_COLLECTION", "googlelivetutorconcepttrees"),
        "boards": os.getenv("MONGODB_MCP_BOARDS_COLLECTION", "googlelivetutorboards"),
        "stage2Sessions": os.getenv("MONGODB_MCP_STAGE2_COLLECTION", "googlelivetutorstage2sessions"),
        "agentTrace": os.getenv("MONGODB_MCP_TRACE_COLLECTION", "googlelivetutoragenttraces"),
    }


def tool_call_record(
    tool: str,
    purpose: str,
    ok: bool,
    arguments: JsonDict | None = None,
    result: JsonDict | None = None,
    error: str = "",
) -> JsonDict:
    return {
        "tool": clean_text(tool, 160),
        "purpose": clean_text(purpose, 260),
        "ok": bool(ok),
        "arguments": arguments or {},
        "resultPreview": _short(result, 1600) if result is not None else "",
        "error": clean_text(error, 1000),
    }


# =============================================================================
# MCP JSON-RPC stdio client
# =============================================================================


def initialize_request() -> JsonDict:
    return {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "protocolVersion": "2025-06-18",
            "capabilities": {},
            "clientInfo": {
                "name": "advanced-live-tutor-mongodb-mcp-tool-agent",
                "version": "3.0.0",
            },
        },
    }


def initialized_notification() -> JsonDict:
    return {
        "jsonrpc": "2.0",
        "method": "notifications/initialized",
        "params": {},
    }


def run_mcp_requests(requests: List[JsonDict], timeout_sec: int = 30) -> List[JsonDict]:
    command = get_mcp_command()
    args = get_mcp_args()

    if not command:
        raise RuntimeError("MONGODB_MCP_COMMAND is missing. Cannot run real MongoDB MCP.")

    process = subprocess.Popen(
        [command, *args],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1,
        env=os.environ.copy(),
    )

    assert process.stdin is not None
    assert process.stdout is not None

    responses: List[JsonDict] = []
    started = time.time()

    try:
        for req in requests:
            request_id = req.get("id")

            process.stdin.write(json.dumps(req, ensure_ascii=False) + "\n")
            process.stdin.flush()

            if request_id is None:
                continue

            while True:
                if time.time() - started > timeout_sec:
                    raise TimeoutError(f"MCP request timed out after {timeout_sec}s.")

                line = process.stdout.readline()
                if not line:
                    continue

                line = line.strip()
                if not line:
                    continue

                try:
                    parsed = json.loads(line)
                except Exception:
                    continue

                if parsed.get("id") == request_id:
                    responses.append(parsed)
                    break

        return responses

    finally:
        try:
            process.stdin.close()
        except Exception:
            pass

        try:
            process.terminate()
            process.wait(timeout=3)
        except Exception:
            try:
                process.kill()
            except Exception:
                pass


def list_mcp_tools(timeout_sec: int = 30) -> Tuple[List[JsonDict], JsonDict]:
    responses = run_mcp_requests(
        [
            initialize_request(),
            initialized_notification(),
            {
                "jsonrpc": "2.0",
                "id": 2,
                "method": "tools/list",
                "params": {},
            },
        ],
        timeout_sec=timeout_sec,
    )

    list_response = responses[-1] if responses else {}
    result = safe_dict(list_response.get("result"))
    tools = [safe_dict(t) for t in safe_list(result.get("tools")) if safe_dict(t)]
    return tools, list_response


def call_mcp_tool(tool_name: str, arguments: JsonDict, timeout_sec: int = 30) -> JsonDict:
    if not tool_name:
        raise RuntimeError("call_mcp_tool requires a real tool name from tools/list.")

    responses = run_mcp_requests(
        [
            initialize_request(),
            initialized_notification(),
            {
                "jsonrpc": "2.0",
                "id": 2,
                "method": "tools/call",
                "params": {
                    "name": tool_name,
                    "arguments": arguments,
                },
            },
        ],
        timeout_sec=timeout_sec,
    )

    call_response = responses[-1] if responses else {}

    if call_response.get("error"):
        raise RuntimeError(f"MCP tools/call error: {call_response.get('error')}")

    return {
        "toolName": tool_name,
        "arguments": arguments,
        "toolResult": safe_dict(call_response.get("result")),
        "rawResponse": call_response,
    }


# =============================================================================
# Tool selection and arguments
# =============================================================================


def tool_name(tool: JsonDict) -> str:
    return clean_text(tool.get("name") or tool.get("id") or "", 200)


def select_tool(tools: List[JsonDict], purpose: str) -> str:
    purpose = clean_text(purpose, 80).lower()

    override_map = {
        "aggregate": os.getenv("MONGODB_MCP_AGGREGATE_TOOL", ""),
        "schema": os.getenv("MONGODB_MCP_SCHEMA_TOOL", ""),
        "indexes": os.getenv("MONGODB_MCP_INDEXES_TOOL", ""),
        "insert": os.getenv("MONGODB_MCP_INSERT_TOOL", ""),
        "update": os.getenv("MONGODB_MCP_UPDATE_TOOL", ""),
    }

    if override_map.get(purpose):
        return override_map[purpose]

    names = [tool_name(t) for t in tools]

    patterns = {
        "aggregate": ["aggregate"],
        "schema": ["collection-schema", "schema"],
        "indexes": ["collection-indexes", "indexes", "index"],
        "insert": ["insert", "create"],
        "update": ["update", "replace", "upsert"],
    }

    for name in names:
        low = name.lower()
        if any(p in low for p in patterns.get(purpose, [])):
            if purpose == "aggregate" and low == "aggregate-db":
                continue
            return name

    return ""


def aggregate_args(collection: str, pipeline: List[JsonDict], limit_bytes: int = 1048576) -> JsonDict:
    return {
        "database": db_name(),
        "collection": collection,
        "pipeline": pipeline,
        "responseBytesLimit": limit_bytes,
    }


def collection_tool_args(collection: str, sample_size: int = 50) -> JsonDict:
    return {
        "database": db_name(),
        "collection": collection,
        "sampleSize": sample_size,
        "responseBytesLimit": 1048576,
    }


def insert_args(collection: str, document: JsonDict) -> JsonDict:
    return {
        "database": db_name(),
        "collection": collection,
        "document": document,
    }


def update_args(collection: str, filter_doc: JsonDict, update_doc: JsonDict, upsert: bool = True) -> JsonDict:
    return {
        "database": db_name(),
        "collection": collection,
        "filter": filter_doc,
        "update": update_doc,
        "upsert": upsert,
    }


# =============================================================================
# Mission data helpers
# =============================================================================


def extract_ids(payload: JsonDict) -> JsonDict:
    mission_payload = safe_dict(payload.get("missionPayload"))
    merged = {**mission_payload, **payload}

    node = safe_dict(merged.get("selectedNode") or merged.get("node"))

    return {
        "ownerKey": clean_text(merged.get("ownerKey") or safe_dict(merged.get("owner")).get("ownerKey") or "", 180),
        "offlineUserId": clean_text(merged.get("offlineUserId") or safe_dict(merged.get("owner")).get("offlineUserId") or "", 180),
        "resourceId": clean_text(merged.get("resourceId") or safe_dict(merged.get("resource")).get("resourceId") or "", 240),
        "treeId": clean_text(merged.get("treeId") or "", 240),
        "boardId": clean_text(merged.get("boardId") or "", 240),
        "sessionId": clean_text(merged.get("sessionId") or "", 240),
        "nodeId": clean_text(node.get("nodeId") or node.get("id") or merged.get("nodeId") or "", 220),
        "selectedNode": node,
    }


def owner_filter(ids: JsonDict) -> JsonDict:
    f: JsonDict = {}
    if ids.get("ownerKey"):
        f["ownerKey"] = ids["ownerKey"]
    return f


def compact_stage2_document(payload: JsonDict) -> JsonDict:
    stage2 = safe_dict(payload.get("stage2Session") or payload.get("session") or payload.get("candidate"))
    ids = extract_ids(payload)

    session_id = ids["sessionId"] or clean_text(stage2.get("sessionId") or "", 240)
    if not session_id:
        session_id = f"mcp_stage2_session_{int(time.time() * 1000)}"

    return {
        "sessionId": session_id,
        "resourceId": ids["resourceId"] or clean_text(stage2.get("resourceId") or "", 240),
        "treeId": ids["treeId"] or clean_text(stage2.get("treeId") or "", 240),
        "boardId": ids["boardId"] or clean_text(stage2.get("boardId") or "", 240),
        "ownerKey": ids["ownerKey"],
        "offlineUserId": ids["offlineUserId"],
        "selectedNode": ids["selectedNode"] or safe_dict(stage2.get("selectedNode")),
        "title": clean_text(stage2.get("title") or "", 240),
        "sourceRefs": safe_list(stage2.get("sourceRefs"))[:80],
        "premiumBoardScreens": safe_list(stage2.get("premiumBoardScreens") or stage2.get("boardScreens"))[:20],
        "boardCommands": safe_list(stage2.get("boardCommands") or stage2.get("commands"))[:500],
        "voiceScript": safe_list(stage2.get("voiceScript"))[:500],
        "subtitles": safe_list(stage2.get("subtitles"))[:800],
        "compiledDiagrams": safe_list(stage2.get("compiledDiagrams"))[:100],
        "quiz": safe_dict(stage2.get("quiz")),
        "agentTrace": safe_list(stage2.get("agentTrace"))[:100],
        "missionTrace": safe_list(stage2.get("missionTrace"))[:100],
        "mcpTrace": safe_list(stage2.get("mcpTrace"))[:60],
        "partnerPower": safe_dict(stage2.get("partnerPower")),
        "metadata": {
            **safe_dict(stage2.get("metadata")),
            "savedBy": "MongoDbMcpToolAgent",
            "fallbackUsed": False,
        },
    }


# =============================================================================
# Mission read/write
# =============================================================================


def run_mission_read_context(payload: JsonDict, timeout_sec: int) -> JsonDict:
    ids = extract_ids(payload)
    cols = collection_names()

    tools, _raw = list_mcp_tools(timeout_sec=timeout_sec)
    aggregate_tool = select_tool(tools, "aggregate")
    schema_tool = select_tool(tools, "schema")
    indexes_tool = select_tool(tools, "indexes")

    tool_calls: List[JsonDict] = [
        tool_call_record("tools/list", "List MongoDB MCP tools before mission read.", True, result={"toolCount": len(tools)})
    ]

    if not aggregate_tool:
        return {
            "mcpUsed": False,
            "configured": True,
            "tools": tools,
            "toolCalls": tool_calls + [
                tool_call_record("", "No aggregate tool found for MCP read.", False, error="Expected aggregate tool from mongodb-mcp-server.")
            ],
            "sourceRefs": safe_list(payload.get("sourceRefs")),
            "chunks": safe_list(payload.get("chunks")),
            "metadata": {
                "agent": "MongoDbMcpToolAgent",
                "realMcpUsed": False,
                "fallbackUsed": False,
                "reason": "tools/list succeeded but aggregate tool was not found.",
            },
        }

    read_result: JsonDict = {
        "resource": {},
        "chunks": {},
        "tree": {},
        "previousSessions": {},
        "schemas": {},
        "indexes": {},
    }

    real_calls: List[JsonDict] = []

    def call_aggregate(key: str, purpose: str, collection: str, pipeline: List[JsonDict]) -> None:
        args = aggregate_args(collection, pipeline)
        try:
            result = call_mcp_tool(aggregate_tool, args, timeout_sec=timeout_sec)
            read_result[key] = result.get("toolResult")
            rec = tool_call_record(aggregate_tool, purpose, True, args, result.get("toolResult"))
            tool_calls.append(rec)
            real_calls.append(rec)
        except Exception as exc:
            tool_calls.append(tool_call_record(aggregate_tool, purpose, False, args, error=str(exc)))

    def call_collection_tool(tool: str, key: str, purpose: str, collection: str, sample_size: int = 50) -> None:
        if not tool:
            return

        args = collection_tool_args(collection, sample_size)
        try:
            result = call_mcp_tool(tool, args, timeout_sec=timeout_sec)
            read_result[key] = result.get("toolResult")
            rec = tool_call_record(tool, purpose, True, args, result.get("toolResult"))
            tool_calls.append(rec)
            real_calls.append(rec)
        except Exception as exc:
            tool_calls.append(tool_call_record(tool, purpose, False, args, error=str(exc)))

    base_owner = owner_filter(ids)

    if ids["resourceId"]:
        call_aggregate(
            "resource",
            "Read selected resource metadata using MongoDB MCP aggregate.",
            cols["resources"],
            [{"$match": {**base_owner, "resourceId": ids["resourceId"]}}, {"$limit": 1}],
        )

        call_aggregate(
            "chunks",
            "Read selected resource chunks using MongoDB MCP aggregate.",
            cols["chunks"],
            [
                {"$match": {**base_owner, "resourceId": ids["resourceId"]}},
                {"$sort": {"page": 1, "chunkIndex": 1}},
                {"$limit": int(payload.get("mcpChunkLimit") or 140)},
            ],
        )

    if ids["treeId"]:
        call_aggregate(
            "tree",
            "Read selected concept tree using MongoDB MCP aggregate.",
            cols["trees"],
            [{"$match": {**base_owner, "treeId": ids["treeId"]}}, {"$limit": 1}],
        )

    session_filter = {**base_owner}
    if ids["sessionId"]:
        session_filter["sessionId"] = ids["sessionId"]
    elif ids["resourceId"]:
        session_filter["resourceId"] = ids["resourceId"]

    if session_filter:
        call_aggregate(
            "previousSessions",
            "Read previous board sessions using MongoDB MCP aggregate.",
            cols["stage2Sessions"],
            [{"$match": session_filter}, {"$limit": 5}],
        )

    for collection_key, collection in [
        ("resourceSchema", cols["resources"]),
        ("chunkSchema", cols["chunks"]),
        ("treeSchema", cols["trees"]),
        ("chunkIndexes", cols["chunks"]),
        ("stage2Indexes", cols["stage2Sessions"]),
    ]:
        if collection_key.endswith("Schema"):
            call_collection_tool(schema_tool, collection_key, f"Inspect schema for {collection}.", collection, sample_size=50)
        else:
            call_collection_tool(indexes_tool, collection_key, f"Inspect indexes/search indexes for {collection}.", collection)

    return {
        "mcpUsed": bool(real_calls),
        "configured": True,
        "tools": tools,
        "mcpReadResult": read_result,
        "sourceRefs": safe_list(payload.get("sourceRefs")),
        "chunks": safe_list(payload.get("chunks")),
        "toolCalls": tool_calls,
        "metadata": {
            "agent": "MongoDbMcpToolAgent",
            "realMcpUsed": bool(real_calls),
            "fallbackUsed": False,
            "aggregateTool": aggregate_tool,
            "schemaTool": schema_tool,
            "indexesTool": indexes_tool,
            "toolCount": len(tools),
            "realToolCallCount": len(real_calls),
            "readOnlyMcpCompatible": True,
            "partnerPowerCapabilities": [
                "MongoDB MCP tools/list",
                "MongoDB aggregate resource read",
                "MongoDB aggregate chunk read",
                "MongoDB aggregate concept-tree read",
                "MongoDB collection schema inspection",
                "MongoDB collection index/search-index inspection",
            ],
        },
    }


def run_mission_save_session(payload: JsonDict, timeout_sec: int) -> JsonDict:
    cols = collection_names()
    tools, _raw = list_mcp_tools(timeout_sec=timeout_sec)

    insert_tool = select_tool(tools, "insert")
    update_tool = select_tool(tools, "update")
    schema_tool = select_tool(tools, "schema")
    indexes_tool = select_tool(tools, "indexes")

    tool_calls: List[JsonDict] = [
        tool_call_record("tools/list", "List MongoDB MCP tools before mission save.", True, result={"toolCount": len(tools)})
    ]

    real_calls: List[JsonDict] = []
    document = compact_stage2_document(payload)
    write_available = bool(insert_tool or update_tool)

    if update_tool:
        args = update_args(
            cols["stage2Sessions"],
            {"sessionId": document["sessionId"], "ownerKey": document.get("ownerKey", "")},
            {"$set": document},
            upsert=True,
        )
        try:
            result = call_mcp_tool(update_tool, args, timeout_sec=timeout_sec)
            rec = tool_call_record(update_tool, "Upsert generated Stage 2 board session.", True, args, result.get("toolResult"))
            tool_calls.append(rec)
            real_calls.append(rec)
        except Exception as exc:
            tool_calls.append(tool_call_record(update_tool, "Upsert generated Stage 2 board session.", False, args, error=str(exc)))

    elif insert_tool:
        args = insert_args(cols["stage2Sessions"], document)
        try:
            result = call_mcp_tool(insert_tool, args, timeout_sec=timeout_sec)
            rec = tool_call_record(insert_tool, "Insert generated Stage 2 board session.", True, args, result.get("toolResult"))
            tool_calls.append(rec)
            real_calls.append(rec)
        except Exception as exc:
            tool_calls.append(tool_call_record(insert_tool, "Insert generated Stage 2 board session.", False, args, error=str(exc)))

    else:
        tool_calls.append(
            tool_call_record(
                "read-only-mcp",
                "No insert/update tool exposed. Session persistence should remain in app DB while MCP proves partner read/schema/index power.",
                True,
                result={"writeAvailable": False, "stage2Collection": cols["stage2Sessions"]},
            )
        )

    def call_collection_tool(tool: str, purpose: str, collection: str) -> None:
        if not tool:
            return

        args = collection_tool_args(collection, sample_size=10)
        try:
            result = call_mcp_tool(tool, args, timeout_sec=timeout_sec)
            rec = tool_call_record(tool, purpose, True, args, result.get("toolResult"))
            tool_calls.append(rec)
            real_calls.append(rec)
        except Exception as exc:
            tool_calls.append(tool_call_record(tool, purpose, False, args, error=str(exc)))

    call_collection_tool(schema_tool, "Inspect Stage 2 session collection schema.", cols["stage2Sessions"])
    call_collection_tool(indexes_tool, "Inspect Stage 2 session collection indexes.", cols["stage2Sessions"])
    call_collection_tool(schema_tool, "Inspect agent trace collection schema.", cols["agentTrace"])
    call_collection_tool(indexes_tool, "Inspect agent trace collection indexes.", cols["agentTrace"])

    return {
        "mcpUsed": bool(real_calls),
        "configured": True,
        "tools": tools,
        "sessionId": document["sessionId"],
        "writeAvailable": write_available,
        "savedByMcp": write_available and any(c.get("ok") and c.get("tool") in {insert_tool, update_tool} for c in real_calls),
        "savedDocumentPreview": {
            "sessionId": document["sessionId"],
            "resourceId": document.get("resourceId"),
            "treeId": document.get("treeId"),
            "boardCommandCount": len(safe_list(document.get("boardCommands"))),
            "voiceLineCount": len(safe_list(document.get("voiceScript"))),
            "diagramCount": len(safe_list(document.get("compiledDiagrams"))),
        },
        "toolCalls": tool_calls,
        "metadata": {
            "agent": "MongoDbMcpToolAgent",
            "realMcpUsed": bool(real_calls),
            "fallbackUsed": False,
            "insertTool": insert_tool,
            "updateTool": update_tool,
            "schemaTool": schema_tool,
            "indexesTool": indexes_tool,
            "writeAvailable": write_available,
            "readOnlyMcpCompatible": not write_available,
            "toolCount": len(tools),
            "realToolCallCount": len(real_calls),
        },
    }


# =============================================================================
# Agent class
# =============================================================================


class MongoDbMcpToolAgent(BaseLiveTutorAgent):
    agent_name = "MongoDbMcpToolAgent"
    agent_group = "source"
    default_mode = "list_tools"
    uses_adk = False

    @property
    def instruction(self) -> str:
        return """
MongoDB MCP Tool Agent.
Use real MongoDB MCP tools to prove Partner Power.
Never invent tool results.
"""

    def validate_input(self, payload: JsonDict) -> ValidationResult:
        mode = clean_text(payload.get("mode") or self.default_mode, 80)
        errors: List[str] = []
        warnings: List[str] = []

        if mode not in {
            "inspect_config",
            "list_tools",
            "call_tool",
            "mission_read_context",
            "mission_save_session",
        }:
            errors.append(f"Unsupported MongoDbMcpToolAgent mode: {mode}")

        if mode != "inspect_config" and not configured():
            errors.append("MONGODB_MCP_COMMAND is missing.")

        if mode == "call_tool" and not clean_text(payload.get("toolName")):
            errors.append("call_tool mode requires toolName returned by MCP tools/list.")

        if configured() and not get_mcp_args():
            warnings.append("MONGODB_MCP_ARGS is empty. This may be OK only if command includes all defaults.")

        return ValidationResult(
            ok=not errors,
            errors=errors,
            warnings=warnings,
            validator="MongoDbMcpToolAgent.validate_input",
            fallbackUsed=False,
        )

    def build_prompt(self, payload: JsonDict, context: AgentContext) -> str:
        return ""

    def run_without_adk(self, payload: JsonDict, context: AgentContext) -> JsonDict:
        mode = clean_text(payload.get("mode") or self.default_mode, 80)
        timeout_sec = int(payload.get("timeoutSec") or os.getenv("MONGODB_MCP_TIMEOUT_SEC") or 30)

        if mode == "inspect_config":
            return {
                "mcpUsed": False,
                "configured": configured(),
                "command": get_mcp_command(),
                "argsCount": len(get_mcp_args()),
                "database": db_name(),
                "collections": collection_names(),
                "metadata": {
                    "agent": self.agent_name,
                    "fallbackUsed": False,
                    "realSeparateAgent": True,
                },
            }

        if mode == "list_tools":
            tools, raw_response = list_mcp_tools(timeout_sec=timeout_sec)
            if not tools:
                raise RuntimeError(f"MCP tools/list returned no tools. Response={raw_response}")

            return {
                "mcpUsed": True,
                "tools": tools,
                "toolCount": len(tools),
                "rawResponse": raw_response,
                "toolCalls": [
                    tool_call_record("tools/list", "List MongoDB MCP tools.", True, result={"toolCount": len(tools)})
                ],
                "metadata": {
                    "agent": self.agent_name,
                    "fallbackUsed": False,
                    "realMcpUsed": True,
                    "realSeparateAgent": True,
                },
            }

        if mode == "call_tool":
            tool_name_value = clean_text(payload.get("toolName"), 200)
            arguments = safe_dict(payload.get("arguments"))
            result = call_mcp_tool(tool_name_value, arguments, timeout_sec=timeout_sec)
            return {
                "mcpUsed": True,
                **result,
                "toolCalls": [
                    tool_call_record(tool_name_value, "Direct MCP tool call.", True, arguments, result.get("toolResult"))
                ],
                "metadata": {
                    "agent": self.agent_name,
                    "fallbackUsed": False,
                    "realMcpUsed": True,
                    "realSeparateAgent": True,
                },
            }

        if mode == "mission_read_context":
            return run_mission_read_context(payload, timeout_sec=timeout_sec)

        if mode == "mission_save_session":
            return run_mission_save_session(payload, timeout_sec=timeout_sec)

        raise RuntimeError(f"Unsupported MongoDbMcpToolAgent mode: {mode}")

    def normalize_output(self, raw: JsonDict, payload: JsonDict, context: AgentContext) -> JsonDict:
        output = safe_dict(raw).copy()
        output.setdefault("mcpUsed", bool(safe_dict(output.get("metadata")).get("realMcpUsed")))
        output.setdefault("partner", "MongoDB")
        output.setdefault("toolCalls", [])
        output.setdefault("metadata", {})

        if isinstance(output["metadata"], dict):
            output["metadata"]["agent"] = self.agent_name
            output["metadata"]["fallbackUsed"] = False
            output["metadata"]["partner"] = "MongoDB"

        return output

    def validate_output(self, output: JsonDict, payload: JsonDict, context: AgentContext) -> ValidationResult:
        mode = clean_text(payload.get("mode") or self.default_mode, 80)
        errors: List[str] = []
        warnings: List[str] = []

        if mode == "list_tools" and not safe_list(output.get("tools")):
            errors.append("list_tools output must include tools.")

        if mode == "call_tool" and "toolResult" not in output:
            errors.append("call_tool output must include toolResult.")

        if mode in {"mission_read_context", "mission_save_session"}:
            if not isinstance(output.get("mcpUsed"), bool):
                errors.append(f"{mode} output must include boolean mcpUsed.")
            if not safe_list(output.get("toolCalls")):
                warnings.append(f"{mode} returned no toolCalls. MCP may be configured but no usable MongoDB tool matched.")

        if safe_dict(output.get("metadata")).get("fallbackUsed") is True:
            errors.append("fallbackUsed=true is not allowed for MongoDbMcpToolAgent.")

        return ValidationResult(
            ok=not errors,
            errors=errors,
            warnings=warnings,
            validator="MongoDbMcpToolAgent.validate_output",
            fallbackUsed=False,
        )


def run(payload: JsonDict) -> JsonDict:
    import asyncio

    agent = MongoDbMcpToolAgent()
    return asyncio.run(agent.run(payload)).to_dict()


__all__ = [
    "MongoDbMcpToolAgent",
    "run",
    "list_mcp_tools",
    "call_mcp_tool",
    "configured",
]
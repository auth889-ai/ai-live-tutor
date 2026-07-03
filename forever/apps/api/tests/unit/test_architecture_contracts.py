from forever_api.agents.registry import describe_agent_society
from forever_api.orchestration.forever_graph import build_langgraph_placeholder


def test_graph_contract_exposes_expected_nodes():
    graph = build_langgraph_placeholder()

    assert graph["engine"] == "langgraph"
    assert "compile_timeline" in graph["nodes"]
    assert "review_grounding_pedagogy_sync" in graph["nodes"]


def test_agent_society_has_review_and_repair_roles():
    names = {agent["name"] for agent in describe_agent_society()}

    assert "GroundingReviewerAgent" in names
    assert "SyncReviewerAgent" in names
    assert "RepairAgent" in names


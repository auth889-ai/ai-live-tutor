"""
premium_block_builder.py — generates premium board visuals from source facts.
When no real PDF diagram exists: SVG, HTML, Mermaid, comparison table — all source-grounded.
"""
from __future__ import annotations
import time, uuid
from typing import List

try:
    from ...live_tutor_agents.contracts import JsonDict, safe_dict, safe_list, clean_text
except ImportError:
    from google_agent.live_tutor_agents.contracts import JsonDict, safe_dict, safe_list, clean_text


def _bid() -> str:
    return f"blk_{int(time.time()*1000)}_{uuid.uuid4().hex[:4]}"


def build_comparison_table_html(headers: List[str], rows: List[List[str]], source_ref: str = "") -> JsonDict:
    head  = "".join(f"<th>{h}</th>" for h in headers)
    tbody = "".join("<tr>" + "".join(f"<td>{c}</td>" for c in row) + "</tr>" for row in rows)
    html  = f"""<div class='premium-table'><table><thead><tr>{head}</tr></thead><tbody>{tbody}</tbody></table>
<p class='source-badge'>{source_ref}</p></div>"""
    return {"type":"htmlPreview","blockId":_bid(),"title":"Comparison","html":html,
            "sourceRef":source_ref,"animationType":"row_by_row","rows":rows,"metadata":{"fallbackUsed":False}}


def build_mermaid_flowchart(nodes: List[str], edges: List[tuple], title: str = "", source_ref: str = "") -> JsonDict:
    defs  = "\n".join(f"  {i}[{n}]" for i, n in enumerate(nodes[:10]))
    conns = "\n".join(f"  {nodes.index(a) if a in nodes else 0} --> {nodes.index(b) if b in nodes else 1}" for a, b in edges[:10] if a in nodes and b in nodes)
    chart = f"flowchart LR\n{defs}\n{conns}"
    return {"type":"mermaidChart","blockId":_bid(),"title":title,"mermaid":chart,
            "sourceRef":source_ref,"metadata":{"fallbackUsed":False}}


def build_step_reveal_html(steps: List[str], title: str = "", source_ref: str = "") -> JsonDict:
    items = "".join(f'<div class="step" data-index="{i}"><span class="num">{i+1}</span>{s}</div>' for i, s in enumerate(steps[:8]))
    html  = f'<div class="step-reveal"><h3>{title}</h3>{items}<p class="source-badge">{source_ref}</p></div>'
    return {"type":"htmlPreview","blockId":_bid(),"title":title,"html":html,
            "animationType":"step_reveal","stepCount":len(steps),"sourceRef":source_ref,"metadata":{"fallbackUsed":False}}


def build_concept_card_html(term: str, definition: str, analogy: str = "", quote: str = "", page: int = 0) -> JsonDict:
    src   = f"[Page {page}]: \"{quote[:100]}\"" if page and quote else ""
    html  = f"""<div class='concept-card'><h2 class='term'>{term}</h2>
<p class='definition'>{definition}</p>
{"<p class='analogy'>💡 " + analogy + "</p>" if analogy else ""}
{"<blockquote class='source'>" + src + "</blockquote>" if src else ""}
</div>"""
    return {"type":"htmlPreview","blockId":_bid(),"title":term,"html":html,
            "sourceRef":src,"page":page,"metadata":{"fallbackUsed":False}}


def build_code_block(code: str, language: str = "sql", title: str = "", source_ref: str = "") -> JsonDict:
    return {"type":"codeBlock","blockId":_bid(),"title":title,"code":clean_text(code,4000),
            "language":language,"sourceRef":source_ref,
            "monacoOptions":{"readOnly":False,"minimap":False,"lineNumbers":"on","theme":"vs-dark"},
            "metadata":{"fallbackUsed":False,"runnable":language in("python","javascript","sql")}}

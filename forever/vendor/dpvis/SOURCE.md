# Vendored: itsdawei/dpvis

- **Original repo**: https://github.com/itsdawei/dpvis
- **Commit vendored from**: `fbe0f305bec13f9fc873425c7c1cc82198e882e2`
- **License**: MIT (Copyright (c) 2023 David Haolong Lee) — see `LICENSE` in this directory,
  copied verbatim from the original repo. No NOTICE file exists upstream.
- **Status**: REFERENCE ONLY. These are Python files; nothing in this directory is imported,
  executed, or bundled by Forever. They document the frame/step model our dp-table dry-run
  engine follows.

## Files

| File here | Upstream source | Status |
| --- | --- | --- |
| `LICENSE` | `LICENSE` | copied verbatim |
| `dp/__init__.py` | `dp/__init__.py` | copied verbatim (reference) |
| `dp/_dp_array.py` | `dp/_dp_array.py` | copied verbatim (reference) |
| `dp/_index_converter.py` | `dp/_index_converter.py` | copied verbatim (reference) |
| `dp/_logger.py` | `dp/_logger.py` | copied verbatim (reference) |
| `dp/_verify.py` | `dp/_verify.py` | copied verbatim (reference) |
| `dp/_visualizer.py` | `dp/_visualizer.py` | copied verbatim (reference) |

Files modified: none. Adapter: none executed — this is the design reference for the existing
engine at `lib/execution/trace/dp-table/` (owned elsewhere; not modified by this vendoring).
Regression tests: the existing dp-table suite under `tests/execution/` continues to gate that
engine; this directory adds no runtime surface.

## Concept map: dpvis -> Forever `lib/execution/trace/dp-table/`

| dpvis concept | Where in dpvis | Forever counterpart |
| --- | --- | --- |
| `DPArray` — an instrumented array whose `__getitem__`/`__setitem__` record every READ/WRITE into a logger | `dp/_dp_array.py` | Forever does NOT instrument the data structure. `tracker.js` (`DP_TRACKER_PY`) uses `sys.settrace` to snapshot the student's plain Python table at every executed line; `compiler.js` recovers writes by diffing consecutive REAL snapshots. |
| `Op` enum (`READ` / `WRITE` / `MAXMIN`) — the per-cell operation vocabulary | `dp/_logger.py` (`class Op`) | Write = a cell whose value differs between consecutive snapshots (`compiler.js` diff loop into `known` map). Reads are never trusted from a log: a write's reads light up only when exactly ONE arithmetic rule (diag+1 / top+left / max(top,left)) reproduces the written value (`provedByCell`), otherwise no highlight. |
| `Logger.to_timesteps()` — raw op log folded into ordered timesteps, one per consecutive WRITE run, each carrying `{READ: set, WRITE: set, MAXMIN: set}` | `dp/_logger.py` | One ExecutionTrace step per snapshot with a non-empty write diff (`compiler.js`); multi-cell diffs become one batched step (`narrateBatch`). The `dpReadBefore` prefix scan in `compiler.js` derives phase ("has ANY dp read happened before this timestep?") from recorded reads only. |
| Highlight semantics — current WRITE cell one color, MAXMIN candidates another, READs a third (`_visualizer.py` / `print_timesteps`) | `dp/_logger.py`, `dp/_visualizer.py` | GridView rendering: current write orange, filled (previously written) region green, proved dependency reads highlighted per-step (`compiler.js` `snap()` -> `array2d.current` / `values` / `filled`). |
| Annotations attached to a timestep or cell (`append_annotation`) | `dp/_logger.py` | Per-step narration built from actual old -> new values (`narrate.js`: `narrateInit` / `narrateWrite` / `narrateBatch` / `narrateDone`). |
| `_verify.py` — checks the recorded log is consistent before display | `dp/_verify.py` | `validateExecutionTrace` (`lib/board/execution/execution-trace.js`) gates every compiled trace; `compiler.js` additionally fails loudly on `too_big` tables and suppresses rule claims when writes carry no information (constant-fill guard). |
| Frame sequencing — slider over timesteps, each frame a full table state | `dp/_visualizer.py` | Clock-driven playback of ExecutionTrace steps in the AlgorithmStage; each step carries the accumulated table state (`values` + `filled`), so scrubbing to any step shows a complete, faithful frame. |
| `IndexConverter` — maps logical DP indices to display grid positions | `dp/_index_converter.py` | `rowLabels` / `colLabels` on the compiled `array2d` view (`compileDpTable` options) — display labeling is declarative, not index arithmetic. |

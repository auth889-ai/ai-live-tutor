export const demoManifest = {
  version: "1.0",
  sceneId: "scene_nested_loop_rules",
  learningUnitId: "lu_inner_loop_columns",
  teachingIntent: "trace_process",
  durationMs: 31530,
  layout: {
    regions: [
      { regionId: "teacher", capability: "teacher_presence", x: 0, y: 0, w: 280, h: 720 },
      { regionId: "board", capability: "handwritten_text", x: 280, y: 0, w: 620, h: 430 },
      { regionId: "code", capability: "code_line_highlight", x: 900, y: 0, w: 380, h: 430 },
      { regionId: "trace", capability: "variable_table", x: 280, y: 430, w: 420, h: 210 },
      { regionId: "output", capability: "output_panel", x: 700, y: 430, w: 580, h: 210 }
    ]
  },
  objects: [
    { objectId: "title_rules", type: "text", regionId: "board", x: 44, y: 34, content: { text: "Patterns -> Nested loops" }, style: { size: 34, color: "#f8fafc" } },
    { objectId: "rule_outer", type: "text", regionId: "board", x: 54, y: 116, content: { text: "1) Outer loop -> rows / lines" }, style: { size: 27, color: "#f8fafc" } },
    { objectId: "rule_inner", type: "text", regionId: "board", x: 54, y: 184, content: { text: "2) Inner loop -> columns" }, style: { size: 27, color: "#f8fafc" } },
    {
      objectId: "code_triangle",
      type: "code",
      regionId: "code",
      content: {
        language: "cpp",
        lines: [
          "void print2(int n) {",
          "  for (int i = 0; i < n; i++) {",
          "    for (int j = 0; j <= i; j++) {",
          "      cout << \"* \";",
          "    }",
          "    cout << endl;",
          "  }",
          "}"
        ]
      }
    },
    { objectId: "trace_table", type: "table", regionId: "trace", content: { headers: ["row i", "j values", "stars"], rows: [["0", "0", "1"], ["1", "0, 1", "2"], ["2", "0, 1, 2", "3"]] } },
    { objectId: "output_triangle", type: "output", regionId: "output", content: { lines: ["*", "* *", "* * *", "* * * *"] } }
  ],
  actions: [
    { actionId: "write_title", type: "write_text", objectId: "title_rules", startMs: 400, endMs: 2200 },
    { actionId: "write_outer", type: "write_text", objectId: "rule_outer", startMs: 10490, endMs: 12790 },
    { actionId: "underline_outer", type: "underline", targetObjectId: "rule_outer", startMs: 13190, endMs: 14090 },
    { actionId: "write_inner", type: "write_text", objectId: "rule_inner", startMs: 16660, endMs: 18960 },
    { actionId: "show_trace", type: "reveal", objectId: "trace_table", startMs: 19260, endMs: 20660 },
    { actionId: "show_code", type: "reveal", objectId: "code_triangle", startMs: 25270, endMs: 26470 },
    { actionId: "show_output", type: "reveal", objectId: "output_triangle", startMs: 27170, endMs: 28570 },
    { actionId: "circle_output", type: "circle", targetObjectId: "output_triangle", startMs: 28870, endMs: 30270 }
  ],
  voiceLines: [
    { voiceLineId: "voice_001", beatId: "beat_hook", text: "Patterns are not important because interviewers love stars. They are important because patterns train your control over nested loops.", startMs: 0, endMs: 6120 },
    { voiceLineId: "voice_002", beatId: "beat_outer", text: "Rule one: the outer loop counts the number of lines. If the pattern has five rows, the outer loop runs five times.", startMs: 6570, endMs: 10650 },
    { voiceLineId: "voice_003", beatId: "beat_inner", text: "Rule two: the inner loop focuses on columns and connects them to the current row. For row zero print one star, for row one print two stars, and so on.", startMs: 11100, endMs: 20820 },
    { voiceLineId: "voice_004", beatId: "beat_code", text: "Now the code becomes simple. The outer loop chooses the row, the inner loop prints the stars, and after each row we move to a new line.", startMs: 21270, endMs: 31080 }
  ],
  subtitles: [],
  interactions: [],
  sourceEvidence: [
    { sourceId: "src_transcript_001", sourceRef: "Teacher transcript 2:20-3:15", quote: "Outer loop counts lines; inner loop focuses on columns and connects them to rows." }
  ]
};

const subtitleWords = [];
for (const line of demoManifest.voiceLines) {
  const words = line.text.split(" ");
  const span = Math.max(120, Math.floor((line.endMs - line.startMs) / words.length));
  words.forEach((word, index) => {
    const startMs = line.startMs + index * span;
    subtitleWords.push({ word, startMs, endMs: Math.min(startMs + span - 20, line.endMs), beatId: line.beatId });
  });
}
demoManifest.subtitles = subtitleWords;


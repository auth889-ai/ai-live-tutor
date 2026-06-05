# Agent 1 PDF/Text Visual Package

This package is for the rebuild folder:

```bash
/Users/jannatulferdouseva/good-content-reach/ai-live-tutor-rebuild
```

Agent 1 goal:

```text
PDF / transcript / saved text resource
  -> MongoDB chunks
  -> Gemini PdfTextVisualAgent
  -> Mermaid diagrams + table
  -> teacher transcript
  -> sceneGraph
```

Supported by Agent 1:

```text
Mermaid flowchart
Mermaid ER diagram
Mermaid sequence diagram
Mermaid timeline
Mermaid mindmap / concept map
Mermaid class diagram
Mermaid state diagram
table
roadmap tree from text
```

Not included in Agent 1:

```text
PDF image extraction
image/figure vision
htmlPreview from image
draw.io XML
real dry-run execution
```

## Files

```text
server/services/googleAgent/pdfTextVisualAgent.service.js
server/controllers/googleLiveTutorAgent1.controller.js
server/routes/googleLiveTutorAgent1.routes.js
client/src/features/googleLiveTutor/components/Agent1VisualRenderer.jsx
```

## Install into rebuild

From the zip root, copy into your project:

```bash
cp -R server /Users/jannatulferdouseva/good-content-reach/ai-live-tutor-rebuild/
cp -R client /Users/jannatulferdouseva/good-content-reach/ai-live-tutor-rebuild/
```

## Mount route

In your Express server file, mount:

```js
app.use(
  "/api/google-agent/live-tutor",
  require("./routes/googleLiveTutorAgent1.routes")
);
```

If your server already has a main router, add inside that router:

```js
router.use(require("./googleLiveTutorAgent1.routes"));
```

## Syntax check

```bash
cd /Users/jannatulferdouseva/good-content-reach/ai-live-tutor-rebuild/server
node -c services/googleAgent/pdfTextVisualAgent.service.js
node -c controllers/googleLiveTutorAgent1.controller.js
node -c routes/googleLiveTutorAgent1.routes.js
```

## Test health

```bash
curl -s http://localhost:3000/api/google-agent/live-tutor/agent1/health | jq
```

## Test after PDF upload

```bash
RESOURCE_ID="paste_uploaded_resource_id_here"

curl -s -X POST "http://localhost:3000/api/google-agent/live-tutor/resources/$RESOURCE_ID/agent1/text-visual" \
  -H "Content-Type: application/json" \
  -H "x-offline-user-id: jana_test" \
  -H "x-device-id: device_test" \
  -H "x-owner-key: jana_test" \
  -d '{
    "question":"From this PDF, create source-grounded visuals like Text2Diagram: flowchart, ER if database entities exist, sequence if process exists, timeline if evolution exists, mindmap/concept map, class/state if relevant, plus a teaching table. Explain each like a private tutor.",
    "studentLevel":"beginner",
    "language":"english",
    "visuals":["flowchart","er","sequence","timeline","mindmap","class","state","table","conceptMap","roadmapTree"],
    "pageMode":"all",
    "maxChunks":120,
    "sourceMaxChars":90000
  }' | jq '{
    ok,
    error,
    agent1Passed,
    supportedVisuals,
    requestedVisuals,
    outputTypes:[.outputs[] | {visualFormat, diagramType, title}],
    pages:(.sceneGraph.pages | length),
    voiceCount:(.voiceScript | length),
    mongoResourceRead:.metadata.mongoResourceRead,
    mcpUsed:.metadata.mcpUsed
  }'
```

Expected:

```text
ok: true
agent1Passed: true
outputTypes includes mermaid + table
sceneGraph.pages >= 2
voiceCount >= 8
mongoResourceRead: true
```

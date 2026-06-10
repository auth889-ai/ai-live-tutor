# World-Best Live Tutor Workflow Target

This is the implementation target for the AI Live Tutor. The current pipeline can
produce boardCommands, voiceScript, subtitles, and boardScreens, but it is still
too short and too generic. The target below is the workflow the product should
build toward.

## Product Goal

Turn a selected PDF concept-tree node into a long, human-like, source-grounded
lesson.

The tutor must:

- teach like a real human teacher for beginner/intermediate/advanced levels
- use the PDF text as factual truth
- show the real PDF page image when a diagram/table/slide matters
- point, circle, underline, and zoom the exact region being explained
- generate deep explanations, examples, analogies, mistakes, repairs, quizzes,
  recap, and practice
- support 2+ hours by generating many lesson segments, not one huge response
- let the student interrupt, ask questions, and resume from the exact command
- save the full lesson as a flipable teacher book: pages, board notes, voice
  script, subtitles, quiz, sources, and replay timeline

## Reference UI Pattern

The reference images show a multi-board teaching workspace, not a simple slide.

Required layout:

- Left rail:
  - resource card
  - lesson sections
  - 27-agent status
  - source grounded / verification status
- Center:
  - large auto-expanding board
  - top board title and progress
  - rich blocks: workflow, concept tree, source evidence, example, table,
    dry run, quiz, recap, voice/subtitle panel
  - real PDF page preview blocks when source image is needed
- Right rail:
  - AI tutor face/avatar
  - current teacher message
  - suggested actions
  - confidence / sources used / verification
  - trace summary
  - next board button
- Bottom:
  - board navigator
  - screen tabs
  - auto-expand toggle
  - play/pause/previous/next

## Correct Runtime Workflow

### 1. Click selected node

Input:

- resourceId
- treeId
- nodeId
- selected node sourceRefs
- student level
- lesson mode: quick, standard, deep, masterclass

### 2. Build source truth packet

The backend must collect:

- selected node title/definition
- selected page refs
- exact selected chunks
- same page chunks
- previous/next page chunks
- full selected page text
- full PDF summary and outline
- real PDF page images for every selected page
- sourceRefs with page, chunkId, quote

Minimum quality:

- selectedEvidence >= 5
- sourceRefs >= 5
- selectedPageFullText length > 500 chars
- pageImages >= selected node page count when images exist

### 3. Vision pass over selected page images

For each selected node page image:

- load real image bytes from disk
- call Gemini Vision
- detect text zones, diagrams, tables, arrows, highlighted elements
- return normalized coordinates in 0..1 range
- produce visualTeacherPacket

Output example:

```json
{
  "page": 6,
  "imagePath": "/server/public/live-tutor-page-images/.../page-06.png",
  "detectedObjects": [
    {
      "id": "query_2_product_sale",
      "type": "text_row",
      "label": "products with most number of sales",
      "bbox": { "x": 0.08, "y": 0.28, "w": 0.78, "h": 0.05 }
    },
    {
      "id": "category_id_question",
      "type": "callout",
      "label": "What if we keep a categoryId in Sale?",
      "bbox": { "x": 0.28, "y": 0.82, "w": 0.48, "h": 0.08 }
    }
  ],
  "metadata": {
    "geminiVisionCalled": true,
    "imageBytesLoaded": true,
    "modelVisionUsed": true
  }
}
```

### 4. Build lesson book plan

Do not generate a full 2-hour lesson in one request. Build a book-like plan.

For beginner masterclass:

- 2 hours = 12 to 18 sections
- each section = 5 to 8 minutes
- each section = 4 to 8 board screens
- expected total = 60 to 140 screens
- every section has sourceRefs and a saved book page

Example section plan:

1. Why this topic matters
2. Plain-English definition
3. Read the real PDF page together
4. Break down every line/table/diagram
5. Build concept map
6. Worked example
7. Common mistake
8. Repair the mistake
9. Compare old vs new approach
10. Mini quiz
11. Student explain-back prompt
12. Recap and memory hooks

### 5. Generate segment N

Each segment produces:

- boardScreens
- boardCommands
- voiceScript
- subtitles
- lessonBookPages
- sourceRefs
- quiz/checkpoint
- trace/proof

Frontend plays segment N while backend generates segment N+1.

### 6. Save as flipable teacher book

Every lesson segment is saved as book pages:

```json
{
  "lessonBook": {
    "title": "Sales Reports Queries",
    "pages": [
      {
        "pageNo": 1,
        "sectionId": "why_it_matters",
        "boardScreenIds": ["screen_001", "screen_002"],
        "teacherScript": [],
        "studentNotes": [],
        "sourceRefs": [],
        "keyTakeaways": [],
        "practice": []
      }
    ]
  }
}
```

### 7. Interrupt and resume

When student interrupts:

- pause current command
- save current screen, commandId, voice line, visible PDF region
- classify student question
- generate a repair mini-segment
- answer using same source truth
- resume original lesson at next command

## World-Best Board Command Contract

Every command must have:

```json
{
  "commandId": "cmd_042",
  "screenId": "screen_009",
  "type": "showPdfPageImage",
  "startMs": 120000,
  "endMs": 125000,
  "sourceRefs": [{ "page": 6, "chunkId": "..." }],
  "payload": {
    "imagePath": "/server/public/live-tutor-page-images/.../page-06.png",
    "page": 6
  }
}
```

Pointing commands:

```json
{
  "commandId": "cmd_043",
  "screenId": "screen_009",
  "type": "movePointer",
  "startMs": 125000,
  "endMs": 127000,
  "target": { "x": 0.28, "y": 0.82 },
  "voiceLineId": "voice_043"
}
```

Highlight commands:

```json
{
  "commandId": "cmd_044",
  "screenId": "screen_009",
  "type": "drawCircle",
  "startMs": 127000,
  "endMs": 129000,
  "target": { "x": 0.28, "y": 0.82, "w": 0.48, "h": 0.08 }
}
```

## Sample World-Best Lesson: Sales Reports Queries

This sample uses the current PDF node about sales report queries from pages 5
and 6.

### Section 1: Set The Problem

Screen 1: Big idea

- Board writes: "Sales reports ask business questions from sales data."
- Teacher says: "Before we talk about denormalization, I want you to feel the
  pain first. A manager does not ask for tables. A manager asks business
  questions."
- Board lists:
  - Which products sold most?
  - Which products made most money last month?
  - Who are the top 3 salespeople?
  - Which customers deserve coupons?

Screen 2: Real PDF page read

- Board shows real page 5 image.
- Pointer moves to the list of use cases.
- Circle row 2: "products with most number of sales."
- Teacher says: "Look exactly here. This is not an abstract database exercise.
  This is a real reporting question: which products sold the most?"

Screen 3: Translate business question to data need

- Board table:
  - Business word: product
  - Needed data: product name/id
  - Likely table: Product
  - Business word: sales count
  - Needed data: sale rows
  - Likely table: Sale

### Section 2: First Worked Example

Screen 4: Query 1

- Board writes: "Find products with most number of sales."
- Teacher says: "We count sale records grouped by product. That means the Sale
  table tells us frequency, but the Product table gives the human-readable
  product details."

Screen 5: Draw join path

- Board draws Product -> Sale.
- Teacher points to Sale: "This side gives each purchase event."
- Teacher points to Product: "This side gives product identity and details."

Screen 6: SQL-like thinking

```sql
SELECT product.name, COUNT(*) AS sale_count
FROM Sale
JOIN Product ON Sale.productId = Product.id
GROUP BY product.name
ORDER BY sale_count DESC;
```

- Teacher explains line by line.

### Section 3: Second Worked Example

Screen 7: Query 2

- Board shows real page 6 image.
- Pointer circles: "Previously Product, Sale, Invoice."
- Teacher says: "Now the question changed. It is not just how many sales. It is
  sale amount last month. That adds money and time, so Invoice enters."

Screen 8: Draw join path

- Board draws Product -> Sale -> Invoice.
- Teacher says:
  - "Product answers what item."
  - "Sale answers what was sold."
  - "Invoice answers when and how much money."

Screen 9: Why this is slower

- Board shows cost meter:
  - 2-table join: moderate
  - 3-table join: heavier
  - repeated report: expensive

### Section 4: The Denormalization Need

Screen 10: Real source quote

- Board shows PDF page 6.
- Pointer moves to "Speed up the queries by redundancy."
- Teacher says: "This phrase is the turning point. Denormalization means we add
  carefully chosen duplicate data so repeated reports become faster."

Screen 11: Example redundancy

- Board writes: "What if we keep categoryId in Sale?"
- Teacher says: "If Sale already stores categoryId, a category sales report may
  avoid joining Product and Category every time."

Screen 12: Tradeoff table

| Choice | Benefit | Risk |
| --- | --- | --- |
| Normalized | Clean updates | More joins |
| Denormalized | Faster reports | Duplicate data |

### Section 5: Mistakes And Repairs

Screen 13: Common mistake

- Board writes: "Mistake: denormalize everything."
- Teacher says: "That is not design. That is panic. We only denormalize after a
  repeated query has a real performance need."

Screen 14: Repair

- Board checklist:
  - Is the query repeated?
  - Is the join expensive?
  - Is the duplicate field stable?
  - Can we keep it correct?

### Section 6: Quiz And Explain Back

Screen 15: Quiz

- Question: "For highest sale amount last month, why is Invoice needed?"
- Correct answer: "Because amount/date context usually lives with invoice or
  transaction records."

Screen 16: Explain back

- Prompt: "Explain in your own words why Product + Sale is enough for count,
  but Product + Sale + Invoice is needed for sale amount last month."

## Scaling To 100+ Screens

For beginner 2-hour mode:

- 12 sections
- 8 screens per section average
- 96 screens
- plus 10 interrupt/repair/practice screens
- total: about 100 to 120 screens

Screen count should depend on:

- studentLevel
- node difficulty
- number of source pages
- number of diagrams/tables
- student interruptions
- quiz performance

## Implementation Rules

The system is not allowed to return "world-best" unless:

- boardScreens >= required count for lesson mode
- every factual screen has sourceRefs
- every selected page image has a vision result or explicit skip reason
- PDF image commands point to real image paths
- pointer/circle commands use coordinates from vision packet
- voiceScript length matches boardCommands closely
- subtitles have startMs/endMs
- lessonBook pages are saved
- interrupt route can resume from current command


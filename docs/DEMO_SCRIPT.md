# Demo Script — StudyMind

Target length **5–6 minutes**. One take, screen-recorded at 1280×800.

Have open before recording: the seeded demo account logged in, the landing page,
and `evaluation/results/` open in a second window.

---

## 0:00–0:30 — The problem

> "Students study from lecture videos, textbooks and slides scattered across a
> dozen places. So they ask a general chatbot. And the chatbot answers — fluently,
> confidently, and often wrongly, because it has never seen the syllabus.
>
> StudyMind is a study companion that only answers from your own material, shows
> you exactly which page or slide it used, and refuses when it does not know."

**On screen:** landing page, scroll slowly through Features.

---

## 0:30–1:30 — Upload workflow

1. Go to **Knowledge Base**, drag a PDF onto the drop zone.
2. *Point at the status chip* — queued → extracting → indexing → ready.
   > "It runs in the background. You can leave the page."
3. Click the source row to open the split viewer.
4. *Point at the right pane* — content units, each tagged `p.12`, `Slide 7`,
   `4:12`.
   > "Every unit keeps its origin. That is what makes citation possible."
5. Expand a topic in the Topics tab.
   > "Topics are extracted from the headings in the document — no manual tagging."

**Resilience beat (15s, optional but worth it):** upload a deliberately corrupt
file. It accepts, then flips to `failed` with a readable reason.
> "A bad file gives you a message, never a crash."

---

## 1:30–3:00 — Grounded tutor chat

1. Open **Tutor**. Ask: *"What problem does the Clock replacement algorithm solve?"*
2. *Point at the answer panel* — bordered "From your material" block, citation
   chips underneath.
   > "Every factual sentence is backed by a unit that was actually retrieved."
3. Click a citation chip → side panel opens with the exact location.
4. Now ask something off-material: *"What is the mass of a proton?"*
   *Watch it decline.*
   > "This is the guard. Before generating, we score retrieval. If nothing is
   > close enough, the model is never called — it has no opportunity to invent
   > an answer."
5. Toggle **हिन्दी**, ask one question.
   > "Hindi explanation, English technical terms, citations stay in the original."

---

## 3:00–4:15 — Adaptive assessment

1. Go to **Assessments**. Set: MCQ + short answer + numerical, 6 questions, mode
   *Quiz*. Generate.
2. Answer 2–3 questions. Note the progress bar and the type/difficulty chips.
3. Submit → report page:
   - overall score
   - score-by-topic bars (green/amber/red)
   - misconceptions list
   - time-per-question chart
4. *Point at a weak topic.*
   > "Each question is generated from retrieved units, verified against its own
   > source, and tagged to a topic. It is not marked verified until it passes
   > verification."

**Dedupe beat (10s):** press "Take another".
> "Retaking does not repeat questions — an exact hash, a normalised edit
> distance, and an embedding cosine all have to pass."

---

## 4:15–5:15 — Mastery, dashboard, architecture

1. **Mastery** page — table with mastery %, confidence label, sparklines, and the
   mastery-over-time chart.
   > "Bayesian knowledge tracing per topic, with a forgetting curve on top.
   > Confidence stays low until enough attempts accumulate, so the number never
   > pretends to be more precise than it is."
2. **Dashboard** — KPI row, mastery-by-topic bars, "Next best to study" with the
   reason string ("Not reviewed in 9 days"), activity feed.
3. **Course Map** — hover a node.
   > "Topics and prerequisites, coloured by mastery."
4. Switch to the evaluation window.
   > "We report measured numbers, including the weak ones. Refusal accuracy
   > 1.00, faithfulness 1.00. Citation accuracy is 0.33 — that is our weakest
   > number and we have written up why."

---

## 5:15–6:00 — Architecture recap

On the landing **Architecture** section, or this slide:

- Browser → Express API → MongoDB / Gemini
- Ingestion workers: PDF · PPTX · image · video → chunks + embeddings
- **Every AI call goes through one provider module.** Swapping models touches
  business logic nowhere.

Close on the architecture section of the landing page.

---

## If asked: "how do you know it doesn't hallucinate?"

Two guards, both measurable:

1. **Pre-generation gate.** Retrieval is scored on two signals (cosine similarity
   *or* question-word coverage). If neither clears its threshold we decline
   without calling the model. The threshold was calibrated, not guessed — 10/10
   in-material questions kept, 14/14 off-material declined.
2. **Post-generation citation audit.** Any citation pointing at a unit that was
   not actually retrieved is stripped before display, and the count is logged.
   The UI shows it: "N unverified citations removed."

## If asked: "what are your weaknesses?"

- Citation accuracy is the weakest measured number (0.33). The tutor cites every
  unit it drew from; our test set usually names one.
- The offline provider answers extractively, so answers are longer than a
  question strictly needs. Relevancy is 0.44.
- The personalization numbers are **simulated** — they measure the question
  scheduler, not real students.
- Video/audio ingestion needs ffmpeg and a real transcription API; we have only
  verified it structurally.

All four are in the README under "Honest findings".
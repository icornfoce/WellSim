# WellSim — What to Collect Next, and What to Rebuild

Two lists, ordered by how much each one buys you.

---

# Part 1 — Patient data worth collecting

The screening engine currently fuses **acoustics + 6 vitals**. Everything
below is judged on one question: *does it change a triage decision?* Fields
that merely look thorough on a form are excluded.

## Tier 1 — changes triage today, cheap to collect

| Field | Why it changes the answer |
|---|---|
| **Smoking history** (pack-years, current/ex/never) | The single strongest COPD predictor. A wheeze in a 40 pack-year smoker and a wheeze in a never-smoker are different problems. Free to ask. |
| **Symptom duration** (days) | Separates acute from chronic. 3 days of crackles → pneumonia; 3 years → fibrosis. The audio cannot tell you this. |
| **Fever / measured temperature** | Crackles + fever ≈ pneumonia. Crackles without fever ≈ oedema or fibrosis. Your ESP32 already reports a temperature field that nothing currently uses. |
| **Respiratory rate** (manual count) | A core sepsis and respiratory-failure criterion, and the earliest sign to move. The engine estimates it from the envelope — a manual count validates that estimate. |
| **Known diagnoses** (asthma, COPD, TB, heart failure, diabetes) | Changes the prior completely. Wheeze in known asthma = exacerbation protocol, not a new workup. |
| **Current medications** (esp. inhalers, β-blockers, ACE inhibitors) | β-blockers mask tachycardia; ACE inhibitors cause dry cough — a cough your engine will classify as pathological. |
| **Auscultation site** (RUL/RML/RLL/LUL/LLL, anterior/posterior) | Crackles at one base vs both bases is the difference between pneumonia and heart failure. **This is the highest-value field on the list** and costs one tap: the same sound means different things depending on where it was taken, and right now you are discarding that. |

## Tier 2 — needed for the field trial and for regulatory defensibility

| Field | Why |
|---|---|
| **Informed consent record** (timestamp, version, who obtained it) | Your proposal promises PDPA compliance. Right now nothing records consent. An ethics committee will ask for this first. |
| **Reference standard** (chest X-ray result, physician's final diagnosis, ICD-10) | Without ground truth you cannot compute sensitivity or specificity. Phase 2 is impossible without this field. |
| **Ambient noise / recording conditions** | Explains outlier results and tells you where the device fails in real clinics. |
| **Operator identity** | Lets you detect that one health worker's recordings are systematically unusable — a training problem, not a model problem. |
| **Repeat-recording flag** | If a nurse re-records three times, the first two are informative about usability. |

## Tier 3 — later, higher cost

SpO₂ trend over time (not just a spot value) · peak flow / spirometry ·
BMI trajectory · vaccination status · occupational and biomass-smoke exposure
(major COPD driver in rural Thailand) · household TB contact.

## What NOT to collect

National ID, address, phone, ethnicity, income — none of it changes a triage
decision, and every one of them raises your PDPA exposure and the harm done
if you are breached. Collect the minimum that changes care. That restraint is
itself a defensible design decision to present.

---

# Part 2 — Systems to rebuild

Ordered by risk × effort.

## 🔴 Priority 1 — will break in the field

### JSON file storage → PostgreSQL
`readDB` / `writeDB` is read-modify-write over the whole file with no
locking. Two nurses saving at once means one update is silently lost — in a
medical record. It also re-parses every patient to answer any query.
→ Postgres, or SQLite if you want zero-ops. The `dbService` interface
already isolates this; the swap touches one file.

### No offline mode
The premise is remote clinics with poor connectivity, yet every action needs
a live server. A dropped connection mid-recording loses the recording.
→ IndexedDB queue in the browser + service worker, syncing when the network
returns. **This is the change most aligned with the project's own stated
purpose**, and it demos well.

### No audit trail
For a medical record, every read and write should be attributable and
immutable. Currently only reviews and deletions go to stdout, which Render
discards on restart.
→ Append-only `audit_log` table: who, what, when, from where.

## 🟠 Priority 2 — needed to make the accuracy claims

### The classifier itself
`wellsim-dsp-baseline-v0.1` is deterministic DSP, not a trained model, and
you cannot quote sensitivity or specificity until it is validated.
→ Validate the baseline against ICBHI 2017 first — that produces your first
defensible number. Then train a CNN on the log-Mel tensors the pipeline
already emits, and keep the DSP baseline as the fallback.

### Session handling
Tokens sit in `localStorage`, so any XSS takes a session, and there is no
revocation — a stolen token stays valid for 24 hours.
→ httpOnly cookies + CSRF tokens, short-lived access tokens with refresh,
and a revocation list.

### Rate limiting is per-instance and in-memory
Fine for one server, useless the moment Render scales to two.
→ Redis-backed.

## 🟡 Priority 3 — quality and credibility

- **Automated test suite in CI.** You have `test/validate.js` (47 assertions)
  and the audit script, but nothing runs them automatically. A GitHub Action
  on every push stops regressions.
- **Structured logging.** `console.log` with emoji is unsearchable. Pino with
  request IDs, and never log patient identifiers.
- **Uploaded audio is unencrypted at rest** on the server filesystem, and
  file names embed device ID and timestamp. → Encrypt at rest; use opaque
  UUID filenames.
- **No data retention policy.** PDPA expects a defined lifetime. → Automatic
  purge after N months, configurable.
- **Frontend state is all in one 1,700-line component.** Painful to test and
  to hand over. → Extract data fetching into hooks.
- **No accessibility pass.** Clinical software gets used by tired people on
  bad screens. Colour alone currently distinguishes triage levels — that
  fails for the ~8% of males with colour vision deficiency. The `▲` marks
  help; make that consistent everywhere.

## What is already solid — leave it alone

The DSP layer, the physician-review workflow and its server-side role gate,
the feedback loop, and the honest handling of unreadable audio. These are the
parts that make the project defensible. Don't refactor them for style.

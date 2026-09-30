# MINAGRI DATA INTELLIGENCE PLATFORM

## Competition-Grade AI Agricultural Data Quality & Intelligence System

You are a senior product engineer, AI/ML engineer, UX engineer, and software architect.

We are building a competition-grade prototype called:

**MINAGRI DATA INTELLIGENCE PLATFORM**

The goal is to transform raw agricultural datasets, especially Rwanda e-Soko market price data, into clean, validated, explainable, trusted data that can support agricultural decision-making.

This is NOT a generic CRUD dashboard.

The product must feel like a real government-grade AI data platform that could realistically be adopted by MINAGRI.

The project will be judged heavily on:

1. User experience
2. Visual quality
3. Innovation
4. Real AI functionality
5. Practical impact
6. Explainability
7. Data visualization
8. Demonstration quality
9. Ease of use
10. Technical credibility

Build the product so that a judge can understand its value within the first 30 seconds.

---

# 1. CORE PRODUCT VISION

The platform follows this pipeline:

RAW DATA
↓
UPLOAD
↓
AUTOMATIC DATA PROFILING
↓
STANDARDIZATION
↓
DEDUPLICATION
↓
VALIDATION
↓
AI ANALYSIS
↓
ANOMALY DETECTION
↓
ENTITY / NAME MATCHING
↓
DATA COMPLETENESS ANALYSIS
↓
HUMAN REVIEW
↓
TRUSTED DATASET
↓
AGRICULTURAL INSIGHTS

The user should NOT need technical knowledge.

The system should explain what it is doing automatically.

Avoid forcing users through many forms and configuration screens.

The principle is:

**"Upload once. The platform does the work."**

---

# 2. IMPORTANT UX PRINCIPLE

The platform must be self-explanatory.

A first-time user should be able to:

1. Upload a CSV
2. Wait while the system analyzes it
3. See what was discovered
4. Review only problematic records
5. Approve/fix them
6. Download or explore the trusted dataset

No lengthy onboarding.

No complicated configuration.

No unnecessary clicks.

Use progressive disclosure.

Show advanced information only when needed.

---

# 3. MAIN APPLICATION STRUCTURE

Create the following application structure:

## Main navigation

* Overview
* Data
* Upload
* AI Quality
* Review Center
* Markets
* Commodities
* Insights
* Data Lineage
* Settings

The most important workflow should remain:

**Upload → AI Analysis → Review → Trusted Dataset**

---

# 4. LANDING / OVERVIEW DASHBOARD

Create a premium government-data dashboard.

The first screen should immediately communicate:

### MINAGRI DATA INTELLIGENCE

"From raw agricultural data to trusted insights."

Hero metrics:

* 134 Commodities
* 67 Markets
* 5 Provinces
* 1,096+ Price Records
* Data Quality Score
* Anomalies Detected
* Records Validated

Do not invent statistics dynamically.

Use the actual dataset when available.

Create a prominent CTA:

**Upload Agricultural Data**

Secondary CTA:

**Explore Trusted Dataset**

---

# 5. DATA UPLOAD EXPERIENCE

Create an excellent drag-and-drop upload interface.

Supported:

* CSV
* XLSX if practical

When a file is uploaded:

DO NOT immediately send the user to another complicated form.

Instead show:

### "Analyzing your dataset..."

Animated pipeline:

1. Reading file
2. Detecting columns
3. Profiling data
4. Matching catalog
5. Checking duplicates
6. Detecting anomalies
7. Validating records

Use progress states.

Example:

```
✓ File loaded
✓ 1,096 records detected
✓ 12 columns detected
✓ Commodity catalog matched
✓ Duplicate analysis completed
⟳ AI anomaly analysis
○ Human review
```

The UI should make the AI feel real without using fake loading animations.

---

# 6. AUTOMATIC DATA PROFILING

After upload, automatically determine:

* number of rows
* number of columns
* missing values
* duplicate rows
* unique commodities
* unique markets
* provinces
* date coverage
* numeric columns
* categorical columns
* suspicious values
* inconsistent units
* inconsistent names

Generate a visual:

### DATA QUALITY SCORE

Example:

**87 / 100**

Break it down:

* Completeness: 92%
* Consistency: 89%
* Uniqueness: 96%
* Validity: 84%
* AI Confidence: 81%

Make the score explainable.

Clicking the score should show exactly how it was calculated.

---

# 7. DATA PROCESSING ENGINE

Implement real preprocessing.

## Standardization

Normalize:

* column names
* whitespace
* capitalization
* date formats
* numeric values
* currency
* measurement units
* commodity names
* market names

For example:

```
"Sweet Potato"
"sweet potato"
"SWEET POTATO"
" Ibijumba "
```

should be normalized appropriately.

DO NOT destroy the original value.

Keep:

* original_value
* normalized_value

This is important for auditability.

---

# 8. DEDUPLICATION ENGINE

Implement actual duplicate detection.

Use multiple levels:

### Exact duplicates

Same:

* date
* market
* commodity
* price type

### Near duplicates

Detect records that are almost identical.

For example:

```
Nyabugogo
Nyabugogo Market
Nyabugogo market
```

should be candidates for matching.

Do not automatically delete uncertain duplicates.

Classify:

* Exact duplicate
* Probable duplicate
* Possible duplicate
* Unique

Every automated decision must be explainable.

---

# 9. ENTITY / NAME MATCHING AI

Implement real entity matching.

This is one of the important AI features.

The dataset may contain:

```
Ibijumba
Sweet Potato
sweet potatoes
Sweet potato
```

The system should identify that these may represent the same commodity.

Use a combination of:

1. normalization
2. exact matching
3. fuzzy matching
4. token similarity
5. optional embeddings

Do NOT use embeddings for everything.

Use a lightweight hybrid approach.

Example:

```
Input:
"Ibijumba"

Matched entity:
"Sweet Potato"

Confidence:
94%

Reason:
Name similarity + catalog mapping
```

For uncertain matches:

```
"Potato"

Possible matches:

Irish Potato      78%
Sweet Potato      64%

Needs human review
```

This is much better than blindly assigning a label.

---

# 10. AI ANOMALY DETECTION

This is the main AI component.

Implement a practical hybrid anomaly detection engine.

Use:

### Layer 1 — Rule-based validation

Detect:

* negative prices
* zero prices
* impossible values
* missing required fields
* invalid dates
* invalid market
* invalid commodity
* invalid unit

### Layer 2 — Statistical anomaly detection

For agricultural prices, implement methods such as:

* IQR
* Z-score
* robust Z-score / MAD

Where enough data exists.

### Layer 3 — Contextual anomaly detection

Compare price against:

* same commodity
* same market
* same date
* other markets
* farm-gate price
* wholesale price
* retail price

Example:

If:

Farm = 600
Wholesale = 700
Retail = 1,500

flag:

**Unusual retail price**

### Layer 4 — Optional ML model

Use Isolation Forest where the data volume supports it.

Features can include:

* price
* commodity
* market
* province
* price channel
* price difference
* price ratio
* historical statistics
* market statistics

Do not force ML where a statistical method is more explainable.

---

# 11. ANOMALY EXPLANATIONS

This is extremely important.

Never show only:

> "Anomaly detected."

Instead show:

### WHY WAS THIS FLAGGED?

Example:

```
Retail price: 1,500 RWF/kg

Expected range:
700 – 1,050 RWF/kg

Observed:
1,500 RWF/kg

Deviation:
+54%

Reason:
Price is significantly higher than comparable
observations for this commodity.

AI confidence:
91%
```

Give users:

**Accept**
**Correct**
**Ignore**
**Investigate**

---

# 12. FARM → WHOLESALE → RETAIL LOGIC

Use the structure of the e-Soko dataset.

Expected relationship:

```
Farm Gate ≤ Wholesale ≤ Retail
```

Detect violations.

Example:

```
Farm gate: 1,200
Wholesale: 900
Retail: 1,100

⚠ Pricing ladder violation
```

Explain:

"Wholesale price is lower than farm-gate price."

This is a highly understandable AI/data-quality demonstration for judges.

---

# 13. DATA COMPLETENESS ENGINE

Analyze geographical coverage.

Example:

```
Markets:
11 / 67 reporting

Coverage:
16%

Northern Province:
No observations detected
```

Visualize this using a Rwanda map if practical.

Show:

* reporting markets
* missing markets
* province coverage
* district coverage
* commodity coverage

The system should distinguish:

**No data**

from

**Zero price**

These are NOT the same.

---

# 14. REVIEW CENTER

This should be one of the strongest screens.

Do not show users thousands of records.

Prioritize problems.

Example:

### AI REVIEW QUEUE

```
23 Critical
8 Conflicts
17 Possible Duplicates
12 Name Matches
```

Each issue becomes a review card.

Example:

---

### ⚠ Unusual Price

Sweet Potato

Market:
Nyabugogo

Observed:
800 RWF/kg

Expected:
400–650 RWF/kg

Confidence:
93%

[Accept] [Correct] [Ignore]

---

The reviewer should be able to resolve an issue without leaving the screen.

Keyboard shortcuts can be added later.

---

# 15. TRUSTED DATASET

After review, generate a trusted dataset.

Show:

### TRUST SCORE

**94 / 100**

Then:

```
1,219 Validated
23 Resolved
8 Ignored
0 Critical Issues
```

Provide:

* Download CSV
* Export JSON
* View dataset
* Data lineage
* Quality report

The system must preserve the original dataset.

Never overwrite raw data.

Architecture:

```
RAW
↓
PROCESSED
↓
REVIEWED
↓
TRUSTED
```

---

# 16. DATA LINEAGE

Build a simple lineage visualization.

Example:

```
eSoko CSV
    ↓
Raw Dataset
    ↓
Standardization
    ↓
Deduplication
    ↓
Validation
    ↓
AI Analysis
    ↓
Human Review
    ↓
Trusted Dataset
```

For every transformed record, allow the user to see:

* original value
* transformed value
* rule/model applied
* timestamp
* confidence
* reviewer decision

This creates government-grade auditability.

---

# 17. AGRICULTURAL INSIGHTS DASHBOARD

After data is trusted, show useful insights.

Include:

### Price Overview

Farm gate vs wholesale vs retail.

### Market Comparison

Example:

```
Commodity: Avocado

Cheapest:
Bugarama — 600 RWF

Highest:
Kibuye — 1,200 RWF
```

### Market Price Variation

Use charts.

### Commodity Distribution

### Province Coverage

### Data Quality

### Price Markup

Farm → Wholesale → Retail

---

# 18. IMPORTANT DATASET FACTS

The current demonstration dataset is an e-Soko snapshot for:

**28 September 2026**

It contains approximately:

* 134 commodities
* 5 provinces
* 67 markets
* 29 districts
* 366 farm-gate records
* 365 wholesale records
* 365 retail records

The dataset has limited daily coverage.

Do NOT present missing markets as zero prices.

The Northern Province currently has no observations in this snapshot.

The platform should communicate this clearly.

---

# 19. VISUAL DESIGN

Design language:

### Government + Modern AI + African Agriculture

Use:

* deep green
* agricultural green
* Rwanda-inspired blue
* white
* subtle gold/orange accents

Avoid excessive gradients.

Avoid generic SaaS purple dashboards.

Use:

* rounded cards
* subtle borders
* clean typography
* large numbers
* whitespace
* meaningful icons
* restrained shadows

The UI should look like a serious national data platform.

---

# 20. RESPONSIVE DESIGN

Must work well on:

* desktop
* laptop
* tablet

Desktop is the primary target.

Optimize especially for a presentation/demo on a large screen.

---

# 21. MAP

If a Rwanda map is practical, implement it.

Show:

* province coverage
* market locations
* data availability

Use a clear legend.

Clicking a province should filter the dashboard.

Clicking a market should show:

* market name
* district
* province
* number of observations
* commodities
* price statistics
* data quality

---

# 22. AI ARCHITECTURE

Keep the architecture understandable.

Recommended structure:

```
frontend/
    components/
    pages/
    features/
    charts/
    maps/

backend/
    api/
    services/
    processing/
    validation/
    anomaly/
    matching/

ml/
    anomaly_detection/
    entity_matching/
    feature_engineering/

data/
    raw/
    processed/
    trusted/
```

Separate:

### deterministic rules

from

### statistical models

from

### ML models.

Do not create a giant AI function.

---

# 23. MODEL IMPLEMENTATION

Create a modular AI service.

Example:

```
DataQualityEngine
    ├── SchemaValidator
    ├── Standardizer
    ├── DuplicateDetector
    ├── EntityMatcher
    ├── StatisticalAnomalyDetector
    ├── IsolationForestDetector
    └── QualityScorer
```

Each module returns structured results.

Example:

```json
{
  "record_id": "123",
  "issue_type": "PRICE_ANOMALY",
  "severity": "HIGH",
  "confidence": 0.93,
  "explanation": "Retail price is 54% above expected range",
  "recommendation": "Review record"
}
```

---

# 24. MODEL EXPLAINABILITY

Every AI result must contain:

* prediction
* confidence
* reason
* supporting evidence
* recommended action

Never create a black-box interface.

Judges should be able to understand:

**WHAT**
**WHY**
**HOW CONFIDENT**

---

# 25. DEMO MODE

Create a polished demo mode.

We need to be able to demonstrate the complete story quickly.

Create a sample dataset based on the Rwanda e-Soko structure.

Include deliberately injected issues:

1. Duplicate record
2. Misspelled commodity
3. Misspelled market
4. Impossible price
5. Farm > wholesale
6. Wholesale > retail
7. Extreme price anomaly
8. Missing province
9. Missing commodity
10. Missing price

The system should automatically detect these.

This allows the judges to see the AI working.

IMPORTANT:

Clearly label synthetic/injected demo anomalies as demo data.

Do not present fabricated results as real MINAGRI statistics.

---

# 26. DEMO STORY

The ideal demo should take approximately 3–5 minutes.

Sequence:

### STEP 1

Open dashboard.

Show:

"Your agricultural data quality today."

### STEP 2

Click:

**Upload Data**

### STEP 3

Upload eSoko CSV.

### STEP 4

System automatically analyzes it.

Show animated but truthful progress.

### STEP 5

Show:

```
1,096 records analyzed

87/100 Data Quality

23 anomalies
8 conflicts
17 duplicates
12 entity matches
```

Use actual calculated numbers when possible.

### STEP 6

Open Review Center.

Show one anomaly.

Explain WHY AI flagged it.

### STEP 7

Resolve it.

### STEP 8

Show the data quality score improving.

Example:

```
87 → 94
```

Only use this if the calculation actually changes.

### STEP 9

Open Trusted Dataset.

### STEP 10

Show agricultural insights.

End with:

**"From raw data to trusted decisions."**

---

# 27. PERFORMANCE

The application should feel fast.

Use:

* lazy loading
* pagination
* memoization
* efficient chart rendering
* background processing where appropriate

Do not load thousands of records into the browser unnecessarily.

---

# 28. ERROR HANDLING

Never show raw technical errors to users.

Instead:

```
We couldn't process this file.

Possible reasons:
• Unsupported format
• Missing required columns
• Corrupted data

[View details]
```

Advanced technical details can be expandable.

---

# 29. EMPTY STATES

Every empty state should explain itself.

Example:

Instead of:

"No data"

show:

### No market data available

"No observations were submitted for Northern Province
in this dataset."

This distinction is important.

---

# 30. SECURITY / DATA INTEGRITY

Implement:

* file validation
* file size limits
* safe parsing
* schema validation
* audit logs
* immutable raw dataset
* sanitized input
* controlled exports

Never allow processing to silently modify original data.

---

# 31. TECHNICAL QUALITY

Before implementing anything:

FIRST inspect the existing repository.

Identify:

* framework
* package manager
* current architecture
* database
* existing components
* existing APIs
* environment variables
* existing ML code

DO NOT unnecessarily rewrite the project.

Reuse existing code where appropriate.

If the project is empty, establish a clean architecture.

---

# 32. IMPLEMENTATION PHASES

Implement in this order.

## PHASE 1 — Foundation

Build:

* application shell
* navigation
* theme
* dashboard
* upload page
* responsive layout

## PHASE 2 — Data Engine

Implement:

* CSV parser
* schema detection
* profiling
* standardization
* validation
* deduplication

## PHASE 3 — AI

Implement:

* anomaly detection
* price ladder detection
* entity matching
* completeness detection
* quality scoring

## PHASE 4 — Review

Build:

* Review Center
* issue queue
* issue details
* accept/correct/ignore
* audit trail

## PHASE 5 — Trusted Dataset

Build:

* trusted dataset
* export
* lineage
* quality report

## PHASE 6 — Insights

Build:

* market dashboard
* commodity dashboard
* price comparison
* geographical coverage
* trend/variation charts

## PHASE 7 — DEMO POLISH

Improve:

* animations
* transitions
* empty states
* loading states
* error states
* tooltips
* micro-interactions
* responsive behavior

---

# 33. DO NOT DO THESE THINGS

DO NOT build:

* generic CRUD pages
* unnecessary forms
* fake AI
* fake statistics
* meaningless animations
* excessive gradients
* giant tables as the main UI
* unexplained AI predictions
* black-box ML
* unnecessary authentication complexity for the prototype
* dozens of configuration pages

Do not optimize for number of features.

Optimize for:

**clarity + impact + intelligence + usability.**

---

# 34. SUCCESS CRITERIA

The finished application should make a judge think:

"Instead of manually checking agricultural datasets, this system automatically finds problems and tells the user what needs attention."

A user should be able to understand the entire system without training.

The strongest visible story should be:

```
RAW DATA
     ↓
AI UNDERSTANDS IT
     ↓
AI FINDS PROBLEMS
     ↓
HUMAN REVIEWS
     ↓
TRUSTED DATA
     ↓
BETTER AGRICULTURAL DECISIONS
```

---

# 35. FINAL ENGINEERING REQUIREMENT

Do not stop after creating the UI mockup.

Implement actual working functionality.

The following must work:

* upload CSV
* parse CSV
* profile dataset
* detect missing values
* standardize fields
* detect duplicates
* match commodity names
* detect anomalous prices
* detect farm/wholesale/retail inconsistencies
* calculate quality score
* display AI explanations
* review issues
* resolve issues
* generate trusted dataset
* export trusted dataset
* visualize agricultural statistics

Use real calculations.

Where ML is appropriate, use a real model.

Where deterministic/statistical methods are more appropriate, use them instead.

The platform should demonstrate that AI is being used intelligently, not merely because the project is called an AI project.

---

# 36. START NOW

Before writing code:

1. Inspect the repository.
2. Identify the existing stack.
3. Identify existing data files.
4. Identify existing ML code.
5. Identify reusable components.
6. Produce a concise implementation plan.
7. Then begin implementation.

Do not ask me to manually create every file.

Make sensible engineering decisions yourself.

Implement incrementally.

After each major phase, verify that the application still runs.

Prioritize the complete end-to-end workflow before adding secondary features.

The final result must feel like a **real MINAGRI AI data intelligence product**, not a student CRUD application.

The guiding principle throughout implementation is:

**"Make the complex invisible to the user."**

Build something that is technically credible, visually exceptional, genuinely useful, and compelling in a live competition demonstration.

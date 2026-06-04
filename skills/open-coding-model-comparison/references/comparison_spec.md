# 5.5 vs 5.4 vs 5.4mini Open-Coding Comparison Spec

## Purpose

This project compares three batch-generated grounded-theory open-coding result sets for the same AI-related transcript corpus:

- `results/5.5`
- `results/5.4`
- `results/5.4mini`

The goal is not to declare a single model "correct" without a human gold standard. The goal is to characterize how each model behaves as a qualitative coding instrument: coverage, sensitivity, boundary discipline, evidence segmentation, coding granularity, label stability, and audit readiness.

## Source Data

The authoritative input for this comparison is each model's per-meeting open-coding JSON:

```text
results/<model>/01_companies/company_<companyid>/02_open_coding/<keydevid>.json
```

Each file is expected to contain a JSON array of meaning units. Each meaning unit should include:

- `analysis_type`
- `unit_id`
- `text`
- `ai_relevance`
- `confidence`
- `codes`

Each code should include:

- `class`
- `code_id`
- `text`
- `label`
- `rationale`

## Comparison Questions

1. **Batch completeness:** Did each model produce outputs for the same companies and meetings?
2. **AI-detection sensitivity:** Which model identifies more substantive AI discussion?
3. **Boundary discipline:** Which model is more likely to include generic digital, data, analytics, cloud, automation, or software discussion without explicit AI evidence?
4. **Evidence segmentation:** Do models select the same transcript evidence, or do they differ by unit boundaries, merging, and splitting?
5. **Open-coding granularity:** Which model produces richer or more fragmented codes per unit?
6. **Label consistency:** Do models express the same grounded concepts with different labels?
7. **Semantic canonical consistency:** After preserving raw labels, do models converge when synonymous code labels are mapped to conservative canonical codes?
8. **Research usability:** Which model is better suited for downstream axial coding, audit, and codebook construction?
9. **Cost efficiency:** Which model produces usable qualitative coding outputs at lower Batch API cost?
10. **Prompt design effects:** Which observed differences are likely caused or amplified by prompt ambiguity around AI boundaries, segmentation, confidence, code splitting, or schema discipline?

## Metric Families

### 1. Structural Completeness

Computed per model and per meeting:

- output file count
- company count
- missing meeting files relative to the union of all models
- empty JSON file count
- invalid JSON count
- malformed top-level output count

Interpretation:

- Missing or empty files are not necessarily model failures, but they affect paired comparison.
- A model with more files may have broader batch coverage, but this can also reflect collection differences.

### 2. Schema And Evidence Discipline

Validation checks:

- top-level JSON is an array
- `analysis_type === "open_coding"`
- `confidence` is `high` or `medium`
- `codes` is an array
- each `code.text` is contained in its parent `unit.text`
- missing key fields are counted

Interpretation:

- These are format and traceability checks, not substantive judgments.
- A violation reduces auditability even if the high-level label seems plausible.

### 3. AI-Detection Sensitivity

Computed per model:

- nonempty meeting count
- nonempty meeting rate
- total meaning units
- total codes
- high-confidence units
- medium-confidence units
- average units per nonempty meeting
- average codes per unit

Interpretation:

- More units can mean higher sensitivity, finer segmentation, or weaker boundary discipline.
- This metric must be read together with boundary risk and evidence matching.

### 4. Evidence Matching

Because batch outputs may contain substantively identical content with different `unit_id`, unit boundaries, or sentence spans, this comparison uses three matching levels.

#### Exact Text Match

Normalized unit text is exactly equal after:

- lowercasing
- whitespace normalization
- trimming

This is the strictest and most conservative match.

#### Containment Match

One normalized unit text contains the other. This captures boundary differences such as one model selecting one sentence while another selects the same sentence plus surrounding context.

#### Fuzzy Evidence Match

Two unit texts are fuzzy matched using token Jaccard overlap:

```text
token_jaccard = shared_tokens / union_tokens
```

A match is treated as fuzzy evidence overlap when:

```text
token_jaccard >= 0.55
```

The threshold is designed for audit triage, not final qualitative adjudication.

### 5. Consensus Levels

For each meeting, units can be grouped into evidence clusters across models:

- `3_model_consensus`: matched evidence appears in all three models
- `2_model_consensus`: matched evidence appears in two models
- `model_unique`: evidence appears only in one model

Interpretation:

- Consensus units are more stable candidates for downstream axial coding.
- Unique units should be audited for either added insight or boundary overreach.

### 6. Label And Code Comparison

Labels are compared at two levels.

#### Normalized Exact Label

Label text is normalized by:

- lowercasing
- punctuation removal
- whitespace normalization

This captures near-identical labels.

#### Lexical Label Family

A lightweight lexical family is created by:

- lowercasing
- removing stopwords
- removing common coding verbs where they do not carry substantive meaning
- applying simple suffix trimming
- sorting remaining content tokens

Examples:

- `applying AI to drug discovery`
- `using AI in drug discovery`

may fall into a similar lexical family when they share the key content tokens `ai`, `drug`, `discover`.

Interpretation:

- This is not a full semantic embedding model.
- It is a reproducible approximation for finding likely label variants that deserve human review.

#### Evidence-Aware Semantic Canonicalization

The comparison also builds a post-processing canonical code layer:

- every raw code is flattened into `all_open_codes_long.csv`
- original `label`, `code.text`, `rationale`, unit text, source JSON path, model, company, meeting, and evidence cluster are preserved
- each raw code receives `canonical_code_id`, `canonical_label`, and `canonical_signature`
- global canonical merging is conservative and requires a specific semantic signature, not broad two-token signatures such as `ai capability`
- within the same evidence cluster, semantically similar labels may be mapped to the same canonical code even when raw wording differs

Interpretation:

- Canonicalization is for agreement testing and codebook construction; it is not a retroactive edit of open coding outputs.
- Raw label disagreement and canonical-code agreement should be reported together.
- Any high-frequency canonical group with many raw-label variants should be audited in `semantic_duplicate_audit.csv`.

### 7. Boundary Risk Audit

Each meaning unit receives a lexical evidence class:

- `explicit_ai`: contains clear AI-specific terms such as AI, artificial intelligence, machine learning, generative AI, LLM, training, inference, neural network, computer vision, NLP, AI chip, accelerator, model training, or autonomous system.
- `possible_ai_technical`: lacks explicit AI terms but contains model-driven or prediction-related signals such as predictive model, recommendation, personalization, recognition, natural language, speech recognition, optimization model, or algorithmic decision.
- `generic_digital_risk`: lacks explicit AI terms but contains broad technology terms such as digital, data-driven, analytics, cloud, automation, CRM, software, e-commerce, platform, or data center.
- `no_lexical_ai_signal`: lacks the above lexical signals.

Important: `generic_digital_risk` is not automatically wrong. It means the unit should be audited because the original prompt excludes generic digitalization, analytics, cloud, or automation when AI context is not locally established.

### 8. Granularity And Segmentation

Computed per model:

- average words per unit
- median words per unit
- average codes per unit
- percent of units with 1, 2, 3, or 4 codes
- unit count differences per shared meeting
- code count differences per shared meeting

Interpretation:

- More codes per unit suggests richer open coding, but may also increase fragmentation.
- Longer units may preserve context, but may be less precise as meaning units.

### 9. Batch API Cost Efficiency

Cost should be computed from raw batch response usage when available:

```text
results/<model>/09_logs/raw_batch_responses/**/<companyid>_<keydevid>.json
```

The implementation should read:

- `response.body.usage.input_tokens`
- `response.body.usage.input_tokens_details.cached_tokens`
- `response.body.usage.output_tokens`
- `response.body.usage.total_tokens`

Pricing source:

- OpenAI API pricing page, checked on 2026-06-03.
- Standard prices per 1M tokens:
  - GPT-5.5: input $5.00, cached input $0.50, output $30.00
  - GPT-5.4: input $2.50, cached input $0.25, output $15.00
  - GPT-5.4 mini: input $0.75, cached input $0.075, output $4.50
- The pricing page states that Batch API saves 50% on inputs and outputs. Therefore this report computes effective Batch rates as 50% of the standard input, cached input, and output rates.

Formula:

```text
uncached_input_tokens = input_tokens - cached_tokens
batch_cost =
  uncached_input_tokens / 1,000,000 * batch_input_price
  + cached_tokens / 1,000,000 * batch_cached_input_price
  + output_tokens / 1,000,000 * batch_output_price
```

Cost-efficiency metrics:

- total estimated Batch cost
- cost per output file
- cost per nonempty meeting
- cost per meaning unit
- cost per open code
- cost per high-confidence unit
- cost per explicit-AI unit
- cost per non-generic-risk unit

Interpretation:

- Lower cost per unit is not automatically better if the model includes lower-quality or boundary-risk units.
- Higher-cost models may still be preferable if they produce more auditable, granular, or theoretically useful codes.
- Cost comparison should be read together with validation issues and boundary-risk rates.

### 10. Prompt Design Audit

Prompt design should be evaluated because model differences are partly a function of how each model interprets the same instructions.

Audit dimensions:

- `AI boundary definition`: Whether the prompt's inclusion/exclusion rules reduce generic digital/data/cloud/analytics over-inclusion.
- `Meaning-unit segmentation`: Whether "shortest continuous substring" and "1-2 sentences" are sufficient to produce stable unit boundaries.
- `Open-code granularity`: Whether "1-4 codes" gives too much discretion in code splitting.
- `Confidence calibration`: Whether high/medium rules reliably separate explicit AI from implicit AI context.
- `Evidence discipline and JSON schema`: Whether copy-exactly and JSON-only rules are followed.
- `Cross-model reproducibility`: Whether the same prompt yields shared evidence clusters across models.

Recommended prompt-audit outputs:

- observed metric signal
- assessment of the prompt design issue
- suggested prompt improvement

Interpretation:

- Prompt audit is not a retroactive correction of coding results.
- Prompt audit explains why some cross-model differences appear and guides future prompt versions.
- Prompt changes should be tested on the same input subset before rerunning the full corpus.

## Deliverables

The implementation should write all outputs under:

```text
analysis/model_comparison/
```

Required outputs:

- `benchmark_input_summary.csv`
- `benchmark_model_request_summary.csv`
- `model_level_summary.csv`
- `meeting_level_comparison.csv`
- `pairwise_meeting_differences.csv`
- `unit_matching_table.csv`
- `label_family_comparison.csv`
- `all_open_codes_long.csv`
- `canonical_codebook.csv`
- `semantic_duplicate_audit.csv`
- `canonical_consistency_by_evidence_cluster.csv`
- `model_semantic_agreement_summary.csv`
- `model_semantic_code_summary.csv`
- `boundary_risk_audit.csv`
- `cost_efficiency_summary.csv`
- `prompt_design_audit.csv`
- `improved_open_coding_prompt_v2.md`
- `disagreement_examples.json`
- `model_comparison_report.html`
- `report_data.json`

PDF outputs are intentionally not generated; the HTML report is the canonical readable report.

Human-audit source links:

- `model_comparison_report.html` should include relative `開啟 JSON / Open JSON` links for boundary-risk examples and model-unique evidence examples.
- `boundary_risk_audit.csv` should include `source_json`.
- `unit_matching_table.csv` should include `model_a_source_json` and `model_b_source_json`.
- `all_open_codes_long.csv` should preserve raw code text and add canonical mapping fields.
- `canonical_consistency_by_evidence_cluster.csv` should compare raw-label Jaccard against semantic-canonical-code Jaccard.
- Source links should be relative to `analysis/model_comparison/`, for example `../../results/5.5/01_companies/company_12828152/02_open_coding/1836102019.json`.
- `improved_open_coding_prompt_v2.md` should be linked from the report and previewed in a collapsible section so the user can copy it for a future batch run.

## Report Requirements

The final report should be a standalone HTML file that includes:

1. Chinese-first executive summary with necessary English technical terms preserved
2. benchmark-purpose section that states the input corpus is a diagnostic sample, not the substantive research object
3. benchmark-setup section explaining that company-specific examples are audit probes only
4. benchmark input and request basics, including company count, meeting count, expected model-meeting requests, collected output files, usage records, and empty/nonempty outputs
5. three model-profile cards with concise role, strengths, cautions, and key metrics
6. model-selection scorecard
7. icon-backed section headings and scan-friendly structure
8. metric framework for model choice
9. metric definitions and caveats
10. model-level comparison table
11. coverage and completeness comparison
12. sensitivity and granularity comparison
13. evidence-overlap comparison
14. label-consistency comparison
15. semantic canonicalization and agreement comparison
16. boundary-risk audit
17. selected disagreement examples
18. practical recommendation for using each model
19. official-price-based Batch API cost comparison
20. prompt design evaluation and prompt-improvement recommendations
21. relative source links for human audit of selected examples
22. an improved prompt v2 linked and previewed for future batch runs

The report should not present lexical risk flags as definitive qualitative truth. It should clearly separate measured differences from interpretive conclusions.

The report should include a provenance section that states:

- generating skill name
- skill GitHub URL
- skill version
- input origin URL: `https://iiaide.com/gt/`
- input origin note: iiaide GT opencoding flow final process ZIP package
- expected extracted data structure, shown in a collapsed `<details>` block by default

## Interpretation Framework

Use the following language in the report:

- `5.5` may be described as more granular if it has higher codes per unit and richer coding density.
- `5.4` may be described as more sensitive if it identifies more meaning units or nonempty meetings.
- `5.4mini` may be described as more conservative or less productive if it identifies fewer units, but boundary-risk rates must be checked before saying it is stricter.
- A model with more generic digital risk should be described as broader or more boundary-permissive, not simply worse.

## Known Limits

- No human gold standard is used.
- Fuzzy matching is lexical, not semantic embedding-based.
- Label-family clustering is an audit aid, not final codebook consolidation.
- Semantic canonicalization is deterministic and conservative. It is stronger than lexical label families but still needs human audit before becoming a final qualitative codebook.
- Boundary-risk classification uses lexical signals and should be manually reviewed.
- Counts are affected by segmentation choices, so unit/code quantity should not be interpreted alone.
- API prices can change; the report records the checked date and official source URL.

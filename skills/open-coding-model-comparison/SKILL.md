---
name: open-coding-model-comparison
description: Compare multiple model outputs for grounded-theory open-coding batch results. Use when Codex needs to analyze result directories shaped like results/model/01_companies/company_id/02_open_coding/keydevid.json, compare GPT-5.5, GPT-5.4, and GPT-5.4-mini style runs, compute evidence overlap, label families, boundary-risk audits, validation issues, Batch API token and cost efficiency, prompt-design audit, and generate a readable single-page HTML report plus CSV and JSON tables.
---

# Open Coding Model Comparison

## Version

Current version: `0.1.4`.

This version packages the reusable comparison workflow for benchmark-style Batch API open-coding model evaluation. It includes the comparison script, a Chinese-first HTML report that explicitly shows per-model Open codes counts as well as necessary English technical terms such as Batch API, prompt, evidence, Generic Risk, open codes, and codes/unit, Batch API cost-efficiency metrics, model-selection scorecard, prompt-design audit, improved prompt v2, and relative source links for human review.

## Purpose

Use this skill to compare several model runs that open-coded the same transcript meetings with the same prompt. The workflow treats the input corpus as a benchmark sample, not as a substantive company/content analysis. It produces a reusable audit package: model-level metrics, model-selection scorecard, model-profile cards, meeting-level differences, evidence matching, boundary-risk review, label-family comparison, validation issues, Batch API cost efficiency, prompt-design evaluation, and a standalone Chinese-first HTML dashboard report.

## Expected Input Layout

Run the skill from a project root containing:

```text
results/<model>/01_companies/company_<companyid>/02_open_coding/<keydevid>.json
results/<model>/09_logs/raw_batch_responses/**/<companyid>_<keydevid>.json  # optional, for real token usage
```

Default model directory names are:

```text
5.5, 5.4, 5.4mini
```

The script supports these pricing keys by default. If model directory names differ, use `--models`, but update the script pricing table before claiming cost results for new models.

## Quick Start

From the project root:

```bash
node skills/open-coding-model-comparison/scripts/compare_open_coding_models.js
```

Or from any location:

```bash
node /path/to/skills/open-coding-model-comparison/scripts/compare_open_coding_models.js --root /path/to/project
```

Useful options:

```bash
node skills/open-coding-model-comparison/scripts/compare_open_coding_models.js \
  --root /path/to/project \
  --models 5.5,5.4,5.4mini \
  --out-dir /path/to/project/analysis/model_comparison
```

## Outputs

The default output directory is:

```text
analysis/model_comparison/
```

Required outputs:

- `model_comparison_report.html`
- `model_level_summary.csv`
- `cost_efficiency_summary.csv`
- `prompt_design_audit.csv`
- `improved_open_coding_prompt_v2.md`
- `meeting_level_comparison.csv`
- `pairwise_meeting_differences.csv`
- `unit_matching_table.csv`
- `label_family_comparison.csv`
- `boundary_risk_audit.csv`
- `validation_issues.csv`
- `disagreement_examples.json`
- `report_data.json`

The HTML report and selected CSV files include relative links back to source open-coding JSON files under `results/`. These links are intended for human audit of boundary-risk examples, unique evidence, and matched/unmatched units.

The HTML report also includes a three-model profile section with icon-backed cards. Use it to give report readers a quick intuitive view of each model's role before they read detailed tables.

The dashboard links Font Awesome from a CDN for section and profile icons. Icons are visual aids only; all labels and metric explanations remain readable if the CDN is unavailable.

The dashboard includes a left-side navigation rail with section anchors for long reports. On narrow screens it collapses into a regular navigation block above the report content.

The report framing should emphasize model behavior, model-selection indicators, Batch API price-performance, and prompt-improvement evaluation. Company-specific examples are audit probes only and should not be presented as substantive findings about the sampled companies.

## Interpretation Rules

Do not treat more units or lower cost as automatically better.

- More `Units` can mean higher sensitivity, finer segmentation, or weaker AI-boundary control.
- `Open codes 数量` is the total number of objects in each output unit's `codes[]` arrays.
- Higher `Open codes/Unit` often means richer open coding, but may increase label fragmentation.
- `Generic Risk` is not an error rate. It flags broad digital/data/cloud/analytics/automation passages that need human review.
- `Exact` evidence overlap is strict. `Containment` often captures the more important case where two models selected the same evidence with different boundaries.
- Cost metrics use raw batch response token usage when present. If raw usage files are absent, cost fields will be zero or incomplete and should not be interpreted as actual spend.
- Prompt-design audit maps observed differences back to prompt rules. It is guidance for future prompt iterations, not a correction of the current coding results.
- `improved_open_coding_prompt_v2.md` is a copy-ready prompt for a future batch run. Treat it as a proposed prompt version, not as a retroactive recoding of current outputs.
- Batch API prices can change. If the user asks for current cost claims, verify official pricing before updating the script or report language.

## Recommended Workflow

1. Inspect the input directories and confirm all intended model folders exist.
2. Run the bundled script.
3. Open `model_comparison_report.html` first for the narrative summary.
4. Use `validation_issues.csv` to check output integrity problems.
5. Use `boundary_risk_audit.csv` to review likely over-broad AI inclusions.
6. Use `unit_matching_table.csv` when the user asks whether models captured the same evidence despite different wording or unit boundaries.
7. Use `cost_efficiency_summary.csv` when the user asks about Batch API cost or price-performance.
8. Use `prompt_design_audit.csv` when the user asks whether the prompt itself should be improved.
9. In the HTML report, click `開啟 JSON / Open JSON` links to jump from an audit example to the corresponding model's open-coding JSON file.
10. Use `improved_open_coding_prompt_v2.md` as the starting prompt when rerunning the same task with tighter boundary, segmentation, and code-splitting rules.

## Detailed Reference

Read `references/comparison_spec.md` only when exact metric definitions, formulas, or report requirements are needed.

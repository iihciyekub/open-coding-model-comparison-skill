# Open Coding Model Comparison Skill

Version: `0.1.0`

Reusable Codex skill for comparing multiple Batch API grounded-theory open-coding result sets generated from the same input corpus and prompt.

The report is intended for model and prompt evaluation, not for substantive analysis of the sampled input data. It compares model behavior, output differences, Batch API cost efficiency, auditability, model-selection indicators, and prompt-improvement opportunities.

## What It Produces

- Bilingual Traditional Chinese/English HTML report
- Model-selection scorecard
- Model profile cards
- Evidence overlap and consensus metrics
- Boundary-risk audit
- Label-family comparison
- Validation issue table
- Batch API token/cost efficiency tables
- Prompt-design audit
- Improved open-coding prompt v2
- Relative source JSON links for human review

## Expected Input Structure

Place real outputs in a project shaped like:

```text
results/<model>/01_companies/company_<companyid>/02_open_coding/<keydevid>.json
results/<model>/09_logs/raw_batch_responses/**/<companyid>_<keydevid>.json
```

Default model folders are:

```text
5.5
5.4
5.4mini
```

The repository includes only an empty input directory skeleton under `examples/input-structure/`. It does not include real coding outputs or analysis artifacts.

## Quick Start

From a project root containing `results/`:

```bash
node /path/to/open-coding-model-comparison-skill/skills/open-coding-model-comparison/scripts/compare_open_coding_models.js --root /path/to/project
```

Outputs are written to:

```text
analysis/model_comparison/
```

## Skill Location

The bundled skill folder is:

```text
skills/open-coding-model-comparison/
```

Use the skill's `SKILL.md` for detailed workflow instructions and `references/comparison_spec.md` for metric definitions.

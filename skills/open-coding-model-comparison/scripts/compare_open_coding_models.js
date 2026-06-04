#!/usr/bin/env node

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");

function parseArgs(argv) {
  const args = {
    root: process.cwd(),
    models: "5.5,5.4,5.4mini",
    resultsDir: "",
    outDir: "",
    fuzzyThreshold: "0.55"
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      console.log(`Usage: node compare_open_coding_models.js [options]

Options:
  --root <dir>              Project root containing results/ (default: current directory)
  --models <a,b,c>          Model result directory names (default: 5.5,5.4,5.4mini)
  --results-dir <dir>       Override results directory (default: <root>/results)
  --out-dir <dir>           Override output directory (default: <root>/analysis/model_comparison)
  --fuzzy-threshold <num>   Token Jaccard threshold for fuzzy evidence matches (default: 0.55)
  --help                    Show this help
`);
      process.exit(0);
    }
    const next = argv[i + 1];
    if (arg === "--root") {
      args.root = next;
      i += 1;
    } else if (arg === "--models") {
      args.models = next;
      i += 1;
    } else if (arg === "--results-dir") {
      args.resultsDir = next;
      i += 1;
    } else if (arg === "--out-dir") {
      args.outDir = next;
      i += 1;
    } else if (arg === "--fuzzy-threshold") {
      args.fuzzyThreshold = next;
      i += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

const CLI = parseArgs(process.argv.slice(2));
const ROOT = path.resolve(CLI.root);
const MODELS = CLI.models.split(",").map((model) => model.trim()).filter(Boolean);
const RESULTS_DIR = CLI.resultsDir ? path.resolve(CLI.resultsDir) : path.join(ROOT, "results");
const OUT_DIR = CLI.outDir ? path.resolve(CLI.outDir) : path.join(ROOT, "analysis", "model_comparison");
const FUZZY_THRESHOLD = Number(CLI.fuzzyThreshold);
const PROMPT_V2_FILENAME = "improved_open_coding_prompt_v2.md";
const SKILL_PROVENANCE = {
  name: "open-coding-model-comparison",
  version: "0.1.6",
  github_url: "https://github.com/iihciyekub/open-coding-model-comparison-skill",
  skill_path: "skills/open-coding-model-comparison",
  input_origin_url: "https://iiaide.com/gt/",
  input_origin_description: "Generated from the iiaide GT opencoding flow final process ZIP package, then extracted into the expected results/<model>/... project layout.",
  data_structure: [
    "results/<model>/01_companies/company_<companyid>/02_open_coding/<keydevid>.json",
    "results/<model>/09_logs/raw_batch_responses/**/<companyid>_<keydevid>.json",
    "analysis/model_comparison/model_comparison_report.html",
    "analysis/model_comparison/*.csv",
    "analysis/model_comparison/report_data.json"
  ]
};
const PRICING_SOURCE = {
  checked_date: "2026-06-03",
  official_url: "https://openai.com/api/pricing/",
  batch_discount: 0.5,
  note: "OpenAI pricing page lists standard processing rates and states Batch API saves 50% on inputs and outputs."
};
const MODEL_PRICES_STANDARD = {
  "5.5": { model_name: "gpt-5.5", input_per_1m: 5.00, cached_input_per_1m: 0.50, output_per_1m: 30.00 },
  "5.4": { model_name: "gpt-5.4", input_per_1m: 2.50, cached_input_per_1m: 0.25, output_per_1m: 15.00 },
  "5.4mini": { model_name: "gpt-5.4-mini", input_per_1m: 0.75, cached_input_per_1m: 0.075, output_per_1m: 4.50 }
};

function batchPrices(model) {
  const standard = MODEL_PRICES_STANDARD[model];
  return {
    input_per_1m: standard.input_per_1m * PRICING_SOURCE.batch_discount,
    cached_input_per_1m: standard.cached_input_per_1m * PRICING_SOURCE.batch_discount,
    output_per_1m: standard.output_per_1m * PRICING_SOURCE.batch_discount
  };
}

const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "in", "into",
  "is", "it", "of", "on", "or", "our", "the", "their", "to", "with", "within",
  "through", "using", "use", "uses", "used", "apply", "applying", "applies",
  "build", "building", "develop", "developing", "deploy", "deploying", "enable",
  "enabling", "drive", "driving", "support", "supporting", "expand", "expanding"
]);

const SEMANTIC_STOPWORDS = new Set([
  ...STOPWORDS,
  "advance", "advancing", "adopt", "adopting", "add", "adding", "create", "creating",
  "enhance", "enhancing", "implement", "implementing", "integrate", "integrating",
  "leverage", "leveraging", "offer", "offering", "provide", "providing", "scale",
  "scaling", "strengthen", "strengthening", "utilize", "utilizing"
]);

const SEMANTIC_SYNONYMS = new Map([
  ["ais", "ai"],
  ["artificial", "ai"],
  ["intelligence", "ai"],
  ["generative", "genai"],
  ["llms", "llm"],
  ["models", "model"],
  ["modeling", "model"],
  ["modelling", "model"],
  ["analytics", "analytic"],
  ["algorithmic", "algorithm"],
  ["algorithms", "algorithm"],
  ["automated", "automation"],
  ["automating", "automation"],
  ["capabilities", "capability"],
  ["capabilitie", "capability"],
  ["centers", "center"],
  ["centres", "center"],
  ["customers", "customer"],
  ["development", "develop"],
  ["developments", "develop"],
  ["deployment", "deploy"],
  ["deployments", "deploy"],
  ["discover", "discovery"],
  ["efficiencies", "efficiency"],
  ["functions", "function"],
  ["improv", "improve"],
  ["improving", "improve"],
  ["insights", "insight"],
  ["licenses", "license"],
  ["licensing", "license"],
  ["licens", "license"],
  ["platforms", "platform"],
  ["products", "product"],
  ["programs", "program"],
  ["recurr", "recurring"],
  ["revenues", "revenue"],
  ["services", "service"],
  ["solutions", "solution"],
  ["technologies", "technology"],
  ["transportables", "transportable"],
  ["verticals", "vertical"]
]);

const SEMANTIC_PHRASES = [
  { re: /\bartificial intelligence\b/g, token: "ai" },
  { re: /\bgenerative ai\b/g, token: "genai" },
  { re: /\bmachine learning\b/g, token: "ml" },
  { re: /\bdeep learning\b/g, token: "deep_learning" },
  { re: /\blarge language models?\b/g, token: "llm" },
  { re: /\bfoundation models?\b/g, token: "foundation_model" },
  { re: /\bnatural language processing\b/g, token: "nlp" },
  { re: /\bcomputer vision\b/g, token: "computer_vision" },
  { re: /\bdata centers?\b/g, token: "data_center" },
  { re: /\bdata centres?\b/g, token: "data_center" },
  { re: /\bdrug discovery\b/g, token: "drug_discovery" },
  { re: /\brecurring revenue\b/g, token: "recurring_revenue" },
  { re: /\buse cases?\b/g, token: "use_case" },
  { re: /\bcustomer service\b/g, token: "customer_service" }
];

const EXPLICIT_AI_RE = /\b(artificial intelligence|generative ai|genai|machine learning|deep learning|large language model|foundation model|neural network|computer vision|natural language processing|ai agents?|llms?|ai|ml|nlp|model training|training models?|inference|ai chips?|ai accelerators?)\b/i;
const POSSIBLE_AI_TECH_RE = /\b(predictive models?|prediction models?|recommendation systems?|personalization|speech recognition|image recognition|recognition models?|algorithmic decision|optimization models?|autonomous systems?|model-driven|intelligent decision)\b/i;
const GENERIC_DIGITAL_RE = /\b(digital|data-driven|data driven|analytics?|cloud|automation|automated|crm|software|e-commerce|platforms?|data centers?|data centre|big data|algorithm|algorithms|tools?|technology|technologies|digitization|digitalization)\b/i;

function csvEscape(value) {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

async function writeCsv(file, rows, columns) {
  const lines = [columns.join(",")];
  for (const row of rows) {
    lines.push(columns.map((col) => csvEscape(row[col])).join(","));
  }
  await fsp.writeFile(file, lines.join("\n") + "\n", "utf8");
}

async function ensureImprovedPrompt(outDir) {
  const target = path.join(outDir, PROMPT_V2_FILENAME);
  if (fs.existsSync(target)) return await fsp.readFile(target, "utf8");
  const bundledPrompt = path.join(__dirname, "..", "references", PROMPT_V2_FILENAME);
  if (fs.existsSync(bundledPrompt)) {
    const content = await fsp.readFile(bundledPrompt, "utf8");
    await fsp.writeFile(target, content, "utf8");
    return content;
  }
  const content = `You are a qualitative research assistant using Grounded Theory.

Use this improved open-coding prompt as a starting point for the next batch run.

Key changes:

- Exclude generic digital, data, analytics, cloud, software, automation, algorithms, platforms, CRM, e-commerce, data centers, GPUs, chips, sensors, robotics, or IT infrastructure unless local transcript context explicitly establishes an AI, ML, model-driven, generative, autonomous, intelligent-decision, or AI-infrastructure connection.
- Prefer the minimal full sentence that contains the AI-related claim; include adjacent sentences only when they supply the AI referent, concrete use case, business consequence, or constraint.
- Split codes only when the unit contains distinct actor-action-object-outcome claims.
- Before returning, silently verify that every code.text is an exact substring of its unit.text and confidence is high or medium.
`;
  await fsp.writeFile(target, content, "utf8");
  return content;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function htmlAttr(value) {
  return escapeHtml(value).replace(/'/g, "&#39;");
}

function sourceJsonRel(model, companyid, keydevid) {
  return `../../results/${model}/01_companies/company_${companyid}/02_open_coding/${keydevid}.json`;
}

function sourceLink(model, companyid, keydevid, label = "開啟 JSON / Open JSON") {
  return `<a class="source-link" href="${htmlAttr(sourceJsonRel(model, companyid, keydevid))}" target="_blank" rel="noopener">${escapeHtml(label)}</a>`;
}

function pct(value, digits = 1) {
  if (!Number.isFinite(value)) return "n/a";
  return `${(value * 100).toFixed(digits)}%`;
}

function num(value, digits = 2) {
  if (!Number.isFinite(value)) return "n/a";
  return Number(value).toFixed(digits);
}

async function walk(dir) {
  const output = [];
  for (const ent of await fsp.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) output.push(...await walk(p));
    else output.push(p);
  }
  return output;
}

function normalizeText(s) {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[“”]/g, '"')
    .replace(/[’]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeLoose(s) {
  return normalizeText(s)
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(s) {
  return normalizeLoose(s)
    .split(" ")
    .filter((tok) => tok && tok.length > 1);
}

function uniqueTokens(s) {
  return new Set(tokenize(s));
}

function jaccard(aSet, bSet) {
  if (!aSet.size && !bSet.size) return 1;
  let intersection = 0;
  for (const x of aSet) if (bSet.has(x)) intersection += 1;
  return intersection / (aSet.size + bSet.size - intersection);
}

function wordCount(s) {
  return String(s ?? "").trim().split(/\s+/).filter(Boolean).length;
}

function estimateBatchCost(model, usage) {
  const batch = batchPrices(model);
  const input = Number(usage?.input_tokens || 0);
  const cached = Number(usage?.cached_input_tokens || 0);
  const output = Number(usage?.output_tokens || 0);
  const uncached = Math.max(0, input - cached);
  return (uncached / 1_000_000) * batch.input_per_1m
    + (cached / 1_000_000) * batch.cached_input_per_1m
    + (output / 1_000_000) * batch.output_per_1m;
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

function simpleStem(token) {
  return token
    .replace(/ies$/, "y")
    .replace(/ing$/, "")
    .replace(/ed$/, "")
    .replace(/s$/, "");
}

function labelFamily(label) {
  const tokens = tokenize(label)
    .map(simpleStem)
    .filter((tok) => tok.length > 1 && !STOPWORDS.has(tok));
  const unique = [...new Set(tokens)].sort();
  return unique.join(" ") || normalizeLoose(label);
}

function semanticTokens(s) {
  let text = String(s ?? "").toLowerCase();
  for (const phrase of SEMANTIC_PHRASES) {
    text = text.replace(phrase.re, ` ${phrase.token} `);
  }
  const tokens = normalizeLoose(text)
    .split(" ")
    .filter(Boolean)
    .map(simpleStem)
    .map((tok) => SEMANTIC_SYNONYMS.get(tok) || tok)
    .filter((tok) => tok.length > 1 && !SEMANTIC_STOPWORDS.has(tok));
  return [...new Set(tokens)];
}

function semanticSignature(label) {
  const tokens = semanticTokens(label).sort();
  return tokens.join(" ") || normalizeLoose(label);
}

function codeSemanticTokens(code) {
  return new Set(semanticTokens(`${code.label} ${code.text} ${code.rationale}`));
}

function semanticCodeSimilarity(a, b) {
  const labelScore = jaccard(new Set(semanticTokens(a.label)), new Set(semanticTokens(b.label)));
  const combinedScore = jaccard(codeSemanticTokens(a), codeSemanticTokens(b));
  return { labelScore, combinedScore };
}

function isSemanticCodeMatch(a, b, sameEvidenceCluster = false) {
  const aNorm = a.normLabel || a.normalized_label;
  const bNorm = b.normLabel || b.normalized_label;
  if (aNorm && aNorm === bNorm) return true;
  if (a.semantic_signature && a.semantic_signature === b.semantic_signature) return true;
  const { labelScore, combinedScore } = semanticCodeSimilarity(a, b);
  if (labelScore >= 0.6) return true;
  if (sameEvidenceCluster && (labelScore >= 0.45 || combinedScore >= 0.5)) return true;
  return false;
}

function evidenceClass(text) {
  if (EXPLICIT_AI_RE.test(text)) return "explicit_ai";
  if (POSSIBLE_AI_TECH_RE.test(text)) return "possible_ai_technical";
  if (GENERIC_DIGITAL_RE.test(text)) return "generic_digital_risk";
  return "no_lexical_ai_signal";
}

function parseRelPath(model, file) {
  const rel = path.relative(path.join(RESULTS_DIR, model), file);
  const match = rel.match(/^01_companies\/company_([^/]+)\/02_open_coding\/([^/]+)\.json$/);
  if (!match) return null;
  return {
    rel,
    companyid: match[1],
    keydevid: match[2],
    meetingKey: `${match[1]}:${match[2]}`
  };
}

function validateUnit(unit, fileRecord, unitIndex) {
  const problems = [];
  if (unit?.analysis_type !== "open_coding") problems.push("wrong_analysis_type");
  if (!unit?.unit_id) problems.push("missing_unit_id");
  if (!unit?.text) problems.push("missing_text");
  if (!unit?.ai_relevance) problems.push("missing_ai_relevance");
  if (!["high", "medium"].includes(unit?.confidence)) problems.push("bad_confidence");
  if (!Array.isArray(unit?.codes)) problems.push("codes_not_array");

  const unitText = String(unit?.text ?? "");
  const codes = Array.isArray(unit?.codes) ? unit.codes : [];
  codes.forEach((code, codeIndex) => {
    if (!code?.code_id) problems.push("missing_code_id");
    if (!code?.label) problems.push("missing_label");
    if (!code?.text) problems.push("missing_code_text");
    if (!code?.rationale) problems.push("missing_rationale");
    if (code?.text && !unitText.includes(code.text)) problems.push("code_text_not_in_unit_text");
    if (String(code?.rationale ?? "").split(/\s+/).filter(Boolean).length > 25) {
      problems.push("long_rationale");
    }
  });

  return problems.map((problem) => ({
    model: fileRecord.model,
    companyid: fileRecord.companyid,
    keydevid: fileRecord.keydevid,
    file: fileRecord.rel,
    unit_index: unitIndex,
    unit_id: unit?.unit_id ?? "",
    problem
  }));
}

function compareUnits(a, b) {
  const exact = a.normText === b.normText;
  const containment = !exact && (a.normText.includes(b.normText) || b.normText.includes(a.normText));
  const score = jaccard(a.tokens, b.tokens);
  let matchType = "none";
  if (exact) matchType = "exact";
  else if (containment) matchType = "containment";
  else if (score >= FUZZY_THRESHOLD) matchType = "fuzzy";
  return { exact, containment, score, matchType };
}

function bestPairwiseMatches(aUnits, bUnits) {
  const candidates = [];
  for (const a of aUnits) {
    for (const b of bUnits) {
      const cmp = compareUnits(a, b);
      if (cmp.matchType !== "none") {
        const priority = cmp.matchType === "exact" ? 3 : cmp.matchType === "containment" ? 2 : 1;
        candidates.push({ a, b, ...cmp, priority });
      }
    }
  }
  candidates.sort((x, y) => y.priority - x.priority || y.score - x.score);
  const usedA = new Set();
  const usedB = new Set();
  const matches = [];
  for (const c of candidates) {
    if (usedA.has(c.a.globalUnitId) || usedB.has(c.b.globalUnitId)) continue;
    usedA.add(c.a.globalUnitId);
    usedB.add(c.b.globalUnitId);
    matches.push(c);
  }
  const aUnmatched = aUnits.filter((u) => !usedA.has(u.globalUnitId));
  const bUnmatched = bUnits.filter((u) => !usedB.has(u.globalUnitId));
  return { matches, aUnmatched, bUnmatched };
}

function componentKey(unit) {
  return unit.globalUnitId;
}

class UnionFind {
  constructor(ids) {
    this.parent = new Map(ids.map((id) => [id, id]));
  }
  find(id) {
    const p = this.parent.get(id);
    if (p === id) return id;
    const root = this.find(p);
    this.parent.set(id, root);
    return root;
  }
  union(a, b) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(rb, ra);
  }
}

async function loadModel(model) {
  const modelDir = path.join(RESULTS_DIR, model, "01_companies");
  const files = (await walk(modelDir)).filter((file) => file.endsWith(".json") && file.includes(`${path.sep}02_open_coding${path.sep}`));
  const meetings = new Map();
  const allUnits = [];
  const validationRows = [];
  const fileProblems = [];

  for (const file of files) {
    const relData = parseRelPath(model, file);
    if (!relData) continue;
    const fileRecord = {
      model,
      ...relData,
      file,
      units: [],
      invalidJson: false,
      malformedTopLevel: false
    };
    let parsed;
    try {
      parsed = JSON.parse(await fsp.readFile(file, "utf8"));
    } catch (err) {
      fileRecord.invalidJson = true;
      fileProblems.push({ model, file: relData.rel, problem: "invalid_json", detail: err.message });
      meetings.set(relData.meetingKey, fileRecord);
      continue;
    }
    if (!Array.isArray(parsed)) {
      fileRecord.malformedTopLevel = true;
      fileProblems.push({ model, file: relData.rel, problem: "top_level_not_array", detail: "" });
      meetings.set(relData.meetingKey, fileRecord);
      continue;
    }
    parsed.forEach((unit, unitIndex) => {
      validationRows.push(...validateUnit(unit, fileRecord, unitIndex));
      const codes = Array.isArray(unit?.codes) ? unit.codes.map((code, codeIndex) => ({
        code_id: code?.code_id ?? `C${codeIndex + 1}`,
        text: String(code?.text ?? ""),
        label: String(code?.label ?? ""),
        normLabel: normalizeLoose(code?.label ?? ""),
        family: labelFamily(code?.label ?? ""),
        semantic_signature: semanticSignature(code?.label ?? ""),
        rationale: String(code?.rationale ?? "")
      })) : [];
      const text = String(unit?.text ?? "");
      const record = {
        model,
        companyid: relData.companyid,
        keydevid: relData.keydevid,
        meetingKey: relData.meetingKey,
        rel: relData.rel,
        unitIndex,
        unit_id: String(unit?.unit_id ?? `U${unitIndex + 1}`),
        globalUnitId: `${model}:${relData.meetingKey}:${unitIndex}`,
        text,
        normText: normalizeText(text),
        looseText: normalizeLoose(text),
        tokens: uniqueTokens(text),
        confidence: String(unit?.confidence ?? ""),
        ai_relevance: String(unit?.ai_relevance ?? ""),
        words: wordCount(text),
        chars: [...text].length,
        evidence_class: evidenceClass(text),
        codes
      };
      fileRecord.units.push(record);
      allUnits.push(record);
    });
    meetings.set(relData.meetingKey, fileRecord);
  }

  return { model, meetings, allUnits, validationRows, fileProblems };
}

async function loadUsage(model) {
  const rawRoot = path.join(RESULTS_DIR, model, "09_logs", "raw_batch_responses");
  const usageByMeeting = new Map();
  if (!fs.existsSync(rawRoot)) return usageByMeeting;
  const files = (await walk(rawRoot)).filter((file) => file.endsWith(".json"));
  for (const file of files) {
    let parsed;
    try {
      parsed = JSON.parse(await fsp.readFile(file, "utf8"));
    } catch {
      continue;
    }
    const usage = parsed?.response?.body?.usage || parsed?.usage || parsed?.body?.usage;
    if (!usage) continue;
    const customId = parsed?.custom_id || "";
    let companyid = "";
    let keydevid = "";
    const customMatch = customId.match(/^open_coding:([^:]+):([^:]+)$/);
    if (customMatch) {
      companyid = customMatch[1];
      keydevid = customMatch[2];
    } else {
      const fileMatch = path.basename(file, ".json").match(/^([^_]+)_(.+)$/);
      if (!fileMatch) continue;
      companyid = fileMatch[1];
      keydevid = fileMatch[2];
    }
    const inputTokens = Number(usage.input_tokens || usage.prompt_tokens || 0);
    const cachedTokens = Number(usage.input_tokens_details?.cached_tokens || usage.prompt_tokens_details?.cached_tokens || 0);
    const outputTokens = Number(usage.output_tokens || usage.completion_tokens || 0);
    const totalTokens = Number(usage.total_tokens || inputTokens + outputTokens);
    usageByMeeting.set(`${companyid}:${keydevid}`, {
      model,
      api_model: parsed?.response?.body?.model || parsed?.model || "",
      companyid,
      keydevid,
      input_tokens: inputTokens,
      cached_input_tokens: cachedTokens,
      output_tokens: outputTokens,
      total_tokens: totalTokens,
      estimated_batch_cost_usd: estimateBatchCost(model, {
        input_tokens: inputTokens,
        cached_input_tokens: cachedTokens,
        output_tokens: outputTokens
      })
    });
  }
  return usageByMeeting;
}

function summarizeModel(modelData, allMeetingKeys) {
  const companyIds = new Set([...modelData.meetings.values()].map((m) => m.companyid));
  const files = modelData.meetings.size;
  const missing = allMeetingKeys.size - files;
  const empty = [...modelData.meetings.values()].filter((m) => !m.invalidJson && !m.malformedTopLevel && m.units.length === 0).length;
  const nonempty = files - empty;
  const units = modelData.allUnits.length;
  const codes = modelData.allUnits.reduce((sum, unit) => sum + unit.codes.length, 0);
  const high = modelData.allUnits.filter((unit) => unit.confidence === "high").length;
  const medium = modelData.allUnits.filter((unit) => unit.confidence === "medium").length;
  const words = modelData.allUnits.map((unit) => unit.words);
  const evidenceCounts = {};
  modelData.allUnits.forEach((unit) => {
    evidenceCounts[unit.evidence_class] = (evidenceCounts[unit.evidence_class] || 0) + 1;
  });
  const codeCountBuckets = { code_0: 0, code_1: 0, code_2: 0, code_3: 0, code_4plus: 0 };
  modelData.allUnits.forEach((unit) => {
    const c = unit.codes.length;
    if (c <= 0) codeCountBuckets.code_0 += 1;
    else if (c === 1) codeCountBuckets.code_1 += 1;
    else if (c === 2) codeCountBuckets.code_2 += 1;
    else if (c === 3) codeCountBuckets.code_3 += 1;
    else codeCountBuckets.code_4plus += 1;
  });
  const uniqueLabels = new Set(modelData.allUnits.flatMap((unit) => unit.codes.map((code) => code.normLabel)).filter(Boolean));
  const labelFamilies = new Set(modelData.allUnits.flatMap((unit) => unit.codes.map((code) => code.family)).filter(Boolean));
  const validationCounts = {};
  modelData.validationRows.forEach((row) => {
    validationCounts[row.problem] = (validationCounts[row.problem] || 0) + 1;
  });
  const usageRows = [...(modelData.usageByMeeting?.values() || [])];
  const inputTokens = usageRows.reduce((sum, row) => sum + row.input_tokens, 0);
  const cachedInputTokens = usageRows.reduce((sum, row) => sum + row.cached_input_tokens, 0);
  const outputTokens = usageRows.reduce((sum, row) => sum + row.output_tokens, 0);
  const totalTokens = usageRows.reduce((sum, row) => sum + row.total_tokens, 0);
  const estimatedBatchCost = usageRows.reduce((sum, row) => sum + row.estimated_batch_cost_usd, 0);
  const highConfidenceUnits = high;
  const explicitAiUnits = evidenceCounts.explicit_ai || 0;
  const nonGenericRiskUnits = units - (evidenceCounts.generic_digital_risk || 0);
  const standardPrice = MODEL_PRICES_STANDARD[modelData.model];
  const batchPrice = batchPrices(modelData.model);
  return {
    model: modelData.model,
    api_model_name: standardPrice.model_name,
    standard_input_per_1m_usd: standardPrice.input_per_1m,
    standard_cached_input_per_1m_usd: standardPrice.cached_input_per_1m,
    standard_output_per_1m_usd: standardPrice.output_per_1m,
    batch_input_per_1m_usd: batchPrice.input_per_1m,
    batch_cached_input_per_1m_usd: batchPrice.cached_input_per_1m,
    batch_output_per_1m_usd: batchPrice.output_per_1m,
    company_count: companyIds.size,
    output_files: files,
    missing_files_vs_union: missing,
    empty_files: empty,
    nonempty_files: nonempty,
    nonempty_rate: nonempty / Math.max(files, 1),
    units,
    codes,
    high_confidence_units: high,
    medium_confidence_units: medium,
    medium_confidence_rate: medium / Math.max(units, 1),
    avg_units_per_nonempty_file: units / Math.max(nonempty, 1),
    avg_codes_per_unit: codes / Math.max(units, 1),
    avg_words_per_unit: words.reduce((a, b) => a + b, 0) / Math.max(words.length, 1),
    median_words_per_unit: median(words),
    explicit_ai_units: evidenceCounts.explicit_ai || 0,
    possible_ai_technical_units: evidenceCounts.possible_ai_technical || 0,
    generic_digital_risk_units: evidenceCounts.generic_digital_risk || 0,
    no_lexical_ai_signal_units: evidenceCounts.no_lexical_ai_signal || 0,
    generic_digital_risk_rate: (evidenceCounts.generic_digital_risk || 0) / Math.max(units, 1),
    unique_normalized_labels: uniqueLabels.size,
    label_families: labelFamilies.size,
    label_family_per_code_rate: labelFamilies.size / Math.max(codes, 1),
    invalid_json_files: modelData.fileProblems.filter((p) => p.problem === "invalid_json").length,
    malformed_top_level_files: modelData.fileProblems.filter((p) => p.problem === "top_level_not_array").length,
    validation_problem_count: modelData.validationRows.length,
    code_text_not_in_unit_text: validationCounts.code_text_not_in_unit_text || 0,
    bad_confidence: validationCounts.bad_confidence || 0,
    wrong_analysis_type: validationCounts.wrong_analysis_type || 0,
    codes_not_array: validationCounts.codes_not_array || 0,
    usage_records: usageRows.length,
    input_tokens: inputTokens,
    cached_input_tokens: cachedInputTokens,
    output_tokens: outputTokens,
    total_tokens: totalTokens,
    estimated_batch_cost_usd: estimatedBatchCost,
    cost_per_output_file_usd: estimatedBatchCost / Math.max(files, 1),
    cost_per_nonempty_file_usd: estimatedBatchCost / Math.max(nonempty, 1),
    cost_per_unit_usd: estimatedBatchCost / Math.max(units, 1),
    cost_per_code_usd: estimatedBatchCost / Math.max(codes, 1),
    cost_per_high_confidence_unit_usd: estimatedBatchCost / Math.max(highConfidenceUnits, 1),
    cost_per_explicit_ai_unit_usd: estimatedBatchCost / Math.max(explicitAiUnits, 1),
    cost_per_non_generic_risk_unit_usd: estimatedBatchCost / Math.max(nonGenericRiskUnits, 1),
    ...codeCountBuckets
  };
}

function meetingRows(modelDataByName, allMeetingKeys) {
  const rows = [];
  for (const meetingKey of [...allMeetingKeys].sort()) {
    const [companyid, keydevid] = meetingKey.split(":");
    const row = { companyid, keydevid, meeting_key: meetingKey };
    for (const model of MODELS) {
      const meeting = modelDataByName[model].meetings.get(meetingKey);
      const units = meeting?.units ?? [];
      const usage = modelDataByName[model].usageByMeeting?.get(meetingKey);
      row[`${model}_present`] = meeting ? 1 : 0;
      row[`${model}_units`] = units.length;
      row[`${model}_codes`] = units.reduce((sum, unit) => sum + unit.codes.length, 0);
      row[`${model}_empty`] = meeting && units.length === 0 ? 1 : 0;
      row[`${model}_high`] = units.filter((unit) => unit.confidence === "high").length;
      row[`${model}_medium`] = units.filter((unit) => unit.confidence === "medium").length;
      row[`${model}_generic_digital_risk_units`] = units.filter((unit) => unit.evidence_class === "generic_digital_risk").length;
      row[`${model}_explicit_ai_units`] = units.filter((unit) => unit.evidence_class === "explicit_ai").length;
      row[`${model}_input_tokens`] = usage?.input_tokens ?? "";
      row[`${model}_output_tokens`] = usage?.output_tokens ?? "";
      row[`${model}_estimated_batch_cost_usd`] = usage?.estimated_batch_cost_usd ?? "";
    }
    rows.push(row);
  }
  return rows;
}

function costEfficiencyRows(modelSummaries) {
  return modelSummaries.map((row) => ({
    model: row.model,
    api_model_name: row.api_model_name,
    pricing_checked_date: PRICING_SOURCE.checked_date,
    pricing_source: PRICING_SOURCE.official_url,
    standard_input_per_1m_usd: row.standard_input_per_1m_usd,
    standard_cached_input_per_1m_usd: row.standard_cached_input_per_1m_usd,
    standard_output_per_1m_usd: row.standard_output_per_1m_usd,
    batch_input_per_1m_usd: row.batch_input_per_1m_usd,
    batch_cached_input_per_1m_usd: row.batch_cached_input_per_1m_usd,
    batch_output_per_1m_usd: row.batch_output_per_1m_usd,
    usage_records: row.usage_records,
    input_tokens: row.input_tokens,
    cached_input_tokens: row.cached_input_tokens,
    output_tokens: row.output_tokens,
    total_tokens: row.total_tokens,
    estimated_batch_cost_usd: row.estimated_batch_cost_usd,
    cost_per_output_file_usd: row.cost_per_output_file_usd,
    cost_per_nonempty_file_usd: row.cost_per_nonempty_file_usd,
    cost_per_unit_usd: row.cost_per_unit_usd,
    cost_per_code_usd: row.cost_per_code_usd,
    cost_per_high_confidence_unit_usd: row.cost_per_high_confidence_unit_usd,
    cost_per_explicit_ai_unit_usd: row.cost_per_explicit_ai_unit_usd,
    cost_per_non_generic_risk_unit_usd: row.cost_per_non_generic_risk_unit_usd
  }));
}

function benchmarkInputSummaryRows(modelSummaries, allMeetingKeys) {
  const companyIds = new Set([...allMeetingKeys].map((key) => key.split(":")[0]));
  const expectedRequests = allMeetingKeys.size * MODELS.length;
  const totalOutputFiles = modelSummaries.reduce((sum, row) => sum + row.output_files, 0);
  const totalUsageRecords = modelSummaries.reduce((sum, row) => sum + row.usage_records, 0);
  const totalMissing = modelSummaries.reduce((sum, row) => sum + row.missing_files_vs_union, 0);
  return [
    { metric: "model_count", value: MODELS.length, note: MODELS.join("|") },
    { metric: "company_count", value: companyIds.size, note: "Unique company IDs in the union of compared output files." },
    { metric: "meeting_count", value: allMeetingKeys.size, note: "Unique companyid:keydevid meetings in the union of compared output files." },
    { metric: "expected_model_meeting_requests", value: expectedRequests, note: "model_count x meeting_count; the paired benchmark target before missing outputs." },
    { metric: "collected_output_files", value: totalOutputFiles, note: "Open-coding JSON files found across all model result directories." },
    { metric: "missing_outputs_vs_expected", value: totalMissing, note: "Expected model-meeting outputs not found relative to the union benchmark." },
    { metric: "usage_records", value: totalUsageRecords, note: "Raw Batch API response usage records found and used for token/cost summaries." },
    { metric: "empty_json_outputs", value: modelSummaries.reduce((sum, row) => sum + row.empty_files, 0), note: "Valid JSON arrays with no meaning units." },
    { metric: "nonempty_json_outputs", value: modelSummaries.reduce((sum, row) => sum + row.nonempty_files, 0), note: "JSON outputs containing at least one meaning unit." },
    { metric: "input_tokens", value: modelSummaries.reduce((sum, row) => sum + row.input_tokens, 0), note: "Total input tokens from available usage records." },
    { metric: "output_tokens", value: modelSummaries.reduce((sum, row) => sum + row.output_tokens, 0), note: "Total output tokens from available usage records." },
    { metric: "estimated_batch_cost_usd", value: modelSummaries.reduce((sum, row) => sum + row.estimated_batch_cost_usd, 0), note: "Estimated cost from available usage records and Batch pricing assumptions." }
  ];
}

function benchmarkModelRequestRows(modelSummaries, allMeetingKeys) {
  return modelSummaries.map((row) => ({
    model: row.model,
    expected_requests: allMeetingKeys.size,
    collected_output_files: row.output_files,
    missing_outputs: row.missing_files_vs_union,
    usage_records: row.usage_records,
    empty_outputs: row.empty_files,
    nonempty_outputs: row.nonempty_files,
    companies: row.company_count,
    input_tokens: row.input_tokens,
    output_tokens: row.output_tokens,
    estimated_batch_cost_usd: row.estimated_batch_cost_usd
  }));
}

function promptDesignAuditRows(modelSummaries, pairSummaries, consensusCounts) {
  const totalComponents = Math.max(consensusCounts.components || 0, 1);
  const consensusRate = (consensusCounts.three_model_components || 0) / totalComponents;
  const avgContainmentShare = pairSummaries.reduce((sum, row) => sum + row.containment_match_share, 0) / Math.max(pairSummaries.length, 1);
  const avgExactShare = pairSummaries.reduce((sum, row) => sum + row.exact_match_share, 0) / Math.max(pairSummaries.length, 1);
  const avgGenericRisk = modelSummaries.reduce((sum, row) => sum + row.generic_digital_risk_rate, 0) / Math.max(modelSummaries.length, 1);
  const avgValidationRate = modelSummaries.reduce((sum, row) => sum + row.validation_problem_count / Math.max(row.units, 1), 0) / Math.max(modelSummaries.length, 1);
  const codesPerUnitValues = modelSummaries.map((row) => row.avg_codes_per_unit);
  const codesPerUnitRange = Math.max(...codesPerUnitValues) - Math.min(...codesPerUnitValues);
  const mediumRates = modelSummaries.map((row) => row.medium_confidence_rate);
  const mediumRateRange = Math.max(...mediumRates) - Math.min(...mediumRates);
  const unitWordValues = modelSummaries.map((row) => row.avg_words_per_unit);
  const unitWordRange = Math.max(...unitWordValues) - Math.min(...unitWordValues);

  return [
    {
      prompt_dimension: "AI boundary definition",
      related_prompt_rule: "Include substantive AI discussion; exclude generic digitalization, software, automation, analytics, big data, cloud, data centers, semiconductors, robotics, and ordinary technology adoption unless local AI context is established.",
      observed_signal: `Average generic-digital-risk rate is ${pct(avgGenericRisk)} across models.`,
      assessment: avgGenericRisk > 0.12 ? "The prompt gives a strong boundary rule, but this is still the main ambiguity surface; some outputs include broad digital/data/algorithm/cloud passages that need human review." : "The boundary rule appears reasonably effective, but generic digital/data passages still need targeted review.",
      suggested_prompt_improvement: "Add 2-3 positive/negative few-shot examples for borderline digital/data/cloud/algorithm passages, especially examples that should return [] unless AI/ML/model-driven context is explicit."
    },
    {
      prompt_dimension: "Meaning-unit segmentation",
      related_prompt_rule: "Use the shortest continuous transcript substring; prefer 1-2 sentences and no more than 80 words unless necessary.",
      observed_signal: `Average exact-match share across pairs is ${pct(avgExactShare)}, while containment-match share is ${pct(avgContainmentShare)}; average unit-word range across models is ${num(unitWordRange)} words.`,
      assessment: "The segmentation instruction is useful but underdetermined: models often capture the same local evidence with different boundaries.",
      suggested_prompt_improvement: "Add a deterministic tie-breaker: choose the minimal full sentence containing the AI claim; include adjacent sentence only when it supplies the AI referent or business consequence."
    },
    {
      prompt_dimension: "Open-code granularity",
      related_prompt_rule: "Produce 1-4 codes per meaning unit; use one code when one grounded meaning is sufficient.",
      observed_signal: `Codes/unit ranges from ${num(Math.min(...codesPerUnitValues))} to ${num(Math.max(...codesPerUnitValues))}.`,
      assessment: codesPerUnitRange > 0.6 ? "The prompt allows substantial model discretion in how many meanings to split from one unit; this explains why 5.5 produces denser coding than the other runs." : "The code-count rule produces fairly similar coding density across models.",
      suggested_prompt_improvement: "Define when to split codes: one code per distinct actor-action-object-outcome claim; avoid separate codes for background context unless it changes the AI mechanism."
    },
    {
      prompt_dimension: "Confidence calibration",
      related_prompt_rule: "Use high for explicit AI terms and medium for implicit AI context; do not output low-confidence units.",
      observed_signal: `Medium-confidence rate range across models is ${pct(mediumRateRange)}.`,
      assessment: "The high/medium rule is clear for explicit terms but less stable for implicit model-driven or algorithmic passages.",
      suggested_prompt_improvement: "Add a borderline bucket in the prompt contract: if the passage is only generic analytics/automation without an AI-specific anchor, exclude it rather than assigning medium confidence."
    },
    {
      prompt_dimension: "Evidence discipline and JSON schema",
      related_prompt_rule: "Every unit text and code text must be copied exactly from transcript/unit text; return JSON only; confidence must be high or medium.",
      observed_signal: `Validation issue rate averages ${pct(avgValidationRate)} per unit; largest issue count is ${Math.max(...modelSummaries.map((row) => row.validation_problem_count))}.`,
      assessment: avgValidationRate > 0.005 ? "The schema instructions mostly work, but some models still violate containment or field constraints; this should remain a hard validation gate." : "The schema instructions are largely effective.",
      suggested_prompt_improvement: "Keep the validation block. Consider adding a final self-check instruction: before returning, verify each code.text is an exact substring of its unit.text and confidence is high or medium."
    },
    {
      prompt_dimension: "Cross-model reproducibility",
      related_prompt_rule: "Same prompt applied to the same meetings should yield comparable evidence and labels.",
      observed_signal: `${consensusCounts.three_model_components} of ${consensusCounts.components} evidence clusters appear in all three models (${pct(consensusRate)}).`,
      assessment: "The prompt supports comparable outputs, but open coding remains interpretive; consensus is meaningful but single-model discoveries still require audit rather than automatic rejection.",
      suggested_prompt_improvement: "For future runs, add a second-stage normalization prompt or post-processing pass that maps labels to canonical code families after open coding, without changing original evidence."
    }
  ];
}

function pairwiseRows(modelDataByName, allMeetingKeys) {
  const rows = [];
  const unitMatchRows = [];
  const pairSummaries = {};
  for (let i = 0; i < MODELS.length; i++) {
    for (let j = i + 1; j < MODELS.length; j++) {
      const aModel = MODELS[i];
      const bModel = MODELS[j];
      const pairName = `${aModel} vs ${bModel}`;
      pairSummaries[pairName] = {
        pair: pairName,
        shared_meetings: 0,
        exact_matches: 0,
        containment_matches: 0,
        fuzzy_matches: 0,
        total_matches: 0,
        a_unique_units: 0,
        b_unique_units: 0,
        mean_abs_unit_count_diff: 0,
        mean_abs_code_count_diff: 0
      };

      for (const meetingKey of [...allMeetingKeys].sort()) {
        const aMeeting = modelDataByName[aModel].meetings.get(meetingKey);
        const bMeeting = modelDataByName[bModel].meetings.get(meetingKey);
        if (!aMeeting || !bMeeting) continue;
        const [companyid, keydevid] = meetingKey.split(":");
        const aUnits = aMeeting.units;
        const bUnits = bMeeting.units;
        const matchResult = bestPairwiseMatches(aUnits, bUnits);
        const exact = matchResult.matches.filter((m) => m.matchType === "exact").length;
        const containment = matchResult.matches.filter((m) => m.matchType === "containment").length;
        const fuzzy = matchResult.matches.filter((m) => m.matchType === "fuzzy").length;
        const aCodes = aUnits.reduce((sum, unit) => sum + unit.codes.length, 0);
        const bCodes = bUnits.reduce((sum, unit) => sum + unit.codes.length, 0);
        rows.push({
          pair: pairName,
          model_a: aModel,
          model_b: bModel,
          companyid,
          keydevid,
          meeting_key: meetingKey,
          model_a_units: aUnits.length,
          model_b_units: bUnits.length,
          model_a_codes: aCodes,
          model_b_codes: bCodes,
          abs_unit_count_diff: Math.abs(aUnits.length - bUnits.length),
          abs_code_count_diff: Math.abs(aCodes - bCodes),
          exact_matches: exact,
          containment_matches: containment,
          fuzzy_matches: fuzzy,
          matched_units: matchResult.matches.length,
          model_a_unique_units: matchResult.aUnmatched.length,
          model_b_unique_units: matchResult.bUnmatched.length,
          unit_overlap_rate: matchResult.matches.length / Math.max(aUnits.length + bUnits.length - matchResult.matches.length, 1)
        });
        matchResult.matches.forEach((m) => {
          unitMatchRows.push({
            pair: pairName,
            model_a: aModel,
            model_b: bModel,
            companyid,
            keydevid,
            meeting_key: meetingKey,
            match_type: m.matchType,
            token_jaccard: m.score,
            model_a_unit_id: m.a.unit_id,
            model_b_unit_id: m.b.unit_id,
            model_a_confidence: m.a.confidence,
            model_b_confidence: m.b.confidence,
            model_a_evidence_class: m.a.evidence_class,
            model_b_evidence_class: m.b.evidence_class,
            model_a_code_count: m.a.codes.length,
            model_b_code_count: m.b.codes.length,
            model_a_labels: m.a.codes.map((c) => c.label).join(" | "),
            model_b_labels: m.b.codes.map((c) => c.label).join(" | "),
            model_a_source_json: sourceJsonRel(aModel, companyid, keydevid),
            model_b_source_json: sourceJsonRel(bModel, companyid, keydevid),
            model_a_text: m.a.text,
            model_b_text: m.b.text
          });
        });
        matchResult.aUnmatched.forEach((u) => {
          unitMatchRows.push({
            pair: pairName,
            model_a: aModel,
            model_b: bModel,
            companyid,
            keydevid,
            meeting_key: meetingKey,
            match_type: `${aModel}_unique`,
            token_jaccard: 0,
            model_a_unit_id: u.unit_id,
            model_b_unit_id: "",
            model_a_confidence: u.confidence,
            model_b_confidence: "",
            model_a_evidence_class: u.evidence_class,
            model_b_evidence_class: "",
            model_a_code_count: u.codes.length,
            model_b_code_count: "",
            model_a_labels: u.codes.map((c) => c.label).join(" | "),
            model_b_labels: "",
            model_a_source_json: sourceJsonRel(aModel, companyid, keydevid),
            model_b_source_json: "",
            model_a_text: u.text,
            model_b_text: ""
          });
        });
        matchResult.bUnmatched.forEach((u) => {
          unitMatchRows.push({
            pair: pairName,
            model_a: aModel,
            model_b: bModel,
            companyid,
            keydevid,
            meeting_key: meetingKey,
            match_type: `${bModel}_unique`,
            token_jaccard: 0,
            model_a_unit_id: "",
            model_b_unit_id: u.unit_id,
            model_a_confidence: "",
            model_b_confidence: u.confidence,
            model_a_evidence_class: "",
            model_b_evidence_class: u.evidence_class,
            model_a_code_count: "",
            model_b_code_count: u.codes.length,
            model_a_labels: "",
            model_b_labels: u.codes.map((c) => c.label).join(" | "),
            model_a_source_json: "",
            model_b_source_json: sourceJsonRel(bModel, companyid, keydevid),
            model_a_text: "",
            model_b_text: u.text
          });
        });

        const summary = pairSummaries[pairName];
        summary.shared_meetings += 1;
        summary.exact_matches += exact;
        summary.containment_matches += containment;
        summary.fuzzy_matches += fuzzy;
        summary.total_matches += matchResult.matches.length;
        summary.a_unique_units += matchResult.aUnmatched.length;
        summary.b_unique_units += matchResult.bUnmatched.length;
        summary.mean_abs_unit_count_diff += Math.abs(aUnits.length - bUnits.length);
        summary.mean_abs_code_count_diff += Math.abs(aCodes - bCodes);
      }
      const summary = pairSummaries[pairName];
      summary.mean_abs_unit_count_diff /= Math.max(summary.shared_meetings, 1);
      summary.mean_abs_code_count_diff /= Math.max(summary.shared_meetings, 1);
      summary.exact_match_share = summary.exact_matches / Math.max(summary.total_matches, 1);
      summary.containment_match_share = summary.containment_matches / Math.max(summary.total_matches, 1);
      summary.fuzzy_match_share = summary.fuzzy_matches / Math.max(summary.total_matches, 1);
    }
  }
  return { rows, unitMatchRows, pairSummaries: Object.values(pairSummaries) };
}

function buildConsensus(modelDataByName, allMeetingKeys) {
  const consensusCounts = {
    components: 0,
    three_model_components: 0,
    two_model_components: 0,
    one_model_components: 0
  };
  const uniqueUnits = [];
  const unitToEvidenceCluster = new Map();
  const evidenceClusterRows = [];
  for (const meetingKey of allMeetingKeys) {
    const units = [];
    for (const model of MODELS) {
      const meeting = modelDataByName[model].meetings.get(meetingKey);
      if (meeting) units.push(...meeting.units);
    }
    if (!units.length) continue;
    const uf = new UnionFind(units.map(componentKey));
    for (let i = 0; i < units.length; i++) {
      for (let j = i + 1; j < units.length; j++) {
        if (units[i].model === units[j].model) continue;
        if (compareUnits(units[i], units[j]).matchType !== "none") {
          uf.union(componentKey(units[i]), componentKey(units[j]));
        }
      }
    }
    const components = new Map();
    units.forEach((unit) => {
      const root = uf.find(componentKey(unit));
      if (!components.has(root)) components.set(root, []);
      components.get(root).push(unit);
    });
    for (const component of components.values()) {
      const modelSet = new Set(component.map((unit) => unit.model));
      consensusCounts.components += 1;
      const evidenceClusterId = `EVC_${String(consensusCounts.components).padStart(5, "0")}`;
      component.forEach((unit) => unitToEvidenceCluster.set(unit.globalUnitId, evidenceClusterId));
      const first = component[0];
      evidenceClusterRows.push({
        evidence_cluster_id: evidenceClusterId,
        companyid: first.companyid,
        keydevid: first.keydevid,
        meeting_key: first.meetingKey,
        model_count: modelSet.size,
        models_present: [...modelSet].sort().join("|"),
        unit_count: component.length,
        unit_ids: component.map((unit) => `${unit.model}:${unit.unit_id}`).join("|"),
        evidence_class_set: [...new Set(component.map((unit) => unit.evidence_class))].sort().join("|"),
        sample_text: component.sort((a, b) => a.words - b.words)[0]?.text || ""
      });
      if (modelSet.size === 3) consensusCounts.three_model_components += 1;
      else if (modelSet.size === 2) consensusCounts.two_model_components += 1;
      else {
        consensusCounts.one_model_components += 1;
        uniqueUnits.push(component[0]);
      }
    }
  }
  return { consensusCounts, uniqueUnits, unitToEvidenceCluster, evidenceClusterRows };
}

function labelFamilyRows(modelDataByName) {
  const families = new Map();
  for (const model of MODELS) {
    for (const unit of modelDataByName[model].allUnits) {
      for (const code of unit.codes) {
        if (!code.family) continue;
        if (!families.has(code.family)) {
          families.set(code.family, {
            label_family: code.family,
            total_codes: 0,
            models_present: new Set(),
            sample_labels: new Set(),
            "5.5_codes": 0,
            "5.4_codes": 0,
            "5.4mini_codes": 0
          });
        }
        const row = families.get(code.family);
        row.total_codes += 1;
        row[`${model}_codes`] += 1;
        row.models_present.add(model);
        if (row.sample_labels.size < 5) row.sample_labels.add(code.label);
      }
    }
  }
  return [...families.values()]
    .map((row) => ({
      ...row,
      models_present: [...row.models_present].sort().join("|"),
      model_count: row.models_present.size,
      sample_labels: [...row.sample_labels].join(" | ")
    }))
    .sort((a, b) => b.total_codes - a.total_codes || b.model_count - a.model_count);
}

function chooseCanonicalLabel(codes) {
  const counts = new Map();
  for (const code of codes) {
    const key = code.normLabel || code.normalized_label || normalizeLoose(code.label);
    if (!key) continue;
    if (!counts.has(key)) counts.set(key, { count: 0, labels: [] });
    counts.get(key).count += 1;
    counts.get(key).labels.push(code.label);
  }
  const candidates = [...counts.entries()]
    .sort((a, b) => b[1].count - a[1].count || a[0].length - b[0].length);
  if (!candidates.length) return codes[0]?.semantic_signature || "";
  return candidates[0][1].labels
    .sort((a, b) => a.length - b.length || a.localeCompare(b))[0];
}

function isGloballyMergeableSignature(signature) {
  const tokens = String(signature || "").split(/\s+/).filter(Boolean);
  if (tokens.length >= 3) return true;
  const specificCompoundTokens = new Set([
    "computer_vision",
    "customer_service",
    "data_center",
    "deep_learning",
    "drug_discovery",
    "foundation_model",
    "recurring_revenue",
    "use_case"
  ]);
  return tokens.length >= 2 && tokens.some((tok) => specificCompoundTokens.has(tok));
}

function flattenOpenCodes(modelDataByName, unitToEvidenceCluster) {
  const rows = [];
  for (const model of MODELS) {
    for (const unit of modelDataByName[model].allUnits) {
      const evidenceClusterId = unitToEvidenceCluster.get(unit.globalUnitId) || `EVC_UNMAPPED_${unit.globalUnitId}`;
      unit.codes.forEach((code, codeIndex) => {
        rows.push({
          model,
          companyid: unit.companyid,
          keydevid: unit.keydevid,
          meeting_key: unit.meetingKey,
          evidence_cluster_id: evidenceClusterId,
          global_unit_id: unit.globalUnitId,
          unit_id: unit.unit_id,
          code_id: code.code_id,
          global_code_id: `${unit.globalUnitId}:${code.code_id}:${codeIndex}`,
          confidence: unit.confidence,
          evidence_class: unit.evidence_class,
          label: code.label,
          normalized_label: code.normLabel,
          label_family: code.family,
          semantic_signature: code.semantic_signature,
          source_json: sourceJsonRel(model, unit.companyid, unit.keydevid),
          code_text: code.text,
          rationale: code.rationale,
          unit_text: unit.text
        });
      });
    }
  }
  return rows;
}

function buildSemanticCanonicalization(modelDataByName, unitToEvidenceCluster, evidenceClusterRows) {
  const allCodes = flattenOpenCodes(modelDataByName, unitToEvidenceCluster);
  const ids = allCodes.map((code) => code.global_code_id);
  const uf = new UnionFind(ids);
  const bySignature = new Map();
  const byEvidenceCluster = new Map();
  const byId = new Map(allCodes.map((code) => [code.global_code_id, code]));

  for (const code of allCodes) {
    if (isGloballyMergeableSignature(code.semantic_signature)) {
      if (!bySignature.has(code.semantic_signature)) bySignature.set(code.semantic_signature, []);
      bySignature.get(code.semantic_signature).push(code);
    }
    if (!byEvidenceCluster.has(code.evidence_cluster_id)) byEvidenceCluster.set(code.evidence_cluster_id, []);
    byEvidenceCluster.get(code.evidence_cluster_id).push(code);
  }

  for (const group of bySignature.values()) {
    for (let i = 1; i < group.length; i++) {
      uf.union(group[0].global_code_id, group[i].global_code_id);
    }
  }

  for (const group of byEvidenceCluster.values()) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        if (isSemanticCodeMatch(group[i], group[j], true)) {
          uf.union(group[i].global_code_id, group[j].global_code_id);
        }
      }
    }
  }

  const groups = new Map();
  for (const code of allCodes) {
    const root = uf.find(code.global_code_id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(code);
  }

  const sortedGroups = [...groups.values()].sort((a, b) => {
    const aLabel = chooseCanonicalLabel(a);
    const bLabel = chooseCanonicalLabel(b);
    return b.length - a.length || aLabel.localeCompare(bLabel);
  });

  const rootToCanonical = new Map();
  const canonicalCodebookRows = [];
  sortedGroups.forEach((codes, index) => {
    const canonicalCodeId = `CAN_${String(index + 1).padStart(5, "0")}`;
    const canonicalLabel = chooseCanonicalLabel(codes);
    const signatureCounts = new Map();
    const rawLabels = new Set();
    const modelCounts = Object.fromEntries(MODELS.map((model) => [`${model}_codes`, 0]));
    codes.forEach((code) => {
      rawLabels.add(code.label);
      signatureCounts.set(code.semantic_signature, (signatureCounts.get(code.semantic_signature) || 0) + 1);
      modelCounts[`${code.model}_codes`] += 1;
    });
    const dominantSignature = [...signatureCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] || "";
    const modelsPresent = new Set(codes.map((code) => code.model));
    const evidenceClusters = new Set(codes.map((code) => code.evidence_cluster_id));
    const meetings = new Set(codes.map((code) => code.meeting_key));
    codes.forEach((code) => rootToCanonical.set(uf.find(code.global_code_id), canonicalCodeId));
    canonicalCodebookRows.push({
      canonical_code_id: canonicalCodeId,
      canonical_label: canonicalLabel,
      semantic_signature: dominantSignature,
      total_codes: codes.length,
      model_count: modelsPresent.size,
      models_present: [...modelsPresent].sort().join("|"),
      ...modelCounts,
      evidence_cluster_count: evidenceClusters.size,
      meeting_count: meetings.size,
      raw_label_variant_count: rawLabels.size,
      sample_raw_labels: [...rawLabels].sort().slice(0, 8).join(" | "),
      sample_code_texts: [...new Set(codes.map((code) => code.code_text).filter(Boolean))].slice(0, 3).join(" || ")
    });
  });

  const canonicalById = new Map(canonicalCodebookRows.map((row) => [row.canonical_code_id, row]));
  const mappingRows = allCodes.map((code) => {
    const canonicalCodeId = rootToCanonical.get(uf.find(code.global_code_id));
    const canonical = canonicalById.get(canonicalCodeId);
    return {
      ...code,
      canonical_code_id: canonicalCodeId,
      canonical_label: canonical?.canonical_label || "",
      canonical_signature: canonical?.semantic_signature || ""
    };
  });

  const duplicateAuditRows = canonicalCodebookRows
    .filter((row) => row.total_codes > 1 && row.raw_label_variant_count > 1)
    .sort((a, b) => b.total_codes - a.total_codes || b.raw_label_variant_count - a.raw_label_variant_count)
    .map((row) => ({
      canonical_code_id: row.canonical_code_id,
      canonical_label: row.canonical_label,
      semantic_signature: row.semantic_signature,
      total_codes: row.total_codes,
      model_count: row.model_count,
      models_present: row.models_present,
      raw_label_variant_count: row.raw_label_variant_count,
      evidence_cluster_count: row.evidence_cluster_count,
      sample_raw_labels: row.sample_raw_labels,
      sample_code_texts: row.sample_code_texts
    }));

  const consistencyRows = evidenceClusterRows.map((cluster) => {
    const codes = mappingRows.filter((code) => code.evidence_cluster_id === cluster.evidence_cluster_id);
    const row = {
      evidence_cluster_id: cluster.evidence_cluster_id,
      companyid: cluster.companyid,
      keydevid: cluster.keydevid,
      meeting_key: cluster.meeting_key,
      evidence_model_count: cluster.model_count,
      evidence_models_present: cluster.models_present,
      raw_code_count: codes.length,
      canonical_code_count: new Set(codes.map((code) => code.canonical_code_id)).size
    };
    const rawSets = {};
    const canonicalSets = {};
    for (const model of MODELS) {
      const modelCodes = codes.filter((code) => code.model === model);
      rawSets[model] = new Set(modelCodes.map((code) => code.normalized_label).filter(Boolean));
      canonicalSets[model] = new Set(modelCodes.map((code) => code.canonical_code_id).filter(Boolean));
      row[`${model}_raw_labels`] = [...rawSets[model]].sort().join("|");
      row[`${model}_canonical_codes`] = [...canonicalSets[model]].sort().join("|");
      row[`${model}_canonical_labels`] = [...new Set(modelCodes.map((code) => code.canonical_label).filter(Boolean))].sort().join("|");
    }
    const presentModels = MODELS.filter((model) => rawSets[model].size || canonicalSets[model].size);
    const rawPairScores = [];
    const canonicalPairScores = [];
    for (let i = 0; i < presentModels.length; i++) {
      for (let j = i + 1; j < presentModels.length; j++) {
        rawPairScores.push(jaccard(rawSets[presentModels[i]], rawSets[presentModels[j]]));
        canonicalPairScores.push(jaccard(canonicalSets[presentModels[i]], canonicalSets[presentModels[j]]));
      }
    }
    const meanRaw = rawPairScores.reduce((sum, score) => sum + score, 0) / Math.max(rawPairScores.length, 1);
    const meanCanonical = canonicalPairScores.reduce((sum, score) => sum + score, 0) / Math.max(canonicalPairScores.length, 1);
    row.mean_pairwise_raw_label_jaccard = meanRaw;
    row.mean_pairwise_semantic_code_jaccard = meanCanonical;
    row.semantic_gain = meanCanonical - meanRaw;
    row.shared_canonical_code_count = [...new Set(codes.map((code) => code.canonical_code_id))]
      .filter((canonicalId) => MODELS.filter((model) => canonicalSets[model].has(canonicalId)).length >= 2).length;
    row.three_model_canonical_code_count = [...new Set(codes.map((code) => code.canonical_code_id))]
      .filter((canonicalId) => MODELS.filter((model) => canonicalSets[model].has(canonicalId)).length >= 3).length;
    row.sample_text = cluster.sample_text;
    return row;
  });

  const semanticAgreementRows = [];
  for (let i = 0; i < MODELS.length; i++) {
    for (let j = i + 1; j < MODELS.length; j++) {
      const a = MODELS[i];
      const b = MODELS[j];
      const eligible = consistencyRows.filter((row) => row[`${a}_canonical_codes`] && row[`${b}_canonical_codes`]);
      const rawScores = eligible.map((row) => jaccard(new Set(row[`${a}_raw_labels`].split("|").filter(Boolean)), new Set(row[`${b}_raw_labels`].split("|").filter(Boolean))));
      const canonicalScores = eligible.map((row) => jaccard(new Set(row[`${a}_canonical_codes`].split("|").filter(Boolean)), new Set(row[`${b}_canonical_codes`].split("|").filter(Boolean))));
      const meanRaw = rawScores.reduce((sum, score) => sum + score, 0) / Math.max(rawScores.length, 1);
      const meanCanonical = canonicalScores.reduce((sum, score) => sum + score, 0) / Math.max(canonicalScores.length, 1);
      semanticAgreementRows.push({
        pair: `${a} vs ${b}`,
        model_a: a,
        model_b: b,
        shared_evidence_clusters: eligible.length,
        mean_raw_label_jaccard: meanRaw,
        mean_semantic_code_jaccard: meanCanonical,
        mean_semantic_gain: meanCanonical - meanRaw,
        clusters_with_semantic_gain: eligible.filter((row) => row.semantic_gain > 0.001).length,
        clusters_with_shared_canonical_code: eligible.filter((row) => row.shared_canonical_code_count > 0).length
      });
    }
  }

  const modelSemanticRows = MODELS.map((model) => {
    const modelCodes = mappingRows.filter((code) => code.model === model);
    const rawLabels = new Set(modelCodes.map((code) => code.normalized_label).filter(Boolean));
    const lexicalFamilies = new Set(modelCodes.map((code) => code.label_family).filter(Boolean));
    const canonicalCodes = new Set(modelCodes.map((code) => code.canonical_code_id).filter(Boolean));
    return {
      model,
      raw_codes: modelCodes.length,
      unique_normalized_labels: rawLabels.size,
      label_families: lexicalFamilies.size,
      semantic_canonical_codes: canonicalCodes.size,
      semantic_codebook_per_code_rate: canonicalCodes.size / Math.max(modelCodes.length, 1),
      canonical_reduction_vs_raw_labels: 1 - (canonicalCodes.size / Math.max(rawLabels.size, 1)),
      canonical_reduction_vs_label_families: 1 - (canonicalCodes.size / Math.max(lexicalFamilies.size, 1))
    };
  });

  const globalSummary = {
    raw_codes: mappingRows.length,
    unique_normalized_labels: new Set(mappingRows.map((code) => code.normalized_label).filter(Boolean)).size,
    label_families: new Set(mappingRows.map((code) => code.label_family).filter(Boolean)).size,
    semantic_canonical_codes: canonicalCodebookRows.length,
    canonical_reduction_vs_raw_labels: 1 - (canonicalCodebookRows.length / Math.max(new Set(mappingRows.map((code) => code.normalized_label).filter(Boolean)).size, 1)),
    canonical_reduction_vs_label_families: 1 - (canonicalCodebookRows.length / Math.max(new Set(mappingRows.map((code) => code.label_family).filter(Boolean)).size, 1)),
    mean_pairwise_raw_label_jaccard: semanticAgreementRows.reduce((sum, row) => sum + row.mean_raw_label_jaccard, 0) / Math.max(semanticAgreementRows.length, 1),
    mean_pairwise_semantic_code_jaccard: semanticAgreementRows.reduce((sum, row) => sum + row.mean_semantic_code_jaccard, 0) / Math.max(semanticAgreementRows.length, 1)
  };
  globalSummary.mean_semantic_gain = globalSummary.mean_pairwise_semantic_code_jaccard - globalSummary.mean_pairwise_raw_label_jaccard;

  return {
    allOpenCodeRows: mappingRows,
    canonicalCodebookRows,
    duplicateAuditRows,
    consistencyRows,
    semanticAgreementRows,
    modelSemanticRows,
    semanticGlobalSummary: globalSummary
  };
}

function boundaryRows(modelDataByName) {
  const rows = [];
  for (const model of MODELS) {
    for (const unit of modelDataByName[model].allUnits) {
      rows.push({
        model,
        companyid: unit.companyid,
        keydevid: unit.keydevid,
        unit_id: unit.unit_id,
        confidence: unit.confidence,
        evidence_class: unit.evidence_class,
        words: unit.words,
        code_count: unit.codes.length,
        labels: unit.codes.map((c) => c.label).join(" | "),
        source_json: sourceJsonRel(model, unit.companyid, unit.keydevid),
        text: unit.text
      });
    }
  }
  return rows;
}

function pickDisagreementExamples(modelDataByName, pairRows, uniqueUnits) {
  const missing = [];
  const allMeetingKeys = new Set();
  MODELS.forEach((model) => modelDataByName[model].meetings.forEach((_, key) => allMeetingKeys.add(key)));
  for (const key of allMeetingKeys) {
    const present = MODELS.filter((model) => modelDataByName[model].meetings.has(key));
    if (present.length < MODELS.length) {
      const [companyid, keydevid] = key.split(":");
      missing.push({ companyid, keydevid, present_models: present, missing_models: MODELS.filter((m) => !present.includes(m)) });
    }
  }
  const highDivergence = [...pairRows]
    .sort((a, b) => b.abs_unit_count_diff - a.abs_unit_count_diff || b.abs_code_count_diff - a.abs_code_count_diff)
    .slice(0, 12);
  const uniqueByModel = {};
  for (const model of MODELS) {
    uniqueByModel[model] = uniqueUnits
      .filter((unit) => unit.model === model)
      .sort((a, b) => {
        const riskA = a.evidence_class === "generic_digital_risk" ? 1 : 0;
        const riskB = b.evidence_class === "generic_digital_risk" ? 1 : 0;
        return riskB - riskA || b.codes.length - a.codes.length;
      })
      .slice(0, 8)
      .map((unit) => ({
        companyid: unit.companyid,
        keydevid: unit.keydevid,
        unit_id: unit.unit_id,
        confidence: unit.confidence,
        evidence_class: unit.evidence_class,
        code_count: unit.codes.length,
        labels: unit.codes.map((c) => c.label),
        source_json: sourceJsonRel(unit.model, unit.companyid, unit.keydevid),
        text: unit.text
      }));
  }
  return { missing_outputs: missing, high_divergence_meetings: highDivergence, unique_units_by_model: uniqueByModel };
}

function table(headers, rows, mapRow) {
  const renderHeader = (header) => {
    if (typeof header === "object" && header.html) return header.html;
    return escapeHtml(header);
  };
  return `<table><thead><tr>${headers.map((h) => `<th>${renderHeader(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${mapRow(row).map((cell) => `<td>${cell}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}

function tip(label, detail) {
  return {
    html: `<span class="tip" tabindex="0">${escapeHtml(label)}<span class="tip-bubble">${escapeHtml(detail)}</span></span>`
  };
}

function bi(zh) {
  return `<span class="bi">${escapeHtml(zh)}</span>`;
}

function sectionTitle(icon, title) {
  return `<h2 class="section-title"><i class="fa-solid ${escapeHtml(icon)}"></i>${bi(title)}</h2>`;
}

function generateHtml(reportData) {
  const { generated_at, skillProvenance, pricingSource, benchmarkInputSummary, benchmarkModelRequests, modelSummaries, pairSummaries, consensus, labelRows, semantic, boundaryExamples, disagreementExamples, promptAuditRows, improvedPrompt, outputFiles } = reportData;
  const topFamilies = labelRows.slice(0, 15);
  const topCanonicalCodes = (semantic?.canonicalCodebookRows || []).slice().sort((a, b) => b.total_codes - a.total_codes).slice(0, 15);
  const summaryValue = (metric) => benchmarkInputSummary?.find((row) => row.metric === metric)?.value ?? 0;
  const provenanceRows = [
    { field: "Skill", value: skillProvenance?.name || "" },
    { field: "Skill version", value: skillProvenance?.version || "" },
    { field: "GitHub", value: `<a href="${htmlAttr(skillProvenance?.github_url || "")}" target="_blank" rel="noopener">${escapeHtml(skillProvenance?.github_url || "")}</a>` },
    { field: "Skill path", value: escapeHtml(skillProvenance?.skill_path || "") },
    { field: "Input origin", value: `<a href="${htmlAttr(skillProvenance?.input_origin_url || "")}" target="_blank" rel="noopener">${escapeHtml(skillProvenance?.input_origin_url || "")}</a>` },
    { field: "Input process", value: escapeHtml(skillProvenance?.input_origin_description || "") }
  ];
  const provenanceTable = table(
    ["字段", "值"],
    provenanceRows,
    (r) => [escapeHtml(r.field), r.value]
  );
  const dataStructurePreview = (skillProvenance?.data_structure || [])
    .map((line) => `<li><code>${escapeHtml(line)}</code></li>`)
    .join("");
  const benchmarkSummaryTable = table(
    [
      tip("指标", "用于说明这批 benchmark 输入和 Batch 输出的基本规模。"),
      "数值",
      tip("说明", "解释这个数值的计算口径。")
    ],
    benchmarkInputSummary || [],
    (r) => [
      escapeHtml(r.metric),
      typeof r.value === "number" ? num(r.value, Number.isInteger(r.value) ? 0 : 4) : escapeHtml(r.value),
      escapeHtml(r.note)
    ]
  );
  const benchmarkRequestTable = table(
    [
      "模型",
      tip("Expected requests", "按三模型会议并集计算，每个模型应该处理的 companyid:keydevid 请求数。"),
      tip("Output files", "实际收集到的 open-coding JSON 文件数。"),
      tip("Missing", "相对三模型会议并集缺少的输出数。"),
      tip("Usage records", "找到 raw Batch usage 的响应记录数。"),
      tip("Empty", "返回空 JSON 数组的输出数。"),
      tip("Nonempty", "至少有一个 meaning unit 的输出数。"),
      "公司数",
      "Input tokens",
      "Output tokens",
      "Batch 成本"
    ],
    benchmarkModelRequests || [],
    (r) => [
      escapeHtml(r.model),
      r.expected_requests,
      r.collected_output_files,
      r.missing_outputs,
      r.usage_records,
      r.empty_outputs,
      r.nonempty_outputs,
      r.companies,
      Number(r.input_tokens).toLocaleString("en-US"),
      Number(r.output_tokens).toLocaleString("en-US"),
      `$${num(r.estimated_batch_cost_usd, 4)}`
    ]
  );
  const modelSummaryTable = table(
    [
      "模型",
      tip("文件", "该模型成功收集到的 open-coding JSON 文件数量。不同模型文件数不一致会影响配对比较。"),
      tip("非空会议", "JSON 中至少有一个 meaning unit 的会议数量；越高代表模型识别出更多 AI 讨论会议。"),
      tip("Units", "Meaning units，总共被模型选中的 AI 相关证据片段。多不一定更好，需结合边界风险。"),
      tip("Open codes 数量", "开放编码条目总数，来自每个 meaning unit 里的 codes[] 数组；这就是 open coding 产出的 code 数。"),
      tip("Open codes/Unit", "平均每个 evidence unit 生成几个 open codes；越高通常代表编码更细，但也可能更碎片化。"),
      tip("Unique labels", "去重后的原始 open-code label 数量，用来观察标签分散程度。"),
      tip("Label families", "轻量归并后的 label family 数量，用来估计 codebook 归并压力。"),
      tip("Canonical codes", "新增语义规范化层后的 canonical code 数量；保留 raw label，不覆盖原始开放编码。"),
      tip("Batch 成本", "按 raw batch usage 和官方 Batch 折扣价计算的美元成本。"),
      tip("成本/Unit", "每产生一个 meaning unit 的平均成本；用于比较研究产出效率。"),
      tip("Generic Risk", "缺少明确 AI 词、但包含 digital/data/cloud/analytics 等泛技术词的片段比例；这是人工复核优先级，不是自动错误率。")
    ],
    modelSummaries,
    (r) => [
      escapeHtml(r.model),
      r.output_files,
      r.nonempty_files,
      r.units,
      r.codes,
      num(r.avg_codes_per_unit),
      r.unique_normalized_labels,
      r.label_families,
      r.semantic_canonical_codes,
      `${num(r.estimated_batch_cost_usd, 4)}`,
      `$${num(r.cost_per_unit_usd, 5)}`,
      pct(r.generic_digital_risk_rate)
    ]
  );
  const costTable = table(
    [
      "模型",
      tip("标准 input/output", "OpenAI 官方标准处理价格，单位是美元/1M tokens。"),
      tip("Batch input/output", "标准价乘以 Batch API 50% 折扣后的有效价格。"),
      tip("Input tokens", "本地 raw batch response 记录的输入 token 总量。"),
      tip("Output tokens", "本地 raw batch response 记录的输出 token 总量；输出价通常比输入价高。"),
      tip("估算 Batch 成本", "input、cached input、output 分别按 Batch 价格计算后相加。"),
      tip("成本/非空会议", "总成本除以产生至少一个 meaning unit 的会议数。"),
      tip("成本/code", "总成本除以开放编码 code 总数；适合看 code 产出效率。"),
      tip("成本/非风险 unit", "总成本除以非 generic_digital_risk 的 units；用来降低边界宽松造成的虚高产出。")
    ],
    modelSummaries,
    (r) => [
      escapeHtml(r.model),
      `$${num(r.standard_input_per_1m_usd, 3)} / $${num(r.standard_output_per_1m_usd, 3)}`,
      `$${num(r.batch_input_per_1m_usd, 3)} / $${num(r.batch_output_per_1m_usd, 3)}`,
      r.input_tokens.toLocaleString("en-US"),
      r.output_tokens.toLocaleString("en-US"),
      `$${num(r.estimated_batch_cost_usd, 4)}`,
      `$${num(r.cost_per_nonempty_file_usd, 5)}`,
      `$${num(r.cost_per_code_usd, 5)}`,
      `$${num(r.cost_per_non_generic_risk_unit_usd, 5)}`
    ]
  );
  const pairSummaryTable = table(
    [
      "模型对",
      tip("共享会议", "两个模型都存在输出文件的会议数。"),
      tip("匹配 Units", "按 exact、containment、fuzzy 三种规则能配对上的 evidence units。"),
      tip("Exact", "两个模型选择的 unit text 完全一致。"),
      tip("Containment", "一个模型的 unit 包含另一个模型的 unit，常见于证据边界不同。"),
      tip("Fuzzy", "token Jaccard 达到阈值的近似匹配，用于发现文字不完全一样但内容接近的片段。"),
      tip("平均 Unit 差", "同一会议中两个模型 meaning unit 数量差的平均绝对值。"),
      tip("平均 Code 差", "同一会议中两个模型 code 数量差的平均绝对值。")
    ],
    pairSummaries,
    (r) => [
      escapeHtml(r.pair),
      r.shared_meetings,
      r.total_matches,
      `${r.exact_matches} (${pct(r.exact_match_share)})`,
      `${r.containment_matches} (${pct(r.containment_match_share)})`,
      `${r.fuzzy_matches} (${pct(r.fuzzy_match_share)})`,
      num(r.mean_abs_unit_count_diff),
      num(r.mean_abs_code_count_diff)
    ]
  );
  const validationTable = table(
    [
      "模型",
      tip("缺失文件", "相对于三模型输出并集，该模型缺少的会议 JSON 文件数。"),
      tip("空文件", "合法 JSON 但返回空数组，表示该会议没有被编码出 AI meaning units。"),
      tip("Validation 问题", "格式和证据纪律问题总数；不是理论质量评分，但影响可审计性。"),
      tip("code.text 不在 unit.text", "prompt 要求 code.text 必须来自 unit.text；不满足时需要优先人工检查。"),
      tip("Bad confidence", "confidence 字段不属于 high/medium。"),
      tip("Codes 非数组", "codes 字段不是数组，说明结构不符合规范。")
    ],
    modelSummaries,
    (r) => [
      escapeHtml(r.model),
      r.missing_files_vs_union,
      r.empty_files,
      r.validation_problem_count,
      r.code_text_not_in_unit_text,
      r.bad_confidence,
      r.codes_not_array
    ]
  );
  const missingTable = disagreementExamples.missing_outputs.length
    ? table(
      ["公司", "会议", "存在模型", "缺失模型"],
      disagreementExamples.missing_outputs,
      (r) => [
        escapeHtml(r.companyid),
        escapeHtml(r.keydevid),
        escapeHtml(r.present_models.join(" | ")),
        escapeHtml(r.missing_models.join(" | "))
      ]
    )
    : "<p>三组模型覆盖完全一致，没有缺失会议文件。</p>";
  const familyTable = table(
    [
      tip("Label Family", "轻量词汇归并后的标签族，用于发现近义 label；不是最终语义 codebook。"),
      tip("总 codes", "该 label family 下汇总到的 code 数。"),
      tip("模型数", "有多少个模型产生过该 label family。"),
      "5.5",
      "5.4",
      "5.4mini",
      tip("样例 labels", "该 family 下出现过的原始 label 示例，便于人工判断是否真应归并。")
    ],
    topFamilies,
    (r) => [
      escapeHtml(r.label_family),
      r.total_codes,
      r.model_count,
      r["5.5_codes"],
      r["5.4_codes"],
      r["5.4mini_codes"],
      escapeHtml(r.sample_labels)
    ]
  );
  const semanticModelTable = table(
    [
      "模型",
      tip("Raw codes", "该模型原始 open-code 条目总数。"),
      tip("Unique labels", "只做大小写/标点/空白规范化后的 label 数。"),
      tip("Label families", "当前轻量词汇归并后的 label family 数。"),
      tip("Canonical codes", "新增 semantic canonicalization 后的唯一概念数。"),
      tip("压缩 raw labels", "Canonical codes 相对 unique normalized labels 的减少比例。"),
      tip("压缩 label families", "Canonical codes 相对 lightweight label families 的减少比例。")
    ],
    semantic?.modelSemanticRows || [],
    (r) => [
      escapeHtml(r.model),
      r.raw_codes,
      r.unique_normalized_labels,
      r.label_families,
      r.semantic_canonical_codes,
      pct(r.canonical_reduction_vs_raw_labels),
      pct(r.canonical_reduction_vs_label_families)
    ]
  );
  const semanticAgreementTable = table(
    [
      "模型对",
      tip("共享 evidence clusters", "两个模型都在同一 evidence cluster 下产生了 codes 的 cluster 数。"),
      tip("Raw label Jaccard", "在共享 evidence cluster 内，两个模型 raw normalized labels 的平均集合相似度。"),
      tip("Semantic code Jaccard", "映射到 canonical_code_id 后的平均集合相似度。"),
      tip("Semantic gain", "Semantic code Jaccard 减 raw label Jaccard。大于 0 表示同义漂移被归并后，一致性更清楚。"),
      tip("有提升 clusters", "semantic_gain > 0 的 evidence clusters 数。"),
      tip("有共享 canonical code", "两个模型至少共享一个 canonical code 的 evidence clusters 数。")
    ],
    semantic?.semanticAgreementRows || [],
    (r) => [
      escapeHtml(r.pair),
      r.shared_evidence_clusters,
      pct(r.mean_raw_label_jaccard),
      pct(r.mean_semantic_code_jaccard),
      pct(r.mean_semantic_gain),
      r.clusters_with_semantic_gain,
      r.clusters_with_shared_canonical_code
    ]
  );
  const canonicalCodeTable = table(
    [
      tip("Canonical Code", "语义规范化后的唯一 code id。"),
      tip("Canonical Label", "保留原始 label 中最具代表性的短标签作为 canonical label。"),
      "总 codes",
      "模型数",
      "5.5",
      "5.4",
      "5.4mini",
      tip("Raw label variants", "被归到同一 canonical code 的不同原始 label 数。"),
      tip("样例 raw labels", "用于人工审计 canonical 合并是否合理。")
    ],
    topCanonicalCodes,
    (r) => [
      escapeHtml(r.canonical_code_id),
      escapeHtml(r.canonical_label),
      r.total_codes,
      r.model_count,
      r["5.5_codes"],
      r["5.4_codes"],
      r["5.4mini_codes"],
      r.raw_label_variant_count,
      escapeHtml(r.sample_raw_labels)
    ]
  );
  const boundaryTable = table(
    [
      "模型",
      "公司",
      "会议",
      tip("源文件", "点击打开该模型对该会议的 open-coding JSON。链接是相对路径，移动整个项目目录后仍可使用。"),
      tip("置信度", "模型自己给出的 AI-relatedness certainty，只允许 high 或 medium。"),
      tip("风险类", "词汇规则标记的 evidence 类型；generic_digital_risk 表示需要人工复核。"),
      "Codes",
      "Labels",
      tip("Evidence", "模型选中的原文 meaning unit。审计时优先看这段是否真的具备 AI/ML/model-driven 语境。")
    ],
    boundaryExamples,
    (r) => [
      escapeHtml(r.model),
      escapeHtml(r.companyid),
      escapeHtml(r.keydevid),
      sourceLink(r.model, r.companyid, r.keydevid),
      escapeHtml(r.confidence),
      escapeHtml(r.evidence_class),
      r.code_count,
      escapeHtml(r.labels),
      `<span class="quote">${escapeHtml(r.text)}</span>`
    ]
  );
  const divergenceTable = table(
    [
      "模型对",
      "公司",
      "会议",
      tip("A units", "pair 中第一个模型在该会议的 meaning unit 数。"),
      tip("B units", "pair 中第二个模型在该会议的 meaning unit 数。"),
      tip("A codes", "pair 中第一个模型在该会议的 code 数。"),
      tip("B codes", "pair 中第二个模型在该会议的 code 数。"),
      tip("Unit 差", "两个模型在该会议 unit 数的差异。"),
      tip("Code 差", "两个模型在该会议 code 数的差异。")
    ],
    disagreementExamples.high_divergence_meetings.slice(0, 10),
    (r) => [
      escapeHtml(r.pair),
      escapeHtml(r.companyid),
      escapeHtml(r.keydevid),
      r.model_a_units,
      r.model_b_units,
      r.model_a_codes,
      r.model_b_codes,
      r.abs_unit_count_diff,
      r.abs_code_count_diff
    ]
  );
  const uniqueCards = MODELS.map((model) => {
    const items = disagreementExamples.unique_units_by_model[model] || [];
    return `<section class="model-card"><h3>${escapeHtml(model)} 獨有 evidence 樣例 / Unique evidence examples</h3>${items.slice(0, 4).map((item) => `
      <div class="example">
        <div class="meta">company ${escapeHtml(item.companyid)} / keydevid ${escapeHtml(item.keydevid)} / ${escapeHtml(item.confidence)} / ${escapeHtml(item.evidence_class)} / ${sourceLink(model, item.companyid, item.keydevid)}</div>
        <p>${escapeHtml(item.text)}</p>
        <div class="labels">${escapeHtml(item.labels.join(" | "))}</div>
      </div>`).join("")}</section>`;
  }).join("");

  const recommendationRows = [
    {
      model: "5.5",
      use: "适合作为主编码候选：Open codes/Unit 最高，能把同一证据拆出更多机制，利于后续 axial coding；需要注意 label 碎片化和 codebook 归并工作量。"
    },
    {
      model: "5.4",
      use: "适合作为高召回补充：meaning units 总数最高，更容易发现潜在 AI 讨论；需要配合边界风险审计，确认多出来的是有效机制还是过宽纳入。"
    },
    {
      model: "5.4mini",
      use: "适合作为轻量对照：输出更少、unit 更长；部分样例显示它可能把 generic digital/data 讨论纳入 AI，因此更适合做差异审计，而不是单独作为最终编码源。"
    }
  ];
  const recommendationTable = table(["模型", "建议用法"], recommendationRows, (r) => [escapeHtml(r.model), escapeHtml(r.use)]);
  const selectionRows = [
    { dimension: "召回", m55: "中高", m54: "高", mini: "中", note: "衡量模型抓出候选 evidence 的能力。" },
    { dimension: "编码粒度", m55: "高", m54: "中", mini: "中低", note: "主要看 Open codes/Unit、Open codes 数量与 unit 长度。" },
    { dimension: "边界控制", m55: "中", m54: "中", mini: "中", note: "Generic Risk 代表人工复核优先级，不是错误率。" },
    { dimension: "格式可靠性", m55: "较好", m54: "中", mini: "较弱", note: "主要看 validation issues。" },
    { dimension: "成本", m55: "高", m54: "中", mini: "低", note: "按官方 Batch 折扣与 raw usage 计算。" },
    { dimension: "建议用途", m55: "主编码", m54: "补召回", mini: "初筛", note: "场景化选择，不是单一排名。" }
  ];
  const selectionScorecard = table(
    ["选择维度", "5.5", "5.4", "5.4mini", "说明"],
    selectionRows,
    (r) => [escapeHtml(r.dimension), escapeHtml(r.m55), escapeHtml(r.m54), escapeHtml(r.mini), escapeHtml(r.note)]
  );
  const openCodeCountTable = table(
    [
      "模型",
      tip("Meaning units", "模型选中的 evidence 片段数量，也就是开放编码的分析单元数量。"),
      tip("Open codes 数量", "每个 meaning unit 的 codes[] 数组条目总和；这是 open coding 实际产出的 code 条目数。"),
      tip("Open codes/Unit", "Open codes 数量除以 meaning units，用来判断编码粒度。"),
      tip("Unique labels", "去重后的原始 open-code label 数量。"),
      tip("Label families", "轻量词汇归并后的 label family 数量，用来估计 codebook 归并压力。"),
      tip("Canonical codes", "新增 semantic canonicalization 后的唯一概念数。")
    ],
    modelSummaries,
    (r) => [
      escapeHtml(r.model),
      r.units,
      r.codes,
      num(r.avg_codes_per_unit),
      r.unique_normalized_labels,
      r.label_families,
      r.semantic_canonical_codes
    ]
  );
  const promptAuditTable = table(
    [
      tip("Prompt 维度", "把模型差异映射回 prompt 设计：边界、切分、粒度、置信度、格式纪律等。"),
      tip("相关规则", "当前 prompt 中与该维度最相关的约束。"),
      tip("观察信号", "用本次结果中的指标说明该规则执行得怎么样。"),
      tip("评价", "对 prompt 设计本身的解释，不是单个模型评分。"),
      tip("改进建议", "下一轮 prompt 迭代可考虑的具体改法。")
    ],
    promptAuditRows,
    (r) => [
      escapeHtml(r.prompt_dimension),
      escapeHtml(r.related_prompt_rule),
      escapeHtml(r.observed_signal),
      escapeHtml(r.assessment),
      escapeHtml(r.suggested_prompt_improvement)
    ]
  );
  const promptV2SummaryRows = [
    { change: "邊界反例更明確 / Clearer boundary counterexamples", reason: "generic digital/data/cloud/algorithm 是主要歧義面。", effect: "減少把泛數位化討論誤納入 AI 的風險。" },
    { change: "加入 meaning-unit tie-breaker / Add segmentation tie-breaker", reason: "模型常選同一附近證據但邊界不同。", effect: "讓不同模型更穩定地選擇最小完整句。" },
    { change: "细化 open code 拆分规则", reason: "1-4 codes 的自由度让 5.5 明显更细。", effect: "减少无必要碎片化，同时保留多机制证据。" },
    { change: "增加 final self-check / Add final self-check", reason: "仍有少量 containment、confidence、schema 問題。", effect: "提高 JSON 和證據紀律穩定性。" }
  ];
  const promptV2SummaryTable = table(["v2 改动", "为什么要改", "预期效果"], promptV2SummaryRows, (r) => [
    escapeHtml(r.change),
    escapeHtml(r.reason),
    escapeHtml(r.effect)
  ]);
  const guideRows = [
    {
      question: "先看哪个指标？",
      answer: "先看 Meaning units、Open codes 数量、Open codes/Unit、Generic Risk 和 Validation 问题。它们分别回答：抓得多不多、拆得细不细、边界是否偏宽、结果是否可审计。"
    },
    {
      question: "成本怎么看？",
      answer: "成本/Unit 和成本/code 是产出效率；成本/非风险 unit 更稳，因为它降低 generic digital/data 片段造成的产出虚高。"
    },
    {
      question: "Exact overlap 低是不是坏事？",
      answer: "不一定。Batch 结果经常边界不同，所以 containment match 也很重要。Exact 低但 containment 高，通常说明模型看的是同一段附近证据。"
    },
    {
      question: "Generic Risk 是错误率吗？",
      answer: "不是。它只是把 digital/data/cloud/analytics 等泛技术片段标出来，提醒人工确认是否有足够 AI 语境。"
    }
  ];
  const guideTable = table(["问题", "怎么理解"], guideRows, (r) => [escapeHtml(r.question), escapeHtml(r.answer)]);
  const metricFrameworkRows = [
    { family: "完整性与格式可靠性", question: "Batch 输出是否稳定可用？", metrics: "coverage, empty files, invalid JSON, validation issues" },
    { family: "召回与敏感度", question: "模型抓候选 evidence 的能力如何？", metrics: "nonempty rate, units, high/medium confidence, unique units" },
    { family: "边界控制", question: "是否过度纳入 generic digital/data？", metrics: "generic digital risk rate, explicit-vs-implicit AI ratio" },
    { family: "编码粒度与理论可用性", question: "输出是否适合后续 axial coding？", metrics: "codes/unit, unit length, label families, codebook burden" },
    { family: "成本效率", question: "有效研究产出的成本是多少？", metrics: "cost/unit, cost/code, cost/non-risk unit" },
    { family: "Prompt 稳定性", question: "prompt 是否让不同模型产生可比结果？", metrics: "evidence overlap, containment, schema discipline, prompt audit" }
  ];
  const metricFrameworkTable = table(
    ["指标组", "回答的问题", "代表指标"],
    metricFrameworkRows,
    (r) => [escapeHtml(r.family), escapeHtml(r.question), escapeHtml(r.metrics)]
  );
  const modelProfileMeta = {
    "5.5": {
      icon: "fa-layer-group",
      title: "细粒度主编码者",
      thesis: "更愿意把同一证据拆成多个机制，适合产出丰富的开放编码材料。",
      bestFor: "主编码候选、机制提取、后续 axial coding 输入",
      caution: "成本最高，label/codebook 归并压力更大。"
    },
    "5.4": {
      icon: "fa-magnifying-glass-chart",
      title: "高召回发现者",
      thesis: "meaning units 总数最高，更像是在帮你多抓潜在 AI 讨论。",
      bestFor: "召回补充、漏抓检查、模型间分歧发现",
      caution: "需要确认多出来的 units 是有效机制还是边界放宽。"
    },
    "5.4mini": {
      icon: "fa-gauge-high",
      title: "低成本压力测试者",
      thesis: "成本最低、输出更少，适合作为预算敏感的大规模对照。",
      bestFor: "初筛、成本敏感分析、边界压力测试",
      caution: "部分 generic digital/data 片段仍需人工复核。"
    }
  };
  const modelProfileCards = modelSummaries.map((row) => {
    const meta = modelProfileMeta[row.model] || {
      icon: "fa-cube",
      title: "模型画像",
      thesis: "该模型的定位需要结合指标解释。",
      bestFor: "对照分析",
      caution: "需要人工审计。"
    };
    return `<article class="profile-card profile-${escapeHtml(row.model.replace(/[^a-zA-Z0-9]/g, ""))}">
      <div class="profile-head">
        <span class="profile-icon"><i class="fa-solid ${escapeHtml(meta.icon)}"></i></span>
        <div><h3>${escapeHtml(row.model)} · ${escapeHtml(meta.title)}</h3><p>${escapeHtml(meta.thesis)}</p></div>
      </div>
      <div class="profile-stats">
        <div><strong>${row.units}</strong><span>Meaning units</span></div>
        <div><strong>${row.codes}</strong><span>Open codes 数量</span></div>
        <div><strong>${num(row.avg_codes_per_unit)}</strong><span>Open codes/Unit</span></div>
        <div><strong>$${num(row.estimated_batch_cost_usd, 2)}</strong><span>Batch 成本</span></div>
        <div><strong>${pct(row.generic_digital_risk_rate)}</strong><span>Generic Risk</span></div>
      </div>
      <p class="profile-use"><i class="fa-solid fa-circle-check"></i> ${escapeHtml(meta.bestFor)}</p>
      <p class="profile-risk"><i class="fa-solid fa-triangle-exclamation"></i> ${escapeHtml(meta.caution)}</p>
    </article>`;
  }).join("");

  const css = `
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0; color: #182026; background: #f7f8fa; line-height: 1.55; }
    header { background: #12343b; color: white; padding: 38px 48px 30px; }
    header h1 { margin: 0 0 8px; font-size: 30px; letter-spacing: 0; }
    header p { margin: 0; max-width: 980px; color: #dce8ea; }
    .page-shell { max-width: 1480px; margin: 0 auto; padding: 28px; display: grid; grid-template-columns: 230px minmax(0, 1fr); gap: 20px; align-items: start; }
    main { min-width: 0; padding: 0 0 28px; }
    .side-nav { position: sticky; top: 18px; background: white; border: 1px solid #dfe5e8; border-radius: 8px; padding: 14px; max-height: calc(100vh - 36px); overflow: auto; }
    .side-nav h2 { font-size: 13px; color: #52626b; margin: 0 0 10px; text-transform: uppercase; letter-spacing: .04em; }
    .side-nav a { display: flex; align-items: center; gap: 8px; padding: 7px 8px; border-radius: 7px; color: #203038; text-decoration: none; font-size: 13px; line-height: 1.25; }
    .side-nav a:hover { background: #edf3f5; color: #12343b; }
    .side-nav i { width: 15px; color: #2f7d72; text-align: center; }
    section { background: white; border: 1px solid #dfe5e8; border-radius: 8px; padding: 22px; margin: 0 0 18px; scroll-margin-top: 18px; }
    h2 { margin: 0 0 12px; font-size: 21px; }
    h3 { margin: 0 0 10px; font-size: 17px; }
    .bi { display: inline-flex; flex-direction: column; gap: 1px; }
    .grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
    .section-title { display: inline-flex; align-items: center; gap: 9px; }
    .section-title i { color: #2f7d72; font-size: 18px; }
    .metric { border: 1px solid #dfe5e8; border-radius: 8px; padding: 14px; background: #fbfcfd; }
    .metric .value { display: block; font-size: 24px; font-weight: 700; color: #12343b; }
    .metric .label { color: #5d6972; font-size: 13px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { border-bottom: 1px solid #e5eaed; padding: 8px 9px; text-align: left; vertical-align: top; }
    th { background: #edf3f5; font-weight: 650; color: #203038; }
    .note { color: #5d6972; font-size: 13px; }
    .quote { display: block; max-width: 560px; }
    .cards { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
    .profile-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
    .profile-card { background: #fbfcfd; border: 1px solid #dfe5e8; border-radius: 8px; padding: 16px; }
    .profile-head { display: flex; gap: 12px; align-items: flex-start; min-height: 86px; }
    .profile-icon { flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center; width: 42px; height: 42px; border-radius: 8px; background: #e6f2ef; color: #1d6154; font-size: 19px; }
    .profile-head h3 { margin-bottom: 5px; }
    .profile-head p { margin: 0; color: #52626b; font-size: 13px; }
    .profile-stats { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin: 14px 0; }
    .profile-stats div { border: 1px solid #e5eaed; background: white; border-radius: 8px; padding: 9px; }
    .profile-stats strong { display: block; color: #12343b; font-size: 18px; }
    .profile-stats span { color: #64727b; font-size: 12px; }
    .profile-use, .profile-risk { margin: 8px 0 0; font-size: 13px; }
    .profile-use i { color: #1d6154; }
    .profile-risk i { color: #9b5c1a; }
    .model-card { margin: 0; padding: 16px; }
    .example { border-top: 1px solid #e5eaed; padding-top: 10px; margin-top: 10px; }
    .example p { margin: 6px 0; font-size: 13px; }
    .meta, .labels { color: #64727b; font-size: 12px; }
    .pill { display: inline-block; padding: 3px 7px; border-radius: 999px; background: #e6f2ef; color: #1d6154; font-size: 12px; margin-right: 6px; }
    .source-link { display: inline-block; color: #1f6f8b; font-weight: 650; text-decoration: none; border-bottom: 1px solid rgba(31, 111, 139, 0.35); }
    .source-link:hover { color: #12343b; border-bottom-color: #12343b; }
    code { background: #eef2f4; padding: 1px 4px; border-radius: 4px; }
    details { margin-top: 12px; }
    summary { cursor: pointer; color: #12343b; font-weight: 700; }
    pre { white-space: pre-wrap; max-height: 520px; overflow: auto; background: #f5f7f8; border: 1px solid #dfe5e8; border-radius: 8px; padding: 14px; font-size: 12px; line-height: 1.45; }
    ul { margin-top: 8px; }
    .tip { position: relative; display: inline-flex; align-items: center; gap: 4px; cursor: help; border-bottom: 1px dotted #60717a; }
    .tip::after { content: "?"; display: inline-flex; align-items: center; justify-content: center; width: 15px; height: 15px; border-radius: 50%; background: #d7e7ea; color: #12343b; font-size: 10px; font-weight: 700; }
    .tip-bubble { position: absolute; left: 0; top: calc(100% + 8px); z-index: 5; width: min(320px, 72vw); padding: 10px 11px; border-radius: 8px; background: #12343b; color: #fff; box-shadow: 0 8px 24px rgba(18, 52, 59, 0.22); font-weight: 400; line-height: 1.45; opacity: 0; pointer-events: none; transform: translateY(-3px); transition: opacity 120ms ease, transform 120ms ease; }
    .tip:hover .tip-bubble, .tip:focus .tip-bubble { opacity: 1; transform: translateY(0); }
    .read-path { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-top: 12px; }
    .read-step { border-left: 4px solid #2f7d72; background: #f4faf8; padding: 12px; border-radius: 8px; }
    .read-step strong { display: block; color: #12343b; margin-bottom: 4px; }
    .read-step span { color: #52626b; font-size: 13px; }
    @media (max-width: 900px) { .grid, .cards, .profile-grid { grid-template-columns: 1fr; } header { padding: 28px 22px; } .page-shell { display: block; padding: 18px; } .side-nav { position: static; max-height: none; margin-bottom: 18px; } .side-nav a { display: inline-flex; margin: 2px; } }
    @media (max-width: 900px) { .read-path { grid-template-columns: 1fr; } }
  `;

  const largestUnits = modelSummaries.reduce((best, row) => row.units > best.units ? row : best, modelSummaries[0]);
  const densestCodes = modelSummaries.reduce((best, row) => row.avg_codes_per_unit > best.avg_codes_per_unit ? row : best, modelSummaries[0]);
  const highestRisk = modelSummaries.reduce((best, row) => row.generic_digital_risk_rate > best.generic_digital_risk_rate ? row : best, modelSummaries[0]);

  return `<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>5.5 vs 5.4 vs 5.4mini Open-Coding Comparison</title>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css">
  <style>${css}</style>
</head>
<body>
  <header>
    <h1>5.5 / 5.4 / 5.4mini Batch 开放编码模型评估报告</h1>
    <p>用一批随机 benchmark 输入，评估同一 prompt、同一 Batch API 流程下不同模型的输出差异、成本效率、可审计性、模型选择指标与 prompt 改进方向。生成时间：${escapeHtml(generated_at)}</p>
  </header>
  <div class="page-shell">
    <nav class="side-nav" aria-label="报告导航">
      <h2>报告导航</h2>
      <a href="#summary"><i class="fa-solid fa-compass"></i>执行摘要</a>
      <a href="#purpose"><i class="fa-solid fa-bullseye"></i>评估目的</a>
      <a href="#setup"><i class="fa-solid fa-flask"></i>Benchmark 设置</a>
      <a href="#provenance"><i class="fa-solid fa-code-branch"></i>报告来源</a>
      <a href="#profiles"><i class="fa-solid fa-id-card-clip"></i>模型画像</a>
      <a href="#scorecard"><i class="fa-solid fa-list-check"></i>模型选择 Scorecard</a>
      <a href="#metrics"><i class="fa-solid fa-chart-simple"></i>关键指标</a>
      <a href="#metric-framework"><i class="fa-solid fa-sitemap"></i>指标框架</a>
      <a href="#reading-guide"><i class="fa-solid fa-book-open-reader"></i>读表指南</a>
      <a href="#method"><i class="fa-solid fa-scale-balanced"></i>方法口径</a>
      <a href="#model-table"><i class="fa-solid fa-table-columns"></i>模型对比</a>
      <a href="#cost"><i class="fa-solid fa-coins"></i>成本效率</a>
      <a href="#quality"><i class="fa-solid fa-clipboard-check"></i>质量门槛</a>
      <a href="#prompt-audit"><i class="fa-solid fa-pen-nib"></i>Prompt 评价</a>
      <a href="#prompt-v2"><i class="fa-solid fa-wand-magic-sparkles"></i>Prompt v2</a>
      <a href="#pairwise"><i class="fa-solid fa-link"></i>Evidence 重叠</a>
      <a href="#consensus"><i class="fa-solid fa-diagram-project"></i>Consensus</a>
      <a href="#labels"><i class="fa-solid fa-tags"></i>Label Family</a>
      <a href="#semantic"><i class="fa-solid fa-object-group"></i>Semantic Canonical</a>
      <a href="#boundary"><i class="fa-solid fa-triangle-exclamation"></i>Boundary Risk</a>
      <a href="#divergence"><i class="fa-solid fa-arrows-left-right-to-line"></i>高分歧会议</a>
      <a href="#unique"><i class="fa-solid fa-eye"></i>独有 Evidence</a>
      <a href="#recommendations"><i class="fa-solid fa-route"></i>实践建议</a>
      <a href="#outputs"><i class="fa-solid fa-folder-open"></i>输出文件</a>
    </nav>
    <main>
    <section id="summary">
      ${sectionTitle("fa-compass", "执行摘要")}
      <p>这份报告不分析这批输入资料的实质内容，而是把它当作 benchmark，用来评估 Batch API 下不同模型作为开放编码器的行为差异。</p>
      <ul>
        <li>本次 benchmark 覆盖 <strong>${summaryValue("company_count")}</strong> 家公司、<strong>${summaryValue("meeting_count")}</strong> 个 companyid:keydevid 会议；三模型合计预期 <strong>${summaryValue("expected_model_meeting_requests")}</strong> 个 model-meeting requests，实际收集 <strong>${summaryValue("collected_output_files")}</strong> 个 open-coding JSON 输出。</li>
        <li><strong>5.5</strong> 的 coding density 最高，平均每个 meaning unit 产生 ${num(densestCodes.avg_codes_per_unit)} 个 open codes；适合为后续 axial coding 提供更丰富的机制线索。</li>
        <li><strong>5.4</strong> 的 meaning units 總數最高（${largestUnits.units}），表现为较高 sensitivity，或者更积极的 candidate evidence discovery。</li>
        <li><strong>${escapeHtml(highestRisk.model)}</strong> 的 generic digital/data 風險比例最高（${pct(highestRisk.generic_digital_risk_rate)}）；这些片段需要人工复核后才能视为实质 AI 讨论。</li>
        <li>按官方標準價和 Batch 50% 折扣估算，本批次成本最低的是 <strong>${escapeHtml(modelSummaries.reduce((best, row) => row.estimated_batch_cost_usd < best.estimated_batch_cost_usd ? row : best, modelSummaries[0]).model)}</strong>；成本结论需要和 evidence 质量、boundary risk、validation issues 一起读。</li>
        <li>Exact text overlap 明顯低於總匹配量，表示同一 evidence 常因 unit boundary、unit_id 或 label wording 不同而看起来不一致，因此 fuzzy/containment comparison 是必要的。</li>
      </ul>
    </section>

    <section id="purpose">
      ${sectionTitle("fa-bullseye", "评估目的")}
      <p>本报告主要回答三个问题：同一 prompt 与同一 Batch API 流程下，不同模型的开放编码结果差异有多大；应该用哪些指标选择模型；目前 prompt 的稳定性如何，以及 proposed prompt v2 应该如何被验证。</p>
    </section>

    <section id="setup">
      ${sectionTitle("fa-flask", "Benchmark 设置")}
      <p>输入资料只是随机选取的测试样本。公司、年份、产业或具体 evidence 内容主要作为 audit probes，用于观察模型行为；不应被解读为对公司 AI 策略本身的研究结论。</p>
      <div class="grid">
        <div class="metric"><span class="value">${summaryValue("company_count")}</span><span class="label">公司数</span></div>
        <div class="metric"><span class="value">${summaryValue("meeting_count")}</span><span class="label">会议 / keydevid 数</span></div>
        <div class="metric"><span class="value">${summaryValue("expected_model_meeting_requests")}</span><span class="label">预期 model-meeting requests</span></div>
        <div class="metric"><span class="value">${summaryValue("collected_output_files")}</span><span class="label">实际 JSON 输出</span></div>
      </div>
      <h3>输入与请求基本信息</h3>
      ${benchmarkSummaryTable}
      <h3>各模型请求与输出覆盖</h3>
      ${benchmarkRequestTable}
    </section>

    <section id="provenance">
      ${sectionTitle("fa-code-branch", "报告来源与数据结构")}
      <p class="note">这一节记录报告是由哪个 skill、哪个版本、基于什么输入流程生成的，方便后续复现和审计。</p>
      ${provenanceTable}
      <details>
        <summary>数据结构格式 / Data structure format</summary>
        <p class="note">当前 skill 默认读取 iiaide GT opencoding flow 最后 process 产出的 ZIP 包解压后形成的结果目录；核心结构如下。</p>
        <ul>${dataStructurePreview}</ul>
      </details>
    </section>

    <section id="profiles">
      ${sectionTitle("fa-id-card-clip", "三组模型画像")}
      <p class="note">先用画像建立直觉，再看后面的表格。这里的定位不是最终排名，而是把每个模型在本批开放编码 benchmark 中的工作风格讲清楚。</p>
      <div class="profile-grid">${modelProfileCards}</div>
    </section>

    <section id="scorecard">
      ${sectionTitle("fa-list-check", "模型选择 Scorecard")}
      <p class="note">这不是自动排名，而是把模型选择变成场景化决策。</p>
      ${selectionScorecard}
    </section>

    <section id="metrics">
      ${sectionTitle("fa-chart-simple", "关键指标")}
      <div class="grid">
        <div class="metric"><span class="value">${modelSummaries.reduce((s, r) => s + r.output_files, 0)}</span><span class="label">JSON 文件总数</span></div>
        <div class="metric"><span class="value">${modelSummaries.reduce((s, r) => s + r.units, 0)}</span><span class="label">总 meaning units</span></div>
        <div class="metric"><span class="value">${modelSummaries.reduce((s, r) => s + r.codes, 0)}</span><span class="label">Open codes 数量</span></div>
        <div class="metric"><span class="value">${modelSummaries.reduce((s, r) => s + r.label_families, 0)}</span><span class="label">Label families 合计</span></div>
        <div class="metric"><span class="value">${semantic?.semanticGlobalSummary?.semantic_canonical_codes || 0}</span><span class="label">Semantic canonical codes</span></div>
        <div class="metric"><span class="value">${consensus.three_model_components}</span><span class="label">三模型共识 evidence clusters</span></div>
      </div>
      <h3>各模型 Open codes 具体数量</h3>
      <p class="note">这里的 Open codes 数量不是平均值，而是该模型所有输出 JSON 中 codes[] 条目的总和。</p>
      ${openCodeCountTable}
      <div class="read-path">
        <div class="read-step"><strong>1. 先看覆盖</strong><span>文件、非空会议、缺失会议决定比较是否公平。</span></div>
        <div class="read-step"><strong>2. 再看产出</strong><span>Meaning units 看证据片段数量，Open codes 数量和 Open codes/Unit 看开放编码产出量与粒度。</span></div>
        <div class="read-step"><strong>3. 同时看风险</strong><span>Generic Risk 和 validation issues 判断是否需要人工复核。</span></div>
        <div class="read-step"><strong>4. 最后看成本</strong><span>成本/非风险 unit 比单纯成本/Unit 更稳。</span></div>
      </div>
    </section>

    <section id="metric-framework">
      ${sectionTitle("fa-sitemap", "模型选择指标框架")}
      <p>建议不要只比较“谁产出更多”。更合理的做法是把模型行为拆成完整性、召回、边界控制、粒度、成本效率与 prompt 稳定性六组指标。</p>
      ${metricFrameworkTable}
    </section>

    <section id="reading-guide">
      ${sectionTitle("fa-book-open-reader", "怎么读这份报告")}
      <p class="note">鼠标停留在带问号的表头上，可以看到指标解释。下面是最容易误读的几个点。</p>
      ${guideTable}
    </section>

    <section id="method">
      ${sectionTitle("fa-scale-balanced", "方法与口径")}
      <p>比較分為 exact text、containment 和 fuzzy evidence 三層。fuzzy 使用 token Jaccard，閾值為 <code>${FUZZY_THRESHOLD}</code>。Label family 是輕量詞彙歸併；新增 Semantic Canonicalization 层会在保留 raw codes 的基础上，把同义漂移映射到 canonical_code_id。Boundary risk 是詞彙風險提示，不是自動錯誤判定。</p>
      <p>成本按 OpenAI 官方價格頁計算：標準價每 1M tokens 為 GPT-5.5 $5/$30、GPT-5.4 $2.50/$15、GPT-5.4 mini $0.75/$4.50，Batch API 對輸入和輸出節省 50%。價格核對日期：${escapeHtml(pricingSource.checked_date)}；來源：<a href="${escapeHtml(pricingSource.official_url)}">${escapeHtml(pricingSource.official_url)}</a>。</p>
      <p class="note">完整规范见 <code>analysis/model_comparison_spec.md</code>。所有 CSV/JSON 产物位于 <code>analysis/model_comparison/</code>。</p>
    </section>

    <section id="model-table">
      ${sectionTitle("fa-table-columns", "模型级对比")}
      ${modelSummaryTable}
    </section>

    <section id="cost">
      ${sectionTitle("fa-coins", "Batch API 成本效率")}
      <p class="note">成本來自 raw batch response 的真實 token usage，再套用官方標準價格與 Batch 50% 折扣。這裡沒有計入可能的稅費、區域處理 uplift、超長上下文 uplift 或項目級折扣。</p>
      ${costTable}
    </section>

    <section id="quality">
      ${sectionTitle("fa-clipboard-check", "完整性与质量门槛")}
      <p class="note">這些檢查只說明 batch 產物的可審計性，不直接判斷開放編碼的理論品質。code.text 不在 unit.text 說明證據摘錄沒有嚴格滿足 prompt 的 containment 要求，後續人工審計時應優先檢查。</p>
      ${validationTable}
      <h3>缺失会议文件</h3>
      ${missingTable}
    </section>

    <section id="prompt-audit">
      ${sectionTitle("fa-pen-nib", "Prompt 设计评价")}
      <p>這些結果不能只解釋為模型能力差異。Prompt 本身規定了 AI 邊界、meaning-unit 切分、code 粒度、confidence 和 JSON 紀律；不同模型對這些規則的執行穩定性，也是比較的一部分。</p>
      <p class="note">這部分評價把結果指標反向映射到 prompt 設計，用來指導下一輪 prompt 改進；它不改變目前開放編碼結果。</p>
      ${promptAuditTable}
    </section>

    <section id="prompt-v2">
      ${sectionTitle("fa-wand-magic-sparkles", "改进版 Prompt v2")}
      <p>基於本次 prompt audit，我生成了一個可用於下一輪 batch 的改進版 open-coding prompt。它保留原 prompt 的 grounded-theory 和 evidence-first 結構，但更明確地處理邊界、切分、code 粒度和最終自檢。</p>
      ${promptV2SummaryTable}
      <p class="note">完整 prompt 文件：<a class="source-link" href="./${escapeHtml(improvedPrompt.filename)}" target="_blank" rel="noopener">${escapeHtml(improvedPrompt.filename)}</a></p>
      <details>
        <summary>预览改进版 prompt</summary>
        <pre>${escapeHtml(improvedPrompt.content)}</pre>
      </details>
    </section>

    <section id="pairwise">
      ${sectionTitle("fa-link", "Pairwise Evidence 重叠")}
      <p class="note">Exact 表示文本邊界完全一致；Containment 表示一個 unit 包含另一個；Fuzzy 表示詞彙重疊達到閾值。低 exact 不代表內容完全不同，常見原因是 batch 結果邊界切分不同。</p>
      ${pairSummaryTable}
    </section>

    <section id="consensus">
      ${sectionTitle("fa-diagram-project", "Consensus 结构")}
      <p><span class="pill">3-model: ${consensus.three_model_components}</span><span class="pill">2-model: ${consensus.two_model_components}</span><span class="pill">unique: ${consensus.one_model_components}</span></p>
      <p>三模型共識 evidence 更適合進入穩定 codebook；單模型獨有 evidence 則是發現增量洞見和邊界誤納入風險的主要審計對象。</p>
    </section>

    <section id="labels">
      ${sectionTitle("fa-tags", "Label Family 高频项")}
      <p class="note">這些是可重複的詞彙歸併結果，用於發現近義標籤和 codebook 歸併壓力。開放編碼本身允許 label 高度分散。</p>
      ${familyTable}
    </section>

    <section id="semantic">
      ${sectionTitle("fa-object-group", "Semantic Canonicalization")}
      <p>这一层不覆盖原始开放编码，而是把每条 raw code 映射到 <code>canonical_code_id</code>，用于做更公平的一致性检验。它优先在同一 evidence cluster 内合并同义 label，也会把明显相同的语义签名归入同一 canonical code。</p>
      <p><span class="pill">Raw codes: ${semantic?.semanticGlobalSummary?.raw_codes || 0}</span><span class="pill">Unique labels: ${semantic?.semanticGlobalSummary?.unique_normalized_labels || 0}</span><span class="pill">Canonical codes: ${semantic?.semanticGlobalSummary?.semantic_canonical_codes || 0}</span><span class="pill">Raw label 压缩: ${pct(semantic?.semanticGlobalSummary?.canonical_reduction_vs_raw_labels || 0)}</span></p>
      <h3>模型级 semantic codebook 压缩</h3>
      ${semanticModelTable}
      <h3>Raw label vs semantic canonical 一致性</h3>
      ${semanticAgreementTable}
      <h3>高频 canonical codes</h3>
      ${canonicalCodeTable}
      <p class="note">详细审计文件包括 <code>all_open_codes_long.csv</code>、<code>canonical_codebook.csv</code>、<code>semantic_duplicate_audit.csv</code> 和 <code>canonical_consistency_by_evidence_cluster.csv</code>。</p>
    </section>

    <section id="boundary">
      ${sectionTitle("fa-triangle-exclamation", "Boundary Risk 审计样例")}
      <p class="note">以下優先展示 generic digital/data 風險片段。它們未必錯誤，但需要確認是否真的有本地 AI/ML/model-driven 語境支撐。</p>
      ${boundaryTable}
    </section>

    <section id="divergence">
      ${sectionTitle("fa-arrows-left-right-to-line", "高分歧会议")}
      ${divergenceTable}
    </section>

    <section id="unique">
      ${sectionTitle("fa-eye", "模型独有 Evidence 样例")}
      <div class="cards">${uniqueCards}</div>
    </section>

    <section id="recommendations">
      ${sectionTitle("fa-route", "实践建议")}
      ${recommendationTable}
      <p class="note">推荐工作流：以 5.5 的细粒度 open codes 作为主材料，以 5.4 作为高召回补充，以 5.4mini 作为边界压力测试；对三模型共识 units 优先进入 axial coding，对单模型独有且 generic digital risk 的 units 进行人工复核。</p>
      <p class="note">如果研究預算敏感，可以把成本效率加入決策：用 5.4mini 做大規模初篩，用 5.4 做召回補充，用 5.5 只處理高價值或高分歧會議。不過若目標是發表級 grounded coding，仍應優先看證據紀律和人工審計通過率。</p>
    </section>

    <section id="outputs">
      ${sectionTitle("fa-folder-open", "输出文件")}
      <ul>${outputFiles.map((file) => `<li><code>${escapeHtml(file)}</code></li>`).join("")}</ul>
    </section>
    </main>
  </div>
</body>
</html>`;
}

async function main() {
  if (!Number.isFinite(FUZZY_THRESHOLD) || FUZZY_THRESHOLD <= 0 || FUZZY_THRESHOLD > 1) {
    throw new Error("--fuzzy-threshold must be a number between 0 and 1");
  }
  const missingPrices = MODELS.filter((model) => !MODEL_PRICES_STANDARD[model]);
  if (missingPrices.length) {
    throw new Error(`No built-in pricing for model directories: ${missingPrices.join(", ")}. Supported pricing keys: ${Object.keys(MODEL_PRICES_STANDARD).join(", ")}`);
  }
  if (!fs.existsSync(RESULTS_DIR)) {
    throw new Error(`Results directory not found: ${RESULTS_DIR}`);
  }
  await fsp.mkdir(OUT_DIR, { recursive: true });
  const modelDataList = await Promise.all(MODELS.map(loadModel));
  const usageMaps = await Promise.all(MODELS.map(loadUsage));
  const modelDataByName = Object.fromEntries(modelDataList.map((data) => [data.model, data]));
  MODELS.forEach((model, index) => {
    modelDataByName[model].usageByMeeting = usageMaps[index];
  });
  const allMeetingKeys = new Set();
  modelDataList.forEach((data) => data.meetings.forEach((_, key) => allMeetingKeys.add(key)));

  const modelSummaries = modelDataList.map((data) => summarizeModel(data, allMeetingKeys));
  const benchmarkInputSummary = benchmarkInputSummaryRows(modelSummaries, allMeetingKeys);
  const benchmarkModelRequests = benchmarkModelRequestRows(modelSummaries, allMeetingKeys);
  const meetings = meetingRows(modelDataByName, allMeetingKeys);
  const { rows: pairRows, unitMatchRows, pairSummaries } = pairwiseRows(modelDataByName, allMeetingKeys);
  const { consensusCounts, uniqueUnits, unitToEvidenceCluster, evidenceClusterRows } = buildConsensus(modelDataByName, allMeetingKeys);
  const semantic = buildSemanticCanonicalization(modelDataByName, unitToEvidenceCluster, evidenceClusterRows);
  const semanticByModel = Object.fromEntries(semantic.modelSemanticRows.map((row) => [row.model, row]));
  modelSummaries.forEach((row) => {
    const semanticRow = semanticByModel[row.model] || {};
    row.semantic_canonical_codes = semanticRow.semantic_canonical_codes || 0;
    row.semantic_codebook_per_code_rate = semanticRow.semantic_codebook_per_code_rate || 0;
    row.canonical_reduction_vs_raw_labels = semanticRow.canonical_reduction_vs_raw_labels || 0;
    row.canonical_reduction_vs_label_families = semanticRow.canonical_reduction_vs_label_families || 0;
  });
  const labels = labelFamilyRows(modelDataByName);
  const costRows = costEfficiencyRows(modelSummaries);
  const boundary = boundaryRows(modelDataByName);
  const disagreementExamples = pickDisagreementExamples(modelDataByName, pairRows, uniqueUnits);
  const boundaryExamples = boundary
    .filter((row) => row.evidence_class === "generic_digital_risk")
    .sort((a, b) => MODELS.indexOf(a.model) - MODELS.indexOf(b.model) || b.code_count - a.code_count)
    .slice(0, 18);

  const outputFiles = [
    "benchmark_input_summary.csv",
    "benchmark_model_request_summary.csv",
    "model_level_summary.csv",
    "meeting_level_comparison.csv",
    "pairwise_meeting_differences.csv",
    "unit_matching_table.csv",
    "label_family_comparison.csv",
    "all_open_codes_long.csv",
    "canonical_codebook.csv",
    "semantic_duplicate_audit.csv",
    "canonical_consistency_by_evidence_cluster.csv",
    "model_semantic_agreement_summary.csv",
    "model_semantic_code_summary.csv",
    "boundary_risk_audit.csv",
    "cost_efficiency_summary.csv",
    "prompt_design_audit.csv",
    PROMPT_V2_FILENAME,
    "validation_issues.csv",
    "disagreement_examples.json",
    "report_data.json",
    "model_comparison_report.html"
  ];
  const stalePdfFiles = [
    "model_comparison_report.pdf",
    "model_comparison_report_continuous.pdf"
  ];
  for (const file of stalePdfFiles) {
    await fsp.rm(path.join(OUT_DIR, file), { force: true });
  }

  await writeCsv(path.join(OUT_DIR, "benchmark_input_summary.csv"), benchmarkInputSummary, [
    "metric", "value", "note"
  ]);
  await writeCsv(path.join(OUT_DIR, "benchmark_model_request_summary.csv"), benchmarkModelRequests, [
    "model", "expected_requests", "collected_output_files", "missing_outputs", "usage_records",
    "empty_outputs", "nonempty_outputs", "companies", "input_tokens", "output_tokens", "estimated_batch_cost_usd"
  ]);
  await writeCsv(path.join(OUT_DIR, "model_level_summary.csv"), modelSummaries, [
    "model", "company_count", "output_files", "missing_files_vs_union", "empty_files", "nonempty_files", "nonempty_rate",
    "api_model_name", "standard_input_per_1m_usd", "standard_cached_input_per_1m_usd", "standard_output_per_1m_usd",
    "batch_input_per_1m_usd", "batch_cached_input_per_1m_usd", "batch_output_per_1m_usd",
    "units", "codes", "high_confidence_units", "medium_confidence_units", "medium_confidence_rate",
    "avg_units_per_nonempty_file", "avg_codes_per_unit", "avg_words_per_unit", "median_words_per_unit",
    "explicit_ai_units", "possible_ai_technical_units", "generic_digital_risk_units", "no_lexical_ai_signal_units",
    "generic_digital_risk_rate", "unique_normalized_labels", "label_families", "label_family_per_code_rate",
    "semantic_canonical_codes", "semantic_codebook_per_code_rate", "canonical_reduction_vs_raw_labels", "canonical_reduction_vs_label_families",
    "invalid_json_files", "malformed_top_level_files", "validation_problem_count", "code_text_not_in_unit_text",
    "bad_confidence", "wrong_analysis_type", "codes_not_array",
    "usage_records", "input_tokens", "cached_input_tokens", "output_tokens", "total_tokens", "estimated_batch_cost_usd",
    "cost_per_output_file_usd", "cost_per_nonempty_file_usd", "cost_per_unit_usd", "cost_per_code_usd",
    "cost_per_high_confidence_unit_usd", "cost_per_explicit_ai_unit_usd", "cost_per_non_generic_risk_unit_usd",
    "code_0", "code_1", "code_2", "code_3", "code_4plus"
  ]);
  await writeCsv(path.join(OUT_DIR, "meeting_level_comparison.csv"), meetings, [
    "companyid", "keydevid", "meeting_key",
    ...MODELS.flatMap((m) => [`${m}_present`, `${m}_units`, `${m}_codes`, `${m}_empty`, `${m}_high`, `${m}_medium`, `${m}_generic_digital_risk_units`, `${m}_explicit_ai_units`, `${m}_input_tokens`, `${m}_output_tokens`, `${m}_estimated_batch_cost_usd`])
  ]);
  await writeCsv(path.join(OUT_DIR, "pairwise_meeting_differences.csv"), pairRows, [
    "pair", "model_a", "model_b", "companyid", "keydevid", "meeting_key",
    "model_a_units", "model_b_units", "model_a_codes", "model_b_codes",
    "abs_unit_count_diff", "abs_code_count_diff", "exact_matches", "containment_matches", "fuzzy_matches",
    "matched_units", "model_a_unique_units", "model_b_unique_units", "unit_overlap_rate"
  ]);
  await writeCsv(path.join(OUT_DIR, "unit_matching_table.csv"), unitMatchRows, [
    "pair", "model_a", "model_b", "companyid", "keydevid", "meeting_key", "match_type", "token_jaccard",
    "model_a_unit_id", "model_b_unit_id", "model_a_confidence", "model_b_confidence",
    "model_a_evidence_class", "model_b_evidence_class", "model_a_code_count", "model_b_code_count",
    "model_a_labels", "model_b_labels", "model_a_source_json", "model_b_source_json", "model_a_text", "model_b_text"
  ]);
  await writeCsv(path.join(OUT_DIR, "label_family_comparison.csv"), labels, [
    "label_family", "total_codes", "model_count", "models_present", "5.5_codes", "5.4_codes", "5.4mini_codes", "sample_labels"
  ]);
  await writeCsv(path.join(OUT_DIR, "all_open_codes_long.csv"), semantic.allOpenCodeRows, [
    "model", "companyid", "keydevid", "meeting_key", "evidence_cluster_id", "global_unit_id", "unit_id", "code_id", "global_code_id",
    "confidence", "evidence_class", "label", "normalized_label", "label_family", "semantic_signature",
    "canonical_code_id", "canonical_label", "canonical_signature", "source_json", "code_text", "rationale", "unit_text"
  ]);
  await writeCsv(path.join(OUT_DIR, "canonical_codebook.csv"), semantic.canonicalCodebookRows, [
    "canonical_code_id", "canonical_label", "semantic_signature", "total_codes", "model_count", "models_present",
    ...MODELS.map((model) => `${model}_codes`),
    "evidence_cluster_count", "meeting_count", "raw_label_variant_count", "sample_raw_labels", "sample_code_texts"
  ]);
  await writeCsv(path.join(OUT_DIR, "semantic_duplicate_audit.csv"), semantic.duplicateAuditRows, [
    "canonical_code_id", "canonical_label", "semantic_signature", "total_codes", "model_count", "models_present",
    "raw_label_variant_count", "evidence_cluster_count", "sample_raw_labels", "sample_code_texts"
  ]);
  await writeCsv(path.join(OUT_DIR, "canonical_consistency_by_evidence_cluster.csv"), semantic.consistencyRows, [
    "evidence_cluster_id", "companyid", "keydevid", "meeting_key", "evidence_model_count", "evidence_models_present",
    "raw_code_count", "canonical_code_count",
    ...MODELS.flatMap((model) => [`${model}_raw_labels`, `${model}_canonical_codes`, `${model}_canonical_labels`]),
    "mean_pairwise_raw_label_jaccard", "mean_pairwise_semantic_code_jaccard", "semantic_gain",
    "shared_canonical_code_count", "three_model_canonical_code_count", "sample_text"
  ]);
  await writeCsv(path.join(OUT_DIR, "model_semantic_agreement_summary.csv"), semantic.semanticAgreementRows, [
    "pair", "model_a", "model_b", "shared_evidence_clusters", "mean_raw_label_jaccard",
    "mean_semantic_code_jaccard", "mean_semantic_gain", "clusters_with_semantic_gain", "clusters_with_shared_canonical_code"
  ]);
  await writeCsv(path.join(OUT_DIR, "model_semantic_code_summary.csv"), semantic.modelSemanticRows, [
    "model", "raw_codes", "unique_normalized_labels", "label_families", "semantic_canonical_codes",
    "semantic_codebook_per_code_rate", "canonical_reduction_vs_raw_labels", "canonical_reduction_vs_label_families"
  ]);
  await writeCsv(path.join(OUT_DIR, "boundary_risk_audit.csv"), boundary, [
    "model", "companyid", "keydevid", "unit_id", "confidence", "evidence_class", "words", "code_count", "labels", "source_json", "text"
  ]);
  await writeCsv(path.join(OUT_DIR, "cost_efficiency_summary.csv"), costRows, [
    "model", "api_model_name", "pricing_checked_date", "pricing_source",
    "standard_input_per_1m_usd", "standard_cached_input_per_1m_usd", "standard_output_per_1m_usd",
    "batch_input_per_1m_usd", "batch_cached_input_per_1m_usd", "batch_output_per_1m_usd",
    "usage_records", "input_tokens", "cached_input_tokens", "output_tokens", "total_tokens", "estimated_batch_cost_usd",
    "cost_per_output_file_usd", "cost_per_nonempty_file_usd", "cost_per_unit_usd", "cost_per_code_usd",
    "cost_per_high_confidence_unit_usd", "cost_per_explicit_ai_unit_usd", "cost_per_non_generic_risk_unit_usd"
  ]);
  const promptAuditRows = promptDesignAuditRows(modelSummaries, pairSummaries, consensusCounts);
  await writeCsv(path.join(OUT_DIR, "prompt_design_audit.csv"), promptAuditRows, [
    "prompt_dimension", "related_prompt_rule", "observed_signal", "assessment", "suggested_prompt_improvement"
  ]);
  const improvedPromptContent = await ensureImprovedPrompt(OUT_DIR);
  const validationIssues = modelDataList.flatMap((data) => [
    ...data.fileProblems.map((row) => ({ model: row.model, companyid: "", keydevid: "", file: row.file, unit_index: "", unit_id: "", problem: row.problem, detail: row.detail })),
    ...data.validationRows.map((row) => ({ ...row, detail: "" }))
  ]);
  await writeCsv(path.join(OUT_DIR, "validation_issues.csv"), validationIssues, [
    "model", "companyid", "keydevid", "file", "unit_index", "unit_id", "problem", "detail"
  ]);
  await fsp.writeFile(path.join(OUT_DIR, "disagreement_examples.json"), JSON.stringify(disagreementExamples, null, 2), "utf8");

  const reportData = {
    generated_at: new Date().toISOString(),
    models: MODELS,
    fuzzy_threshold: FUZZY_THRESHOLD,
    pricingSource: PRICING_SOURCE,
    skillProvenance: SKILL_PROVENANCE,
    benchmarkInputSummary,
    benchmarkModelRequests,
    modelSummaries,
    pairSummaries,
    consensus: consensusCounts,
    labelRows: labels,
    semantic,
    promptAuditRows,
    improvedPrompt: {
      filename: PROMPT_V2_FILENAME,
      content: improvedPromptContent
    },
    boundaryExamples,
    disagreementExamples,
    outputFiles
  };
  await fsp.writeFile(path.join(OUT_DIR, "report_data.json"), JSON.stringify(reportData, null, 2), "utf8");
  await fsp.writeFile(path.join(OUT_DIR, "model_comparison_report.html"), generateHtml(reportData), "utf8");

  console.log(`Wrote ${outputFiles.length} outputs to ${OUT_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

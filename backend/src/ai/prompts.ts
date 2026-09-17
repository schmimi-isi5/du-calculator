// Prompt construction for AnthropicProvider. Kept separate from the API
// call so the instructions can be reviewed and tuned without touching
// request/response plumbing.

import type {
  Clarification,
  Requirement,
  RepositoryContext,
  RepositoryProfile,
  RepositorySnapshotMode,
} from "../domain/types.js";
import { QUALITY_PROFILES } from "../domain/qualityLevels.js";
import type { QualityLevel } from "../domain/types.js";
import type { RepositoryIdentity, ResolvedRequirementKnowledge } from "./AIProvider.js";

const EVIDENCE_RULES = `
Evidence rules:
- Every claim about the repository must be backed by evidence where possible: cite the exact file path(s) and why they support the claim.
- Use status VERIFIED when you directly read the relevant code/config in the provided files, INFERRED when you are reasoning from indirect signals (e.g. a dependency in package.json implies a capability you did not directly inspect), and UNKNOWN when the repository context does not contain enough information to judge.
- Never invent files, functions, or capabilities that are not present in the provided repository context. If something is not visible in the context, say so - do not guess.
`.trim();

const REUSE_RULE = `
Reuse rule - this is critical and frequently gets misapplied:
Before letting an existing component reduce a score, decide which of these applies:
  A) It reduces the functional scope that must actually be newly delivered.
  B) It reduces technical complexity or risk of the requested outcome.
  C) It merely makes the INTERNAL implementation faster or more convenient for the development team.
Only A and B may lower a score. C must NOT reduce a score - Development Units represent the scope, complexity, and risk of the delivered result, not developer effort or time saved.
`.trim();

/**
 * Every prompt builder splits its content this way instead of a single
 * string: `stableContext` is byte-identical across repeated calls for the
 * same repository/requirement (the repository profile and file excerpts,
 * which can run to tens of thousands of tokens) and `volatile` is whatever
 * legitimately differs call to call (the requirement text, answered
 * clarifications, prior AI outputs). Providers that support explicit prompt
 * caching (see AnthropicProvider) put a cache breakpoint between the two;
 * providers that don't just concatenate them.
 */
export interface PromptParts {
  system: string;
  stableContext: string;
  volatile: string;
}

function formatRepositoryContext(context: RepositoryContext): string {
  const fileList = context.fileTree.map((f) => `- ${f}`).join("\n");
  const excerpts = Object.entries(context.fileExcerpts)
    .map(([file, content]) => `--- FILE: ${file} ---\n${content}`)
    .join("\n\n");
  const omittedNote =
    context.omittedFileCount > 0
      ? `\n\n(${context.omittedFileCount} additional file(s) were not included due to the context size budget.)`
      : "";

  return `REPOSITORY FILE LIST (${context.fileTree.length} files considered after filtering):\n${fileList}\n\nFILE CONTENTS (subset read, given budget limits):\n${excerpts}${omittedNote}`;
}

/**
 * Renders already-resolved facts/assumptions so later calls (impact
 * analysis, scoring) build on them instead of re-deriving them - and so
 * scoring can cite an assumption by its app-assigned id.
 */
function formatKnowledge(knowledge: ResolvedRequirementKnowledge): string {
  const facts = knowledge.knownFacts.length
    ? knowledge.knownFacts.map((f) => `- [${f.source}] ${f.topic}: ${f.fact}`).join("\n")
    : "(none recorded)";

  const activeAssumptions = knowledge.assumptions.filter((a) => a.status === "ACTIVE" || a.status === "CONFIRMED");
  const assumptions = activeAssumptions.length
    ? activeAssumptions
        .map(
          (a) =>
            `- id="${a.id}" [${a.status}, confidence ${a.confidence}] ${a.topic}: ${a.assumption} (reason: ${a.reason})`,
        )
        .join("\n")
    : "(none)";

  const rejected = knowledge.assumptions.filter((a) => a.status === "REJECTED" || a.status === "SUPERSEDED");
  const rejectedNote = rejected.length
    ? `\n\nREJECTED/SUPERSEDED ASSUMPTIONS (do not rely on these, do not reintroduce them without new grounds):\n${rejected
        .map((a) => `- id="${a.id}" ${a.topic}: ${a.assumption}`)
        .join("\n")}`
    : "";

  return `KNOWN FACTS (already established - do not re-derive or contradict without new evidence):\n${facts}\n\nACTIVE ASSUMPTIONS (already documented for this requirement - reuse their id in "assumptionsUsed" wherever a score relies on one; do not invent new competing assumptions for the same topic):\n${assumptions}${rejectedNote}`;
}

export function buildRepositoryAnalysisPrompt(
  repository: RepositoryIdentity,
  context: RepositoryContext,
): PromptParts {
  const system = `You are a senior software architect analyzing a real, existing code repository for the ISIFIVE DU Calculator. Your job is to build an accurate, evidence-based technical profile of this repository - languages, frameworks, services, data models, integrations, AI components, tests, and deployment setup.

${EVIDENCE_RULES}

Be factual and conservative. This profile will be used as the basis for estimating future development work, so overstating capabilities that don't exist, or missing ones that do, has real business consequences.`;

  const stableContext = `Repository: ${repository.repositoryUrl}
Branch: ${repository.branch}
Commit: ${repository.commitSha}

${formatRepositoryContext(context)}`;

  const volatile = `Produce a technical profile of this repository based only on the content above.`;

  return { system, stableContext, volatile };
}

// ---------------------------------------------------------------------------
// Assumption & Clarification Engine: Context Resolution
// ---------------------------------------------------------------------------

const INFORMATION_CLASS_RULES = `
Information classes - assign exactly one to every piece of information you extract or every gap you detect:
- FACT: explicitly stated in the requirement/acceptance criteria, a previously answered clarification, or directly verified in the repository.
- DERIVED: not stated outright, but inferable from facts with high confidence (e.g. a dependency plus its usage in code implies a capability).
- ASSUMPTION: not evidenced, but a plausible stand-in is defensible for a provisional assessment.
- CLARIFICATION_REQUIRED: too important to guess - see the clarification gate below.
- UNKNOWN_NON_BLOCKING: missing, and it does not materially affect the current assessment.

Never label an assumption as FACT. Never invent a fact that is not actually present in the requirement, acceptance criteria, prior clarification answers, or the repository context.
`.trim();

const SOURCE_HIERARCHY_RULE = `
Source hierarchy - check in this exact order before treating anything as unresolved:
1. The explicit requirement text.
2. The acceptance criteria.
3. Already-answered clarifications (provided below, if any).
4. The repository snapshot's technical profile.
5. Repository evidence / actual code in the provided file excerpts.
6. README / CLAUDE.md / technical documentation in the repository.
7. Existing architecture / components visible in the repository.
8. Logically derivable relationships between the above.
9. A plausible assumption.
10. A clarification question to the user - the LAST resort, never the default.
`.trim();

const SELF_RESOLUTION_RULE = `
AI self-resolution - for every information gap you detect, attempt to resolve it yourself before ever proposing a clarification:
- Walk the source hierarchy above for that specific gap.
- If the requirement or repository already answers it (even indirectly), record it as a FACT or DERIVED - do not ask about it.
- If no source resolves it, try to construct a plausible ASSUMPTION using the criteria below.
- Only when neither a fact, derivation, nor defensible assumption exists, and the gap is genuinely important, classify it CLARIFICATION_REQUIRED.

Example (do not ask): requirement says "an existing vector database", repository contains a VectorStoreService -> FACT, no question.
Example (assume, do not ask): requirement asks for continuous ingestion of new messages, repository has event/message handling but no single obvious ingestion pipeline -> propose an ASSUMPTION that new items flow through the existing (or an extended) event-driven mechanism, unless the specific mechanism would change the DU class.
`.trim();

const ASSUMPTION_CRITERIA_RULE = `
When an assumption may be used automatically (no question asked) - all of these must hold:
- It is technically plausible given the repository.
- It does not contradict repository evidence you actually have.
- It does not stand in for a security-critical decision.
- It does not change a material business acceptance criterion.
- Its alternative outcome would not materially change the DU assessment.
- Your confidence in it is adequate.

Every assumption must be documented (topic, assumption, reason, basis, confidence, affectedDimensions, potentialScoreImpact, criticality) - never silently folded into a score without a record.
`.trim();

const SCORE_IMPACT_RULE = `
potentialScoreImpact drives whether something becomes a question - assign it deliberately:
  0 = practically no influence on scoring -> never a clarification, at most UNKNOWN_NON_BLOCKING.
  1 = could move roughly one dimension by about one score point -> prefer an ASSUMPTION; only escalate to CLARIFICATION_REQUIRED if your confidence in that assumption is low.
  2 = could move several dimensions, or change the resulting DU class -> CLARIFICATION_REQUIRED, unless the source hierarchy above already resolves it reliably.
`.trim();

const CLARIFICATION_GATE_RULE = `
Clarification gate - run this checklist per gap, in order, before ever emitting CLARIFICATION_REQUIRED:
A. Can the requirement or acceptance criteria answer it? -> no question, it's a FACT.
B. Can the repository or its evidence answer it? -> no question, it's a FACT (or INFERRED-backed DERIVED).
C. Can it be derived with adequate confidence? -> DERIVED, no question.
D. Can a plausible assumption be made without materially changing the DU assessment? -> ASSUMPTION, no question.
E. Would the realistic range of possible answers leave all eight DU scores essentially unchanged? -> UNKNOWN_NON_BLOCKING or ASSUMPTION, no question.
F. Does it materially affect functional scope, technical architecture, data/integration, AI complexity, automation, testing/QA, deployment, risk, privacy/security, or a real acceptance criterion, AND no defensible assumption covers it? -> only now, CLARIFICATION_REQUIRED.

Topics that more often clear this bar (but still check the repository first): unclear functional scope with materially different interpretations, unknown external systems/interfaces, an unknown data source for an integration-relevant requirement, security/privacy-relevant decisions, tenant/customer isolation, critical permission models, regulatory requirements, unknown volume/performance requirements with architectural consequences, and cases where different plausible answers would land in different DU classes.
`.trim();

const QUESTION_QUALITY_RULE = `
Clarification questions must be decision-oriented, not generic:
- Never ask something the development team is expected to decide anyway (e.g. "how should this be implemented technically?").
- Never ask about a choice the repository or requirement has already effectively made (e.g. which vector database to use, when one is already in place and reused).
- Ask only what actually changes the assessment if answered differently - phrase it as a concrete decision point, not an open-ended request for a full specification.
- Good example: "Über welchen stabilen Schlüssel kann Kommunikation über mehrere Dialoge hinweg demselben Kunden zugeordnet werden?" (relevant only if the repository shows no existing mechanism for this, and different answers materially change the data model, integration, and risk).
`.trim();

export function buildContextResolutionPrompt(
  requirement: Requirement,
  profile: RepositoryProfile,
  context: RepositoryContext,
  answeredClarifications: Clarification[],
  qualityLevel: QualityLevel,
  mode: RepositorySnapshotMode = "EXISTING_SYSTEM",
): PromptParts {
  const system = `You are running the "Assumption & Clarification" stage of the ISIFIVE DU Calculator, before any impact analysis or scoring happens. Your job is NOT to ask the user everything you don't know - it is to resolve as much as possible yourself, and flag only what truly needs a human decision.

Core principle: a missing piece of information is not automatically a question. Only information whose uncertainty would materially change scope, architecture, risk, acceptance, or the DU result should ever become a clarification question - and only after every other source has failed to resolve it.

${QUALITY_PROFILES[qualityLevel].rationaleGuidance}

${INFORMATION_CLASS_RULES}

${SOURCE_HIERARCHY_RULE}

${SELF_RESOLUTION_RULE}

${ASSUMPTION_CRITERIA_RULE}

${SCORE_IMPACT_RULE}

${CLARIFICATION_GATE_RULE}

${QUESTION_QUALITY_RULE}

${EVIDENCE_RULES}

${GERMAN_OUTPUT_RULE}
${mode === "GREENFIELD" ? `\n${GREENFIELD_MODE_NOTE}\n` : ""}
Produce: a normalization of the requirement (extraction only, no invented facts), the known facts you established, the assumptions you propose, and every information gap you detected with its classification and reasoning - including the ones you resolved yourself (FACT/DERIVED/ASSUMPTION/UNKNOWN_NON_BLOCKING) as well as any genuine CLARIFICATION_REQUIRED items. The application - not you - decides how many of the CLARIFICATION_REQUIRED items actually get asked; list all of them with accurate potentialScoreImpact so it can prioritize correctly.

The repository profile and file contents are provided first, below, as reference material - the actual requirement to resolve follows after it.`;

  // This resolution round runs again after every answered clarification, so
  // the repository profile/context (often tens of thousands of tokens) is
  // resent byte-for-byte across rounds - the cache-friendly part. Everything
  // that changes round to round (the answered-clarifications list grows)
  // must stay in `volatile`, after the cache breakpoint.
  const stableContext = `REPOSITORY PROFILE (already analyzed):
${JSON.stringify(profile, null, 2)}

${formatRepositoryContext(context)}`;

  const answeredBlock = answeredClarifications.length
    ? `\n\nPREVIOUSLY ANSWERED CLARIFICATIONS (treat as FACT - source hierarchy step 3):\n${answeredClarifications
        .map((c) => `Q: ${c.question}\nA: ${c.answer}`)
        .join("\n\n")}`
    : "";

  const volatile = `REQUIREMENT
Title: ${requirement.title}

Description:
${requirement.description}

Acceptance Criteria:
${requirement.acceptanceCriteria.map((c) => `- ${c}`).join("\n") || "(none provided)"}

Constraints:
${requirement.constraints.map((c) => `- ${c}`).join("\n") || "(none provided)"}
${answeredBlock}

Resolve this requirement's context now.`;

  return { system, stableContext, volatile };
}

const DIMENSION_DESCRIPTIONS = `
1. functionalScope (weight 20%): how much new user-facing/business functionality must be delivered.
2. technicalComplexity (weight 20%): architectural and implementation difficulty of the change itself.
3. dataIntegration (weight 15%): new data models, migrations, or integrations with other systems/APIs.
4. aiComplexity (weight 15%): complexity of any AI/agent/RAG/prompt-related work required.
5. automation (weight 10%): workflow/automation work required.
6. testingQA (weight 10%): scope and difficulty of testing required to verify correctness.
7. deploymentOperations (weight 5%): deployment, infrastructure, or operational changes required.
8. uncertaintyRisk (weight 5%): how much is still unclear or risky about delivering this correctly.
`.trim();

// Every field NOT covered by BILINGUAL_RULE below (which is specifically
// the three fields that need genuine bilingual EN/DE output) must be
// written in German only - the app's UI and its users are German-speaking,
// and the schema/this prompt being in English must never make the model
// default to English "by default" for its own free-text output. A bilingual
// version of these other fields is a possible future feature, not today's
// requirement.
const GERMAN_OUTPUT_RULE = `
German-only output rule:
- Every free-text field NOT explicitly covered by the bilingual output rule below must be written in German (Deutsch) only, regardless of what language the requirement or repository content happens to use.
`.trim();

const BILINGUAL_RULE = `
Bilingual output rule:
- Every "summary", "rationale", and "overallAssessment" field must be written independently in both English and German (Deutsch) - fluent, natural business language in each, not a literal word-for-word translation of the other.
- "summary" is a single compact sentence per language - the quick read for that dimension.
- "rationale" is the detailed, evidence-grounded reasoning per language - the full evaluation, consistent with "summary" but more thorough.
- "overallAssessment" is 2-4 sentences per language that synthesize all eight dimensions together into one read of the requirement's overall scope, complexity, and risk. It still must not state a DU number, class, or price - those are computed by the application, not by you.
- Every OTHER free-text field this schema asks for (impact analysis items, missingInformation, evidence reasons, suggestedDecomposition titles/descriptions, ...) follows the German-only output rule instead - German only, not English.
`.trim();

const ASSUMPTION_AWARE_SCORING_RULE = `
Assumption-aware scoring:
- For every dimension, list the known facts (factsUsed, short descriptions) and the exact assumption id(s) from the ACTIVE ASSUMPTIONS list above (assumptionsUsed) that the score relied on. Leave both empty arrays if the score needed neither.
- The more an assumption a score depends on, the lower that dimension's confidence should be - but a lower confidence must NEVER by itself justify a higher score. Uncertainty is expressed only through confidence and through the separate uncertaintyRisk dimension, never by inflating any other dimension "to be safe".
- List anything still genuinely uncertain after applying facts and assumptions in unresolvedRisks.
`.trim();

const DECOMPOSITION_RULE = `
Suggested decomposition (impactAnalysis.suggestedDecomposition):
- Most requirements do NOT need this - leave it as an empty array. Only populate it when the requirement's true SCOPE genuinely spans multiple substantial, separable pieces of work, each independently valuable and independently estimable on its own (e.g. it bundles several largely unrelated features, or touches many independent parts of the system end to end).
- Do not propose a decomposition just because a requirement is difficult, risky, or uncertain in one area - that belongs in risks/unresolvedRisks/confidence instead, not here.
- When you do propose one, list 2-6 candidate sub-requirements: a short customer-facing title and a one-sentence description each, in plain business language (not internal/technical jargon), together covering the full original scope with no gaps and no overlaps.
- Never mention Development Units, a DU class/size, or a price in a candidate's title or description - describe what it does, not how much it costs. You are never told and must never guess the DU class this requirement will receive.
`.trim();

const EFFORT_WORK_BREAKDOWN_RULE = `
Bottom-up human-effort estimation (effortWorkBreakdown) - this REPLACES giving one independent total for the whole requirement:
- The question is: "How many HUMAN personal hours would an ISIFIVE employee need to deliver this specific requirement with our AI-native production method?" AI_NATIVE means coding agents (Claude Code) doing AI-assisted code analysis, implementation, test generation, and refactoring, reusing existing components wherever possible, with a human handling architecture decisions, briefing/steering the agents, review, corrections, manual work agents cannot do well, integration, testing, and deployment.
- Count ONLY human personal time. NEVER a coding agent's own runtime, token consumption, CPU time, or wait time - there is no such thing as "the AI works for N hours" here.
- Do NOT give one holistic total for the requirement. Instead:
  1. Break the requirement down into concrete Work Packages (workPackages) - independently estimable units of work, grounded primarily in the Requirement Impact Analysis you already produced above (existing/reusable/modify/create/dataChanges/integrations/tests/risks) plus the repository (or, when there is no repository yet, the requirement/acceptance criteria/constraints/assumptions alone - see the note on that below, if applicable). Do not run a second, independent repository analysis - reuse the impact analysis you already did.
  2. For EACH Work Package, estimate its own human-effort corridor (humanEffort: minHours/likelyHours/maxHours) and confidence - never a shared, requirement-wide number.
  3. Perform a second, self-check pass over your own list before finalizing (completenessAssessment): did you miss a necessary piece of work? Do any two Work Packages describe overlapping/double-counted work? Report this honestly - both arrays are usually empty, and an empty result is a perfectly normal, common outcome, not something to force content into.
- You NEVER state or imply a total (no totalHours, no overall confidence, no "in total this is about N hours" in any rationale). This application sums your Work Packages' hours and computes overall confidence deterministically - if you provide your own total anywhere, it will be ignored, so do not waste effort computing one.

Work Package granularity and identity:
- Categories: ANALYSIS, ARCHITECTURE, DATA_MODEL, BACKEND, FRONTEND, INTEGRATION, AI_RAG_AGENT, AUTOMATION, MIGRATION, TESTING_QA, DEPLOYMENT, DOCUMENTATION, OTHER. These exist for explainability and later calibration/grouping only - they never imply a fixed hours value, and NOT every category needs a Work Package (most requirements legitimately don't touch most categories).
- Actions: CREATE, MODIFY, CONFIGURE, INTEGRATE, MIGRATE, TEST, DEPLOY, REVIEW, OTHER. In EXISTING_SYSTEM mode, actually check whether a component already exists before defaulting to CREATE - "this component exists and only needs extending" (MODIFY) is very different from building it from scratch, and the repository evidence should tell you which applies.
- Size Work Packages as real, fachlich-technisch sinnvolle development units - typically ~1-16 likely human hours. Avoid "implement the entire requirement" as one package (too coarse to explain or later calibrate) and avoid microscopic packages like "open a file" (too granular to be meaningful). A Work Package clearly larger than ~16h is not wrong, but consider whether it can be usefully split further.
- Work Packages should be MECE-oriented (mutually exclusive, collectively exhaustive) - avoid describing the same underlying work twice under different titles (e.g. "implement customer memory" and "implement customer memory retrieval" as two separate packages when they are the same work). Perfect non-overlap is not required, but obvious double-counting is exactly what the completeness self-check above must catch.
- dependencies lists other Work Package ids (within this same breakdown) this one depends on - for explainability/sequencing only. This estimates PERSONNEL effort, not calendar time: two Work Packages that could run in parallel still both count their full hours (they are not deduplicated or divided) - a 4h package and a 5h package are 9h of human effort regardless of whether they could happen at the same time.

Repository evidence and reuse:
- EXISTING_SYSTEM mode: ground repositoryEvidence in real files/symbols from the repository context provided above wherever a Work Package touches or extends something that exists - path plus the concrete symbol/function/class name when you know it. Never invent a path or symbol that isn't actually in the provided context.
- reuse (NONE/LOW/MEDIUM/HIGH) explains how much this Work Package leans on something that already exists - HIGH: an existing service/component can be used nearly as-is; MEDIUM: an existing pattern/base component helps; LOW: only general infrastructure is reusable; NONE: fully new. This is an input to how you already sized humanEffort (a HIGH-reuse package should already show up as fewer hours) - do NOT additionally apply a separate discount on top of your own humanEffort number; reuse is an explanation/calibration signal, not a second multiplier.
- effortDrivers name the 1-3 biggest reasons this specific Work Package's effort is higher or lower than a "default" package of its kind (e.g. existing code reuse, custom business logic, an unfamiliar integration, data migration, missing test infrastructure, AI/RAG complexity, authorization, UI complexity, an uncertain third-party API, legacy code) - explanatory only, never a percentage formula.

Coding-agent productivity - do not default to either extreme:
- Do not estimate as if a developer manually writes every line by hand when coding agents can generate a well-trodden pattern quickly (e.g. a CRUD component matching an existing pattern in this repository should not be estimated at manual-development speed).
- Do not assume coding agents eliminate architecture decisions, code review, debugging, integration, testing, or deployment effort - those remain genuinely human work regardless of how the implementation code itself gets generated.
- Never apply a single fixed productivity multiplier across the board - judge each Work Package on its own concrete technical shape.

Uncertainty:
- Corridor width and confidence are two DIFFERENT signals - do not mechanically derive one from the other. A well-understood, low-risk Work Package should have a narrow corridor AND high confidence (e.g. 3/4/5h at 0.90); a genuinely unclear one should have both a wider corridor AND lower confidence (e.g. 3/7/15h at 0.55). Ground both in the actual evidence for that specific package.
- Prefer whole or half hours (2h, 4.5h, 7h) over false minute-level precision (2.37h, 4.83h) - you are not that precise, and pretending to be misleads whoever reads this later.

Clarifications required (clarificationsRequired) - the interactive clarification round for this requirement has already closed by the time you produce this breakdown, so anything listed here is folded directly into the final result's open questions, not asked interactively. Apply the same materiality discipline as the rest of this application: list a question here ONLY if the missing information would likely add or remove a Work Package, flip a Work Package between CREATE and MODIFY, materially change a large Work Package, or materially shift the overall total - never for a technical detail the development team can decide on its own. This should usually be empty; prefer resolving a gap via repository evidence or a stated assumption (assumptions/generalAssumptions) instead of listing a question.
`.trim();

const TECHNOLOGY_PROFILE_FACTOR_DESCRIPTIONS = `
- uiForms: how much of this requirement is building forms/UI screens.
- crudDataManagement: how much is standard create/read/update/delete data management.
- workflowOrchestration: how much is sequencing steps/triggers/conditions across a process.
- standardConnectors: how much relies on well-known SaaS/API connectors rather than bespoke integration code.
- customIntegrations: how much requires bespoke, non-standard integration work.
- customBusinessLogic: how much is genuinely custom business rules/logic specific to this organization.
- aiAgentsRag: how much involves AI agents, RAG, tool calling, or similar AI-native functionality.
- complexStateManagement: how much requires tracking/coordinating complex, evolving state.
- customAlgorithms: how much requires bespoke computational/algorithmic logic (not CRUD, not a standard workflow step).
- testingRequirements: how demanding the testing/verification needs are.
- deploymentComplexity: how demanding the deployment/operational rollout is.
- expectedChangeFrequency: how often this is expected to change/evolve after initial delivery.
`.trim();

const TECHNOLOGY_PROFILE_RULE = `
Technology profile (technologyProfile) - describes THIS requirement's technical shape, completely independent of which production method (AI-native custom code, n8n, Intrexx) would build it. Score each of these 12 factors 0 (practically not relevant here) to 5 (very strongly characterizes this requirement), each with its own rationale (German), evidence, and confidence - grounded in the requirement, acceptance criteria, resolved knowledge, and the repository, never guessed generically:
${TECHNOLOGY_PROFILE_FACTOR_DESCRIPTIONS}
Do NOT use this to state or imply a fit percentage, a relative effort, or which technology is better - the application computes that deterministically from these scores. Your job here is only to characterize the requirement itself.
`.trim();

const EXISTING_ASSET_LEVERAGE_RULE = `
Existing asset leverage (existingAssetLeverage) - for EACH of AI_NATIVE, CLASSIC, N8N, and INTREXX, judge how much that production method could lean on what already exists in this repository (services, APIs, data models, auth/roles, UI components, tests, CI/CD, integrations, vector stores, agents, prompts, RAG components, reusable libraries, ...):
- Ground this ONLY in actual evidence from the repository context provided below - never invent an asset that is not actually present.
- AI_NATIVE and CLASSIC can usually be judged directly from the repository's own code (they reuse the exact same existing code - the difference between them is HOW it gets written, not what it can reuse). N8N and Intrexx assets (existing workflows, apps built on those platforms) are rarely visible in a git repository - when you find no evidence either way, set assetLeverage to null (UNKNOWN) with a low confidence, and say so in the rationale. Do NOT default it to 0 - null and 0 mean different things (no evidence found vs. confirmed no reusable assets).
- This is deliberately separate from the DU dimension scores above: existing assets that only make production faster/easier must never change a DU dimension score (see the reuse rule above) - they only affect this field and, downstream, the Effort/Technology Fit models the application computes from it.
`.trim();

const TECHNOLOGY_NARRATIVE_RULE = `
Technology narratives (technologyNarratives) - for EACH of AI_NATIVE, CLASSIC, N8N, and INTREXX, give 1-4 concrete advantages and 1-4 concrete disadvantages of that production method specifically for THIS requirement (German). Be specific to this requirement's actual technical shape - not generic platform marketing points. Do not state a percentage, a relative effort, or an hours figure here - that is computed by the application from technologyProfile/existingAssetLeverage, not from this narrative text.
`.trim();

const ANTI_BIAS_RULE = `
Anti-bias rule for the technology assessment - read this carefully, it corrects a documented prior failure mode:
- Low-code/no-code is NOT automatically faster than AI-native individual development. AI-native individual development is NOT automatically faster than low-code/no-code. Classical individual development is NOT automatically slower than any of the others - judge it on its own merits too.
- Judge only the concrete requirement, existing assets, integrations, technical constraints, and each production method's actual fit - never a generic prior about which category of tool is "usually" faster.
- AI_NATIVE means KI-beschleunigte Entwicklung mit Coding Agents (git-based custom development with coding agents like Claude Code doing the generation/editing, a human handling briefing, architecture decisions, review, and correction) - it must NOT be equated with classical, unassisted manual software development. CLASSIC_CUSTOM_DEVELOPMENT is that classical manual alternative: a developer writing the bulk of the implementation by hand, without coding agents as the primary production method - it is a genuinely different production method from AI_NATIVE, not a synonym for it and not automatically identical to it.
- Do not implicitly assume AI_NATIVE is slow just because "custom code" sounds slower than "low-code platform": AI_NATIVE is often very strong specifically at custom business logic, custom integrations, AI/agents/RAG, custom algorithms, complex state, and automatable testing - and low-code platforms are often very strong specifically at standard forms/CRUD/workflow orchestration/standard connectors.
- Score technologyProfile and existingAssetLeverage on their own merits for this specific requirement; do not let any technology's general reputation substitute for that.
`.trim();

const DIRECT_COST_RULE = `
Direct costs (directCosts) - structured, NOT mixed into any DU dimension score. For each of aiApiCost (LLM tokens/embeddings/OCR/external AI APIs), infrastructureCost (compute/storage/vector DB/additional infrastructure), thirdPartyCost (third-party APIs/licenses/external services), and otherDirectCost:
- Set costType: ONE_TIME_DEVELOPMENT (incurred only while building this), RECURRING_RUNTIME (incurred every time the delivered feature runs in production), or BOTH.
- Give a numeric amountEur ONLY when you can genuinely ground it in the requirement/repository (status: ESTIMATED). Otherwise set status to UNKNOWN or ESTIMATE_REQUIRED and leave amountEur null - never invent a plausible-sounding number to avoid leaving a gap.
- Most requirements will have low or zero direct costs beyond human effort - do not inflate this to seem thorough.
`.trim();

const IMPLEMENTATION_NOVELTY_RULE = `
Implementation novelty (implementationNovelty) - level LOW/MEDIUM/HIGH for how much technically new or not-yet-mastered ground ISIFIVE must cover to deliver THIS specific requirement: new architecture, experimental technology, an unfamiliar integration, novel AI/agent logic, a new evaluation methodology, missing reusable components, or a required technical proof of concept.
- This is NOT a proxy for "uses AI/LLMs = automatically HIGH". A well-trodden RAG integration using an existing, already-proven internal pattern is LOW/MEDIUM even though it involves AI; a genuinely novel evaluation/agent architecture with no internal precedent is HIGH even if the coding itself is simple.
- Ground the level in concrete rationale and evidence - never assign HIGH just because a requirement sounds technically impressive.
- This is a separate question from reusableInnovationIp below - a requirement can be technically novel for ISIFIVE (HIGH implementationNovelty) without creating anything reusable afterward, and vice versa.
`.trim();

const REUSABLE_INNOVATION_RULE = `
Reusable innovation / IP (reusableInnovationIp) - level NONE/LOW/MEDIUM/HIGH for whether delivering this requirement creates new reusable technical substance ISIFIVE can use again in OTHER requirements or projects: a new Konturos building block, a reusable agent, a generic connector, a generic RAG component, a new library, a reusable architecture piece, a generic test/evaluation building block, etc.
- NONE/LOW is the common case - most requirements are specific to one customer's need and produce nothing meaningfully reusable elsewhere.
- Ground the level in concrete rationale and evidence - do not assign HIGH just because the requirement uses interesting technology; the bar is genuine reusability beyond this one requirement.
- This assessment is captured for later business calibration only - it does not by itself change the price or DU count of this requirement.
`.trim();

const GREENFIELD_MODE_NOTE = `
GREENFIELD mode - IMPORTANT: there is no existing repository for this requirement. The "repository profile" below is a synthetic placeholder, not real code - treat every repository-dependent judgment accordingly:
- Never mark anything VERIFIED or INFERRED from "the repository" - there is none. existingAssetLeverage must be null (UNKNOWN) for every technology, since there is no codebase to evaluate reuse against.
- Base your assessment on the requirement, acceptance criteria, constraints, clarifications, and any target architecture the customer describes instead.
- A missing repository is not an error and not a reason to lower confidence across the board - only lower confidence for the specific things that genuinely depend on information a repository would have provided.
- Every Work Package's repositoryEvidence must be an empty array - there is no repository to cite. Every Work Package's action should default to CREATE unless the requirement itself describes something as already existing (e.g. an external system to integrate with).
`.trim();

/**
 * Impact analysis and per-dimension scoring in one call. These used to be
 * two sequential AI calls, but scoring always took the impact analysis as
 * input rather than being independent of it - the split only doubled
 * latency (a full extra thinking + generation pass) without buying any
 * actual independence, so both are asked for together here.
 */
export function buildAssessmentPrompt(
  requirement: Requirement,
  profile: RepositoryProfile,
  context: RepositoryContext,
  knowledge: ResolvedRequirementKnowledge,
  qualityLevel: QualityLevel,
  mode: RepositorySnapshotMode = "EXISTING_SYSTEM",
): PromptParts {
  const system = `You are a senior software architect performing a Requirement Impact Analysis, DU scoring, and technology/effort/commercial assessment for the ISIFIVE DU Calculator, in one pass. First determine what already exists, what can be reused, what must be modified, and what must be newly created for this requirement against a repository you have already profiled. Then, using that same analysis, score each of the eight fixed dimensions 1 (very low) to 5 (very high), with a summary, a detailed rationale, evidence, a confidence (0.0-1.0), and any missing information that limits your confidence - plus one overall assessment synthesizing all eight dimensions. You NEVER decide a final Development Unit count - that class/count is computed deterministically by the application from your per-dimension scores alone.

Separately - and this is NOT a function of the eight dimension scores - you also assess: a bottom-up, repository-grounded human-effort Work Breakdown (effortWorkBreakdown - concrete Work Packages with their own effort corridors, NOT one independent total for the whole requirement), the requirement's technical shape across 12 factors (technologyProfile), how much each production method (AI-native custom code, classical manual custom code, n8n, Intrexx) can lean on what already exists in this repository (existingAssetLeverage), a qualitative advantages/disadvantages read per production method (technologyNarratives), structured direct costs (directCosts), how much technically new ground this specific requirement covers for ISIFIVE (implementationNovelty), and whether it creates reusable technical substance for future work (reusableInnovationIp). The application computes the actual total effort, relative effort, Commercial DU, and price deterministically from these - you never state a fit percentage, a relative effort, a DU class, a Commercial DU number, or a price yourself. See the dedicated rules for all of this below.

${DIMENSION_DESCRIPTIONS}

${EVIDENCE_RULES}

${REUSE_RULE}

${GERMAN_OUTPUT_RULE}

${BILINGUAL_RULE}

${ASSUMPTION_AWARE_SCORING_RULE}

${DECOMPOSITION_RULE}

${EFFORT_WORK_BREAKDOWN_RULE}

${TECHNOLOGY_PROFILE_RULE}

${EXISTING_ASSET_LEVERAGE_RULE}

${TECHNOLOGY_NARRATIVE_RULE}

${ANTI_BIAS_RULE}

${DIRECT_COST_RULE}

${IMPLEMENTATION_NOVELTY_RULE}

${REUSABLE_INNOVATION_RULE}
${mode === "GREENFIELD" ? `\n${GREENFIELD_MODE_NOTE}\n` : ""}
${QUALITY_PROFILES[qualityLevel].rationaleGuidance}

Known facts and documented assumptions for this requirement are provided below - build on them rather than re-deriving them, and do not raise questions about things they already resolve. If you lack information to score a dimension confidently, say so explicitly in missingInformation and lower that dimension's confidence accordingly - do not compensate by guessing a score you cannot support.

The repository profile and file contents are provided first, below, as reference material - the requirement and what's already known about it follow after it.`;

  // Stable across a re-score of the same requirement against the same
  // snapshot (see scoring/clarificationGate.ts - a user can confirm/reject
  // an assumption and re-score without re-cloning or re-profiling).
  const stableContext = `REPOSITORY PROFILE (already analyzed):
${JSON.stringify(profile, null, 2)}

${formatRepositoryContext(context)}`;

  const volatile = `REQUIREMENT
Title: ${requirement.title}

Description:
${requirement.description}

Acceptance Criteria:
${requirement.acceptanceCriteria.map((c) => `- ${c}`).join("\n") || "(none provided)"}

Constraints:
${requirement.constraints.map((c) => `- ${c}`).join("\n") || "(none provided)"}

${formatKnowledge(knowledge)}

Analyze the impact of this requirement against the actual repository above, then score all eight dimensions now.`;

  return { system, stableContext, volatile };
}

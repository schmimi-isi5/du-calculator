// Prompt construction for AnthropicProvider. Kept separate from the API
// call so the instructions can be reviewed and tuned without touching
// request/response plumbing.

import type {
  ImpactAnalysis,
  Requirement,
  RepositoryContext,
  RepositoryProfile,
} from "../domain/types.js";
import type { RepositoryIdentity } from "./AIProvider.js";

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

export function buildRepositoryAnalysisPrompt(
  repository: RepositoryIdentity,
  context: RepositoryContext,
): { system: string; user: string } {
  const system = `You are a senior software architect analyzing a real, existing code repository for the ISIFIVE DU Calculator. Your job is to build an accurate, evidence-based technical profile of this repository - languages, frameworks, services, data models, integrations, AI components, tests, and deployment setup.

${EVIDENCE_RULES}

Be factual and conservative. This profile will be used as the basis for estimating future development work, so overstating capabilities that don't exist, or missing ones that do, has real business consequences.`;

  const user = `Repository: ${repository.repositoryUrl}
Branch: ${repository.branch}
Commit: ${repository.commitSha}

${formatRepositoryContext(context)}

Produce a technical profile of this repository based only on the content above.`;

  return { system, user };
}

export function buildImpactAnalysisPrompt(
  requirement: Requirement,
  profile: RepositoryProfile,
  context: RepositoryContext,
): { system: string; user: string } {
  const system = `You are a senior software architect performing a Requirement Impact Analysis for the ISIFIVE DU Calculator. You compare a new customer requirement against a repository you have already profiled, and determine what already exists, what can be reused, what must be modified, and what must be newly created.

${EVIDENCE_RULES}

${REUSE_RULE}

List concrete risks and open questions where the requirement is ambiguous or the repository context does not resolve how it should be implemented.`;

  const user = `REQUIREMENT
Title: ${requirement.title}

Description:
${requirement.description}

Acceptance Criteria:
${requirement.acceptanceCriteria.map((c) => `- ${c}`).join("\n") || "(none provided)"}

Constraints:
${requirement.constraints.map((c) => `- ${c}`).join("\n") || "(none provided)"}

REPOSITORY PROFILE (already analyzed):
${JSON.stringify(profile, null, 2)}

${formatRepositoryContext(context)}

Analyze the impact of this requirement against the actual repository above.`;

  return { system, user };
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

export function buildScoringPrompt(
  requirement: Requirement,
  profile: RepositoryProfile,
  impact: ImpactAnalysis,
  context: RepositoryContext,
): { system: string; user: string } {
  const system = `You are scoring a customer requirement across eight fixed dimensions for the ISIFIVE DU Calculator. You NEVER decide a final Development Unit count or price - that is computed deterministically by the application from your per-dimension scores. Your only job is to score each dimension 1 (very low) to 5 (very high), with a rationale, evidence, a confidence (0.0-1.0), and any missing information that limits your confidence.

${DIMENSION_DESCRIPTIONS}

${EVIDENCE_RULES}

${REUSE_RULE}

If you lack information to score a dimension confidently, say so explicitly in missingInformation and lower that dimension's confidence accordingly - do not compensate by guessing a score you cannot support.`;

  const user = `REQUIREMENT
Title: ${requirement.title}

Description:
${requirement.description}

Acceptance Criteria:
${requirement.acceptanceCriteria.map((c) => `- ${c}`).join("\n") || "(none provided)"}

Constraints:
${requirement.constraints.map((c) => `- ${c}`).join("\n") || "(none provided)"}

REPOSITORY PROFILE:
${JSON.stringify(profile, null, 2)}

IMPACT ANALYSIS:
${JSON.stringify(impact, null, 2)}

${formatRepositoryContext(context)}

Score all eight dimensions now.`;

  return { system, user };
}

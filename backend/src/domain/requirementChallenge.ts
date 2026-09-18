// Requirement Challenge & Optimization (requirement-challenge-v1) -
// vocabulary constants, mirroring the domain/technology.ts and
// domain/effort.ts split (vocabulary + constants here, shapes in
// domain/types.ts). See domain/types.ts for the full architecture comment
// and scoring/requirementChallengeEngine.ts for the deterministic logic.

export const REQUIREMENT_CHALLENGE_TYPES = [
  "UNCLEAR",
  "ASSUMPTION",
  "SOLUTION_CONSTRAINT",
  "OPTIMIZATION",
  "CONFLICT",
  "SCOPE_REDUCTION",
  "REUSE_OPPORTUNITY",
  "ACCEPTANCE_IMPROVEMENT",
] as const;
export type RequirementChallengeType = (typeof REQUIREMENT_CHALLENGE_TYPES)[number];

export const REQUIREMENT_CHALLENGE_PROPOSAL_STATUSES = ["PENDING", "ACCEPTED", "REJECTED", "EDITED", "SUPERSEDED"] as const;
export type RequirementChallengeProposalStatus = (typeof REQUIREMENT_CHALLENGE_PROPOSAL_STATUSES)[number];

export const CHALLENGE_EVIDENCE_SOURCE_TYPES = [
  "ORIGINAL_REQUIREMENT",
  "NORMALIZED_REQUIREMENT",
  "KNOWN_CONSTRAINT",
  "USER_CLARIFICATION",
  "REPOSITORY",
  "TECHNICAL_PROJECT_PROFILE",
  "DERIVED",
  "ASSUMPTION",
] as const;
export type ChallengeEvidenceSourceType = (typeof CHALLENGE_EVIDENCE_SOURCE_TYPES)[number];

export const CHALLENGE_IMPACT_DIRECTIONS = ["LOWER", "SAME", "HIGHER", "UNKNOWN"] as const;
export type ChallengeImpactDirection = (typeof CHALLENGE_IMPACT_DIRECTIONS)[number];

export const CHALLENGE_MAINTAINABILITY_IMPACTS = ["BETTER", "SAME", "WORSE", "UNKNOWN"] as const;
export type ChallengeMaintainabilityImpact = (typeof CHALLENGE_MAINTAINABILITY_IMPACTS)[number];

export const REQUIREMENT_APPROVAL_STATUSES = ["DRAFT", "CHALLENGE_IN_PROGRESS", "READY_FOR_APPROVAL", "APPROVED"] as const;
export type RequirementApprovalStatus = (typeof REQUIREMENT_APPROVAL_STATUSES)[number];

export const REQUIREMENT_PREPARATION_VERSION = "requirement-challenge-v1" as const;

/**
 * A Work Package's "solution specificity" analogue for the whole
 * requirement: how much of the text is already a concrete technical
 * solution rather than a business goal. Purely descriptive - never drives a
 * DU/effort/price number.
 */
export const SOLUTION_SPECIFICITY_LEVELS = ["LOW", "MEDIUM", "HIGH"] as const;
export type SolutionSpecificityLevel = (typeof SOLUTION_SPECIFICITY_LEVELS)[number];

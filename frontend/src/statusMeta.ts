import type { RepositoryStatus, ScoringStatus } from "./types";

interface StatusMeta {
  label: string;
  variant: "idle" | "progress" | "success" | "error" | "warn";
}

export const REPOSITORY_STATUS_META: Record<RepositoryStatus, StatusMeta> = {
  NOT_ANALYZED: { label: "Nicht analysiert", variant: "idle" },
  CLONING: { label: "Wird geklont…", variant: "progress" },
  ANALYZING: { label: "Wird analysiert…", variant: "progress" },
  SNAPSHOT_CREATED: { label: "Snapshot erstellt", variant: "success" },
  ERROR: { label: "Fehler", variant: "error" },
};

export const SCORING_STATUS_META: Record<ScoringStatus, StatusMeta> = {
  NOT_STARTED: { label: "Nicht gestartet", variant: "idle" },
  ANALYZING: { label: "KI-Bewertung läuft…", variant: "progress" },
  NEEDS_CLARIFICATION: { label: "Klärung erforderlich", variant: "warn" },
  SCORED: { label: "Bewertet", variant: "success" },
  ASSESSMENT_WITH_ASSUMPTIONS: { label: "Bewertet (mit Annahmen)", variant: "success" },
  DECOMPOSITION_REQUIRED: { label: "Zerlegung erforderlich", variant: "warn" },
  ERROR: { label: "Fehler", variant: "error" },
};

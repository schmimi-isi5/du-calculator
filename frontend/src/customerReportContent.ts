// Shared, customer-facing copy - used by both the in-app Management-Report
// (Kunde view) and the standalone public share page (CustomerReportPage),
// so the two stay visually/textually consistent without duplicating copy.

import type { DuClass } from "./types";

// A friendlier read of the DU class for someone who has never heard of
// "Development Units" - the internal view still shows the raw class/DU
// count for whoever is preparing the quote.
export const DU_CLASS_CUSTOMER_LABELS: Record<DuClass, string> = {
  XS: "Sehr kleiner Umfang",
  S: "Kleiner Umfang",
  M: "Mittlerer Umfang",
  L: "Größerer Umfang",
  XL: "Umfangreiches Vorhaben",
  XXL: "Großprojekt",
};

// Fixed, always-true value proposition for choosing custom development over
// a low-code platform - not derived from the requirement's own scores
// (unlike the comparison table below), since these hold regardless of this
// specific requirement's complexity profile.
export const CUSTOM_DEVELOPMENT_BENEFITS = [
  "Nahtlose Integration in Ihr bestehendes System",
  "Volle Eigentumsrechte & Kontrolle über den Code",
  "Keine wiederkehrenden Plattform- oder Lizenzkosten",
  "Erweiterbar für zukünftige Anforderungen, ohne Plattformgrenzen",
  "Direkter Support durch das Team, das Ihr System bereits kennt",
];

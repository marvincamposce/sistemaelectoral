import { z } from "zod";

export const ElectoralPhaseSchema = z.enum([
  "SETUP",
  "REGISTRY_OPEN",
  "REGISTRY_CLOSED",
  "VOTING_OPEN",
  "VOTING_CLOSED",
  "PROCESSING",
  "TALLYING",
  "RESULTS_PUBLISHED",
  "AUDIT_WINDOW",
  "ARCHIVED",
]);

export type ElectoralPhase = z.infer<typeof ElectoralPhaseSchema>;

export const ElectoralEventTypeSchema = z.enum([
  "OPEN_REGISTRY",
  "CLOSE_REGISTRY",
  "OPEN_VOTING",
  "CLOSE_VOTING",
  "START_PROCESSING",
  "FINALIZE_PROCESSING",
  "PUBLISH_RESULTS",
  "OPEN_AUDIT_WINDOW",
  "ARCHIVE_ELECTION",
]);

export type ElectoralEventType = z.infer<typeof ElectoralEventTypeSchema>;

export type ElectoralTransition = {
  from: ElectoralPhase;
  event: ElectoralEventType;
  to: ElectoralPhase;
};

export const BU_PVP_1_TRANSITIONS: readonly ElectoralTransition[] = [
  { from: "SETUP", event: "OPEN_REGISTRY", to: "REGISTRY_OPEN" },
  { from: "REGISTRY_OPEN", event: "CLOSE_REGISTRY", to: "REGISTRY_CLOSED" },
  { from: "REGISTRY_CLOSED", event: "OPEN_VOTING", to: "VOTING_OPEN" },
  { from: "VOTING_OPEN", event: "CLOSE_VOTING", to: "VOTING_CLOSED" },
  { from: "VOTING_CLOSED", event: "START_PROCESSING", to: "PROCESSING" },
  { from: "PROCESSING", event: "FINALIZE_PROCESSING", to: "TALLYING" },
  { from: "TALLYING", event: "PUBLISH_RESULTS", to: "RESULTS_PUBLISHED" },
  { from: "RESULTS_PUBLISHED", event: "OPEN_AUDIT_WINDOW", to: "AUDIT_WINDOW" },
  { from: "AUDIT_WINDOW", event: "ARCHIVE_ELECTION", to: "ARCHIVED" },
];

export function nextPhaseFor(
  current: ElectoralPhase,
  event: ElectoralEventType,
): ElectoralPhase | null {
  const t = BU_PVP_1_TRANSITIONS.find((x) => x.from === current && x.event === event);
  return t?.to ?? null;
}

export function assertValidTransition(
  current: ElectoralPhase,
  event: ElectoralEventType,
): ElectoralPhase {
  const next = nextPhaseFor(current, event);
  if (!next) {
    throw new Error(`Invalid BU-PVP-1 transition: ${current} --${event}--> ?`);
  }
  return next;
}

import { canonicalize } from "json-canonicalize";

export function canonicalizeJson(value: unknown): string {
  // json-canonicalize implements RFC 8785 (JCS).
  return canonicalize(value);
}

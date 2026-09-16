import { describe, expect, it } from "vitest";
import { resolveModelSelection } from "./requirementContextService.js";

// resolveAutoModel/resolveDefaultModel themselves are exhaustively covered
// in domain/models.test.ts - what's specific to resolveModelSelection is
// the *dispatch* contract: an explicit choice must never be second-guessed,
// regardless of quality level, context size, or privacy mode. This is the
// guarantee behind spec section 13's "kein automatischer Wechsel auf einen
// anderen Cloud-Provider" for manual selection.
describe("resolveModelSelection", () => {
  it("returns an explicit choice verbatim, ignoring quality level and context size", async () => {
    await expect(
      resolveModelSelection({ kind: "explicit", modelId: "gpt-6-astra" }, "quick", false, undefined),
    ).resolves.toBe("gpt-6-astra");
    await expect(
      resolveModelSelection({ kind: "explicit", modelId: "gpt-6-astra" }, "thorough", true, undefined),
    ).resolves.toBe("gpt-6-astra");
  });

  it("never substitutes a different model for an explicit choice, even under privacyMode=local-only", async () => {
    // requirementContextRoutes.ts is responsible for rejecting an explicit
    // non-local pick before this function is ever called with
    // privacyMode=local-only - this function's own contract is simply: an
    // explicit choice is never overridden, by anything.
    await expect(
      resolveModelSelection({ kind: "explicit", modelId: "claude-sonnet-5" }, "standard", false, "local-only"),
    ).resolves.toBe("claude-sonnet-5");
  });
});

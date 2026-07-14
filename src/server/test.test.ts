import { describe, expect, it } from "vitest";
import { parseGrokModelsOutput } from "./test.js";

describe("parseGrokModelsOutput", () => {
  it("extracts auth state and models from grok models output", () => {
    const parsed = parseGrokModelsOutput(
      [
        "You are logged in with grok.com.",
        "",
        "Default model: grok-composer-2.5-fast",
        "",
        "Available models:",
        "  * grok-composer-2.5-fast (default)",
        "  - grok-build",
      ].join("\n"),
    );
    expect(parsed).toEqual({
      authenticated: true,
      defaultModel: "grok-composer-2.5-fast",
      models: ["grok-composer-2.5-fast", "grok-build"],
    });
  });
});
import { describe, expect, it } from "vitest";
import { createServerAdapter } from "./create-server-adapter.js";

describe("createServerAdapter", () => {
  it("exports a production-ready Paperclip adapter module", () => {
    const adapter = createServerAdapter();
    expect(adapter.type).toBe("grokcli");
    expect(typeof adapter.execute).toBe("function");
    expect(typeof adapter.testEnvironment).toBe("function");
    expect(typeof adapter.listModels).toBe("function");
    expect(typeof adapter.refreshModels).toBe("function");
    expect(typeof adapter.detectModel).toBe("function");
    expect(typeof adapter.getConfigSchema).toBe("function");
    expect(adapter.supportsInstructionsBundle).toBe(true);
    expect(adapter.requiresMaterializedRuntimeSkills).toBe(true);
    expect(adapter.sessionManagement?.supportsSessionResume).toBe(true);
    expect(adapter.models?.length).toBeGreaterThan(0);
  });
});
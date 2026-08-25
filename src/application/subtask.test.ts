import { describe, expect, test } from "bun:test";
import { inferSubtask } from "./subtask";

const call = (toolName: string, success: boolean | null = true, command: string | null = null) =>
  ({ toolName, success, command });

describe("inferSubtask", () => {
  test("editing dominates when edits outnumber other signals", () => {
    const calls = [
      call("grep"), call("grep"),
      call("read"),
      call("edit"), call("edit"), call("edit"),
    ];
    expect(inferSubtask(calls)).toBe("editing");
  });

  test("analysis wins for search-heavy traces", () => {
    const calls = [call("grep"), call("glob"), call("graph_search"), call("read")];
    expect(inferSubtask(calls)).toBe("analysis");
  });

  test("localization for read-only traces", () => {
    expect(inferSubtask([call("read"), call("read"), call("read")])).toBe("localization");
  });

  test("validation detected via bash command pattern and beats editing on tie", () => {
    expect(inferSubtask([call("edit"), call("bash", true, "bun run test")])).toBe("validation");
    expect(inferSubtask([call("bash", true, "npm run build && tsc --noEmit")])).toBe("validation");
  });

  test("returns null when no recognizable signal", () => {
    expect(inferSubtask([])).toBeNull();
    expect(inferSubtask([call("webfetch"), call("memory")])).toBeNull();
  });

  test("failed calls still classify (lesson path)", () => {
    const calls = [
      call("edit", false), call("edit", false), call("edit", false),
      call("read", true),
    ];
    expect(inferSubtask(calls)).toBe("editing");
  });
});

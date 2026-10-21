import { describe, expect, it } from "vitest";
import { ansiParts } from "./tool-output";

describe("tool output ANSI rendering", () => {
  it("preserves plain text and removes SGR escapes", () => {
    expect(ansiParts("plain output")).toEqual([{ text: "plain output", state: { bold: false, dim: false, underline: false } }]);
  });

  it("maps the terminal colors and resets state", () => {
    const parts = ansiParts("a\u001b[31mred\u001b[0mz");
    expect(parts.map(part => part.text)).toEqual(["a", "red", "z"]);
    expect(parts[1]?.state.color).toBe("text-red-500");
    expect(parts[2]?.state.color).toBeUndefined();
  });

  it("keeps bold and underline state across segments", () => {
    const parts = ansiParts("\u001b[1;4mhead\u001b[22;24m tail");
    expect(parts[0]?.state).toMatchObject({ bold: true, underline: true });
    expect(parts[1]?.state).toMatchObject({ bold: false, underline: false });
  });
});

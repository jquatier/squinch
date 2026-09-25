// The playground's stage is painted with `--canvas`, and a diagram's own
// background is its theme's `canvas`. When the two differ the picture sits on
// the stage as a visible rectangle instead of flooding it — which is what
// happened when the light theme's ground moved and this token did not.
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { themes } from "@squinch/core/browser";

const css = readFileSync(new URL("../src/tokens.css", import.meta.url), "utf8");
const canvasIn = (selector: string) => {
  const block = css.slice(css.indexOf(selector));
  return /--canvas:\s*(#[0-9A-Fa-f]{6})/.exec(block.slice(0, block.indexOf("}")))?.[1];
};

describe("the stage floods with the diagram's ground", () => {
  it.each([
    ["light", 'html[data-theme="light"]'],
    ["dark", 'html[data-theme="dark"]'],
  ])("%s: --canvas equals the theme's canvas", (name, selector) => {
    expect(canvasIn(selector)?.toUpperCase()).toBe(themes[name].canvas.toUpperCase());
  });
});

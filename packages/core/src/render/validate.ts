// Real XML validation for every rendered SVG — duplicate attributes, unclosed
// tags, bad entities. Cheap enough to run on every render in tests and tools.
import { XMLValidator } from "fast-xml-parser";

export function validateSVG(svg: string): { ok: boolean; error?: string } {
  const result = XMLValidator.validate(svg, { allowBooleanAttributes: false });
  if (result === true) return { ok: true };
  return { ok: false, error: `${result.err.msg} (line ${result.err.line}, col ${result.err.col})` };
}

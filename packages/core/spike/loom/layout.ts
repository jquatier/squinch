// The Squinch side of the loom: a view in, a `Positioned` out. The planning
// (view → Problem) and dressing (Solution → Positioned) are the first spike's
// — they never depended on which engine solved the Problem between them.
import type { SModel, SView } from "../../src/model/types.js";
import { layoutViewGrid } from "../grid/layout.js";
import { solve } from "./engine.js";

export const layoutViewLoom = (model: SModel, view: SView, font?: Parameters<typeof layoutViewGrid>[2]) =>
  layoutViewGrid(model, view, font, solve);

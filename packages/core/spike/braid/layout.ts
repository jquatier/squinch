// The Squinch side: a view in, a `Positioned` out. Planning (view → Problem)
// and dressing (Solution → Positioned) are shared with the earlier spike
// engines — they never depended on which engine solved the Problem between.
import type { SModel, SView } from "../../src/model/types.js";
import { layoutViewGrid } from "../grid/layout.js";
import { solve } from "./engine.js";

export const layoutViewBraid = (model: SModel, view: SView, font?: Parameters<typeof layoutViewGrid>[2]) =>
  layoutViewGrid(model, view, font, solve);

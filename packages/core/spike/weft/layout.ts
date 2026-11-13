// The Squinch side: a view in, a `Positioned` out. Planning (view → Problem)
// and dressing (Solution → Positioned) are shared by every spike engine —
// they never depended on which one solved the Problem between them.
import type { SModel, SView } from "../../src/model/types.js";
import { layoutViewGrid } from "../grid/layout.js";
import { solve } from "./engine.js";

export const layoutViewWeft = (model: SModel, view: SView, font?: Parameters<typeof layoutViewGrid>[2]) =>
  layoutViewGrid(model, view, font, solve);

import { describe, it, expect } from "vitest";
import { assignTracks, type Run } from "./tracks.js";

const run = (id: number, top: number[], bottom: number[], more: Partial<Run> = {}): Run => ({ id, top, bottom, ...more });
const tracks = (...runs: Run[]) => { const { track } = assignTracks(runs, 1000); return runs.map((r) => track.get(r.id)!); };

describe("tracks", () => {
  it("shares a track between runs that do not overlap", () => {
    expect(tracks(run(1, [0], [50]), run(2, [100], [150]))).toEqual([0, 0]);
  });
  it("turns the wire that is further along first, so two leaning the same way do not cross", () => {
    const [a, b] = tracks(run(1, [0], [100]), run(2, [50], [150]));
    expect(b).toBeLessThan(a);
  });
  it("nests a short go-around inside a long one", () => {
    const [long, short] = tracks(run(1, [0, 300], []), run(2, [100, 200], []));
    expect(short).toBeLessThan(long);
  });
  it("never draws one wire's stub along another's", () => {
    // b comes down at 100 from the row above; a goes down to 100 in the row below: b turns first
    const [a, b] = tracks(run(1, [0], [100]), run(2, [100], [200]));
    expect(b).toBeLessThan(a);
  });
  it("gives a net one track however its branches overlap", () => {
    expect(new Set(tracks(run(1, [100], [0], { net: "n" }), run(2, [100], [200], { net: "n" }), run(3, [100], [50], { net: "n" }))).size).toBe(1);
  });
  it("lets a wire off to a side wall hug its row, and one passing beneath go under it", () => {
    // 1 leaves by the east wall from x = 100; 2 runs from 0 down to 200, under where 1 sets out
    const [out, under] = tracks(run(1, [100], [], { east: true }), run(2, [0], [200]));
    expect(out).toBeLessThan(under);
  });
  it("honours what it can when the answers form a ring, and reports the stubs left clashing", () => {
    // two wires changing places on the same two lines
    const { clashes } = assignTracks([run(1, [0], [16]), run(2, [16], [0])]);
    expect(clashes).toHaveLength(1);
  });
});

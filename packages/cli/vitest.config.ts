import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    // No test process may reach the npm registry, and the suite runs with cwd
    // inside this repo — a maintainer who has run `squinch skill` here would
    // otherwise see a `skill:` line in every test's stderr. Tests of the
    // notices themselves inject their deps through `main(argv, { update })`
    // and never read process.env, so this blanket opt-out costs them nothing.
    env: { SQUINCH_NO_UPDATE_CHECK: "1" },
  },
});

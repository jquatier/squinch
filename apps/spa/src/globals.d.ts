// Compile-time constants injected by vite.config.ts `define`.
//
// `__SQUINCH_VERSION__` is the workspace version (root package.json, via
// scripts/version.mjs) that every playground export is stamped with. There is
// deliberately no `typeof` guard where it is read: a missing define should
// fail the build, not drop the stamp silently.
//
// vitest.config.ts is a separate config with no `define`. Today no test
// imports src/squinch.ts or src/App.tsx (test/lib.test.ts covers src/lib/*
// only); the first one that does must add the same define there.
declare const __SQUINCH_VERSION__: string;

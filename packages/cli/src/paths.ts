// Paths in output are always POSIX.
//
// `path.relative` yields backslashes on Windows, and these strings are not
// private: `--check`'s stale list is what the squinch-check Action prints into
// somebody else's pull request, and test failure labels are read by whoever
// picks up the failure. A path that renders differently depending on the
// machine that produced it is noise in a diff and a false difference in a
// comparison. git already speaks POSIX everywhere, so this matches it.
export const toPosix = (p: string): string => p.split(/[\\/]/).join("/");

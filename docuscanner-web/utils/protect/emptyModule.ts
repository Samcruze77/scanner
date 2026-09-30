// Stands in for Node's `fs`, `path` and `crypto` when the QPDF engine is bundled for the
// browser. The engine only reaches for them when it detects Node (see next.config.ts), which
// never happens in a browser, so nothing is ever called.
export default {};

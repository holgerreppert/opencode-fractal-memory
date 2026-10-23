// OpenCode V2 server-plugin entrypoint for this package.
//
// OpenCode resolves a plugin directory by probing `<dir>/server`, `<dir>/index`,
// and `<dir>/tui` as plain filesystem paths — a package.json `exports` subpath is
// NOT consulted for that probe, which is why the directory reports no id/version
// without this file. The documented local-plugin layout is `<dir>/index.ts`;
// this is the compiled equivalent, and `tui.js` next to it is the CLI entrypoint.
export { default } from "./dist/plugin.js"

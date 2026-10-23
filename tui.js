// OpenCode V2 CLI-plugin entrypoint for this package.
//
// OpenCode resolves a plugin directory by probing `<dir>/index` and `<dir>/tui`
// with the equivalent of `Bun.resolveSync(dir + "/tui")`. That probe is a plain
// filesystem path, so a package.json `exports` subpath ("./tui") is NOT
// consulted — the file has to exist at the directory root. This file is that
// entrypoint; it is not a shim, it is the package's CLI-plugin module.
export { default } from "./dist/tui.js"

// Registered as bun test preload (bunfig.toml [test].preload).
// Tells src/logging.ts to skip all production log writes so test runs
// never pollute ~/.config/opencode/logs/* (fixture values leaked into
// memory-plugin.log and masked real diagnostics).
process.env.OPCMEM_TEST_LOG = "1";

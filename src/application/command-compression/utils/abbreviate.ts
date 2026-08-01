const WORD_ABBREVIATIONS: Record<string, string> = {
  implementation: "impl",
  implementations: "impls",
  configuration: "config",
  configurations: "configs",
  authentication: "auth",
  authorization: "authz",
  directory: "dir",
  directories: "dirs",
  executable: "exe",
  environment: "env",
  variable: "var",
  variables: "vars",
  function: "fn",
  functions: "fns",
  property: "prop",
  properties: "props",
  parameter: "param",
  parameters: "params",
  argument: "arg",
  arguments: "args",
  attribute: "attr",
  attributes: "attrs",
  reference: "ref",
  references: "refs",
  identifier: "id",
  identifiers: "ids",
  initialization: "init",
  initialize: "init",
  initializing: "init",
  management: "mgmt",
  application: "app",
  applications: "apps",
  documentation: "docs",
  repository: "repo",
  repositories: "repos",
  utility: "util",
  utilities: "utils",
  communication: "comm",
  notification: "notif",
  notifications: "notifs",
};

export function applyWordAbbreviations(text: string): string {
  // Apply to each line: replace long words with abbreviations. Whitespace-delimited
  // runs that look like paths (contain /), filenames/extensions (contain .), or
  // URLs (contain :) are NEVER rewritten — abbreviating them corrupts the path.
  const lines = text.split("\n");
  let changed = false;
  const abbreviateRun = (run: string): string => {
    if (run.includes("/") || run.includes(".") || run.includes(":")) return run;
    return run.replace(/\b([a-zA-Z]{6,})\b/g, (match) => {
      const lower = match.toLowerCase();
      const abbrev = WORD_ABBREVIATIONS[lower];
      if (abbrev) {
        changed = true;
        if (match[0] === match[0]!.toUpperCase()) {
          return abbrev[0]!.toUpperCase() + abbrev.slice(1);
        }
        return abbrev;
      }
      return match;
    });
  };
  const result = lines.map(line => line.replace(/\S+/g, abbreviateRun));
  if (!changed) return text;
  return result.join("\n");
}

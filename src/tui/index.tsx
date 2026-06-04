/** @jsxImportSource @opentui/solid */
import { fileURLToPath } from "node:url";
import * as path from "node:path";
import * as fs from "node:fs";
import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui";

const VERSION = JSON.parse(
  fs.readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../package.json"),
    "utf-8",
  ),
).version;

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 150,
    slots: {
      sidebar_content(ctx) {
        const theme = ctx.theme.current;
        return (
          <box
            border
            borderColor={theme.border}
            backgroundColor={theme.backgroundPanel}
            paddingTop={1}
            paddingBottom={1}
            paddingLeft={2}
            paddingRight={2}
            flexDirection="column"
            gap={1}
          >
            <text fg={theme.primary}>
              <b>Fractal Memory</b>
            </text>
            <text fg={theme.textMuted}>v{VERSION}</text>
          </box>
        );
      },
    },
  });
};

const plugin: TuiPluginModule & { id: string } = {
  id: "fractal-memory",
  tui,
};

export default plugin;

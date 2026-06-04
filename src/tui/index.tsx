/** @jsxImportSource @opentui/solid */
import type { TuiPlugin, TuiPluginModule, TuiSlotContext } from "@opencode-ai/plugin/tui";
import { VERSION } from "../version";

const tui: TuiPlugin = async (api) => {
  try {
    api.slots.register({
      order: 150,
      slots: {
        sidebar_content(ctx: any) {
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
  } catch (err) {
    console.error("[fractal-memory] TUI plugin registration failed:", err);
  }
};

export default { id: "fractal-memory", tui } satisfies TuiPluginModule;

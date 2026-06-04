import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui";
import { VERSION } from "../version";

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 150,
    slots: {
      sidebar_content: () => null,
    },
  });
};

export default { id: "fractal-memory", tui } satisfies TuiPluginModule;

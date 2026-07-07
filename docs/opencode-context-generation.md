# How OpenCode Generates Context

OpenCode’s context is built in layers:

1. **Base system prompt**
   - `createAgentProvider()` always injects a model-specific system prompt via `provider.WithSystemMessage(prompt.GetAgentPrompt(...))`.
   - `GetAgentPrompt()` picks one of four role prompts: coder, task, title, or summarizer. For coder/task, it can also append project-specific context.
   - That means the model never starts from “just the user message”; it starts from a role prompt plus any extra project instructions.

2. **Project context files**
   - For coder/task agents, OpenCode loads files from configured `ContextPaths`.
   - It reads each file’s raw contents and prepends them as `# From:<path>` blocks under `# Project-Specific Context`.
   - Directories ending in `/` are walked recursively; duplicates are de-duped case-insensitively.
   - This is effectively OpenCode’s “memory/instructions” layer.

3. **Conversation history**
   - On each run, OpenCode loads the session’s existing messages with `messages.List(...)`.
   - It then creates a new user message and appends it to the prior history.
   - That full `msgHistory` is what gets sent to the provider.
   - If the session already has a summary message, OpenCode truncates history to start at that summary and turns the first message into a user message, so summarized sessions stay compact.

4. **Tool context**
   - OpenCode passes tool definitions separately to the provider.
   - During execution, the assistant can emit tool calls; OpenCode runs the tools, appends tool results back into history, and continues the loop.
   - So “context” includes not just text, but the live tool loop state.

5. **Auto-compaction**
   - OpenCode tracks usage and auto-summarizes when the session reaches **95%** of the model context window.
   - Summarization creates a new session with a summary message, so the conversation can continue without carrying the entire old transcript.
   - The built-in “Compact Session” command does the same thing manually.

6. **Summarization prompt**
   - The summarizer uses the whole session history plus a fixed prompt asking for a concise but useful summary focused on what was done, current work, files involved, and next steps.
   - That summary is then stored as an assistant message in the session and linked via `SummaryMessageID`.

7. **Other context signals**
   - Title generation also happens from the first user message when a session is new.
   - LSP diagnostics and MCP tools can add more working context when used, but they’re not injected as static text; they’re available as tool-driven context.

## In short

OpenCode context is a mix of system prompt + project files + prior chat history + tool outputs, with automatic summarization used to keep that bundle under the model’s limit.
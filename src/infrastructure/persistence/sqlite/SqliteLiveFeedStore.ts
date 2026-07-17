import type { Database } from "bun:sqlite";
import type { LiveFeedStore, ConversationTurn, LiveFeedSnapshot } from "../../../domain/ports/LiveFeedStore";
import {
  insertConversationTurn,
  queryLiveFeedSnapshot,
} from "../../../storage/queries/live-feed";

export class SqliteLiveFeedStore implements LiveFeedStore {
  constructor(private getGlobalDb: () => Promise<Database>) {}

  async recordConversationTurn(turn: ConversationTurn): Promise<void> {
    const db = await this.getGlobalDb();
    insertConversationTurn(db, {
      sessionId: turn.sessionId,
      turnIndex: turn.turnIndex,
      role: turn.role,
      content: turn.content,
      ...(turn.toolName ? { toolName: turn.toolName } : {}),
      ...(turn.toolArgs ? { toolArgs: turn.toolArgs } : {}),
      ...(turn.toolResult ? { toolResult: turn.toolResult } : {}),
      ...(turn.tokenCount !== undefined ? { tokenCount: turn.tokenCount } : {}),
      ...(turn.projectName ? { projectName: turn.projectName } : {}),
      ...(turn.metadata ? { metadata: turn.metadata } : {}),
    });
  }

  async getLiveFeedSnapshot(limit = 50): Promise<LiveFeedSnapshot> {
    const db = await this.getGlobalDb();
    return queryLiveFeedSnapshot(db, limit);
  }
}

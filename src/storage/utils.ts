import { Database } from "bun:sqlite";

export function extractLinks(content: string): string[] {
  const links: string[] = [];
  let i = 0;
  while (i < content.length) {
    if (content[i] === "[" && content[i + 1] === "[") {
      const end = content.indexOf("]]", i + 2);
      if (end !== -1) {
        const label = content.slice(i + 2, end).trim();
        if (label && label.length <= 60 && /^[a-z0-9][a-z0-9-_]{1,60}$/i.test(label)) {
          if (!links.includes(label)) {
            links.push(label);
          }
        }
        i = end + 2;
        continue;
      }
    }
    i++;
  }
  return links;
}

export function embeddingToBlob(embedding: number[]): Buffer {
  const floats = new Float32Array(embedding);
  return Buffer.from(floats.buffer);
}

export function blobToEmbedding(blob: Buffer): number[] {
  const floats = new Float32Array(blob.buffer, blob.byteOffset, blob.byteLength / 4);
  return Array.from(floats);
}

export function tokenize(text: string): string[] {
  return text.toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter(t => t.length >= 2);
}

// Retry wrapper for database operations with exponential backoff
export async function withRetry<T>(
  operation: () => T | Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 100
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error as Error;

      const isBusyError =
        error instanceof Error &&
        (error.message.includes("database is locked") ||
          error.message.includes("database is busy") ||
          error.message.includes("SQLITE_BUSY") ||
          error.message.includes("SQLITE_LOCKED"));

      if (!isBusyError || attempt === maxRetries) {
        throw error;
      }

      const delay = baseDelay * Math.pow(2, attempt);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

// Transaction wrapper for atomic operations
export async function withTransaction<T>(
  db: Database,
  operation: () => T | Promise<T>
): Promise<T> {
  db.run("BEGIN");
  try {
    const result = await operation();
    db.run("COMMIT");
    return result;
  } catch (error) {
    db.run("ROLLBACK");
    throw error;
  }
}

// Retryable transaction: retries entire transaction on busy errors
export async function withRetryableTransaction<T>(
  db: Database,
  operation: () => T | Promise<T>,
  maxRetries: number = 3
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await withTransaction(db, operation);
    } catch (error) {
      lastError = error as Error;

      const isBusyError =
        error instanceof Error &&
        (error.message.includes("database is locked") ||
          error.message.includes("database is busy") ||
          error.message.includes("SQLITE_BUSY") ||
          error.message.includes("SQLITE_LOCKED"));

      if (!isBusyError || attempt === maxRetries) {
        throw error;
      }

      const delay = 100 * Math.pow(2, attempt);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

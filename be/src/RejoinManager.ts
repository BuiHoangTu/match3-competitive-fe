import { createHmac, randomBytes } from "crypto";
import { REJOIN_WINDOW_MS } from "./constants";

const REJOIN_SECRET =
  process.env.REJOIN_SECRET ?? randomBytes(32).toString("hex");

interface RejoinEntry {
  roomId: string;
  playerId: string;
  expiresAt: number;
}

export class RejoinManager {
  private tokens = new Map<string, RejoinEntry>();

  generate(roomId: string, playerId: string): string {
    const expiresAt = Date.now() + REJOIN_WINDOW_MS;
    const sig = createHmac("sha256", REJOIN_SECRET)
      .update(`${roomId}:${playerId}:${expiresAt}`)
      .digest("hex");
    const token = `${sig}:${expiresAt}`;
    this.tokens.set(token, { roomId, playerId, expiresAt });
    return token;
  }

  verify(token: string): RejoinEntry | null {
    const entry = this.tokens.get(token);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.tokens.delete(token);
      return null;
    }
    const { roomId, playerId, expiresAt } = entry;
    const expected = createHmac("sha256", REJOIN_SECRET)
      .update(`${roomId}:${playerId}:${expiresAt}`)
      .digest("hex");
    const [sig] = token.split(":");
    if (sig !== expected) {
      this.tokens.delete(token);
      return null;
    }
    return entry;
  }

  delete(token: string): void {
    this.tokens.delete(token);
  }

  cleanupRoom(roomId: string): void {
    for (const [token, entry] of this.tokens) {
      if (entry.roomId === roomId) this.tokens.delete(token);
    }
  }
}

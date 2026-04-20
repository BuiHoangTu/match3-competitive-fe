interface WaitingEntry {
  roomId: string;
  socketId: string;
  botTimeoutId: ReturnType<typeof setTimeout> | null;
}

export class WaitingQueue {
  private entries: WaitingEntry[] = [];

  enqueue(roomId: string, socketId: string): void {
    this.entries.push({ roomId, socketId, botTimeoutId: null });
  }

  shift(): WaitingEntry | null {
    const entry = this.entries.shift() ?? null;
    if (entry?.botTimeoutId) clearTimeout(entry.botTimeoutId);
    return entry;
  }

  removeBySocket(socketId: string): boolean {
    const idx = this.entries.findIndex((e) => e.socketId === socketId);
    if (idx === -1) return false;
    const [entry] = this.entries.splice(idx, 1);
    if (entry?.botTimeoutId) clearTimeout(entry.botTimeoutId);
    return true;
  }

  setBotTimeout(socketId: string, timeoutId: ReturnType<typeof setTimeout>): void {
    const entry = this.entries.find((e) => e.socketId === socketId);
    if (entry) entry.botTimeoutId = timeoutId;
  }

  get size(): number {
    return this.entries.length;
  }
}

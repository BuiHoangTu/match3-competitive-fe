export type LifecycleEvent =
  | "match_created"
  | "player_joined"
  | "move_submitted"
  | "move_rejected"
  | "disconnect"
  | "rejoin"
  | "match_ended";

export interface LogFields {
  matchId?: string;
  playerId?: string;
  reason?: string;
  [key: string]: unknown;
}

export function logEvent(event: LifecycleEvent, fields: LogFields = {}): void {
  const line = {
    ts: new Date().toISOString(),
    event,
    ...fields,
  };
  process.stdout.write(JSON.stringify(line) + "\n");
}

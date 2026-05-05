/**
 * Lightweight typed event emitter — no new npm dependency.
 * Wraps Node's EventEmitter with a generic event-map type for compile-time
 * type checking on `on`, `emit`, and `off`.
 */

import { EventEmitter } from "events";

export class TypedEmitter<Events extends Record<string, unknown>> {
  private emitter = new EventEmitter();

  on<K extends keyof Events>(
    event: K,
    listener: (payload: Events[K]) => void
  ): void {
    this.emitter.on(event as string, listener as (payload: unknown) => void);
  }

  off<K extends keyof Events>(
    event: K,
    listener: (payload: Events[K]) => void
  ): void {
    this.emitter.off(event as string, listener as (payload: unknown) => void);
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    this.emitter.emit(event as string, payload);
  }

  /** Remove all listeners for all events (used on cleanup). */
  removeAllListeners(): void {
    this.emitter.removeAllListeners();
  }
}

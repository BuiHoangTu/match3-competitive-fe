/**
 * PersistenceAdapter — groups all stores so they can be injected together.
 *
 * The server accepts an optional PersistenceAdapter. When omitted (test
 * contexts that don't have Postgres) all persistence calls are no-ops through
 * the NullPersistenceAdapter.
 */

import type { UserStore } from "./UserStore";
import type { MatchHistoryStore } from "./MatchHistoryStore";
import type { UserProgressStore } from "./UserProgressStore";

export interface PersistenceAdapter {
  userStore: UserStore;
  matchHistoryStore: MatchHistoryStore;
  userProgressStore: UserProgressStore;
}

/**
 * No-op adapter used when the server is constructed without a DB.
 * Every method returns immediately without touching any storage.
 */
export const NullPersistenceAdapter: PersistenceAdapter = {
  userStore: {
    async upsert() {
      /* no-op */
    },
    async findById() {
      return null;
    },
    async delete() {
      /* no-op */
    },
  },
  matchHistoryStore: {
    async insert() {
      /* no-op */
    },
    async listForUser() {
      return [];
    },
    async anonymise() {
      /* no-op */
    },
  },
  userProgressStore: {
    async get() {
      return null;
    },
    async addXp(_userId, _delta) {
      return { userId: _userId, xp: 0, defaultCharacterId: "cat", updatedAt: new Date() };
    },
    async setDefaultCharacter(_userId, characterId) {
      return { userId: _userId, xp: 0, defaultCharacterId: characterId, updatedAt: new Date() };
    },
  },
};

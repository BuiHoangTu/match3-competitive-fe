/**
 * PersistenceAdapter — groups the two stores so they can be injected together.
 *
 * The server accepts an optional PersistenceAdapter. When omitted (test
 * contexts that don't have Postgres) all persistence calls are no-ops through
 * the NullPersistenceAdapter.
 */

import type { UserStore } from "./UserStore";
import type { MatchHistoryStore } from "./MatchHistoryStore";

export interface PersistenceAdapter {
  userStore: UserStore;
  matchHistoryStore: MatchHistoryStore;
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
};

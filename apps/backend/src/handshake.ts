/**
 * T-v0.6-D02 — Room-token handshake middleware.
 *
 * Every Socket.IO connection must carry a valid room token in
 * `socket.handshake.auth.token`. Tokenless or invalid connections are
 * rejected before reaching any event handler.
 */

import type { Server } from "socket.io";
import { verify as verifyRoomToken } from "./RoomTokenSigner";
import type { RoomManager } from "./RoomManager";

export function registerHandshake(io: Server, roomManager: RoomManager): void {
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) {
      next(new Error("no_token"));
      return;
    }
    const payload = verifyRoomToken(token);
    if (!payload) {
      next(new Error("invalid_token"));
      return;
    }
    const room = roomManager.getRoom(payload.roomId);
    if (!room || room.status !== "active") {
      next(new Error("room_closed"));
      return;
    }
    if (room.userIds[payload.slot] !== payload.userId) {
      next(new Error("slot_mismatch"));
      return;
    }
    const existingPlayerId = roomManager.getPlayerIdForSlot(
      payload.roomId,
      payload.slot
    );
    if (
      existingPlayerId &&
      existingPlayerId !== socket.id &&
      io.sockets.sockets.has(existingPlayerId)
    ) {
      next(
        new Error(
          "ACCOUNT_IN_USE:This account is playing from a different device"
        )
      );
      return;
    }
    socket.data.roomId = payload.roomId;
    socket.data.userId = payload.userId;
    socket.data.slot = payload.slot;
    // T-v0.6-D06: store room token expiry in seconds so checkTokenExpiry works.
    socket.data.tokenExpSec = Math.floor(payload.exp / 1000);
    next();
  });
}

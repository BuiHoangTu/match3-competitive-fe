/// Asserts that the Dart bridge message-name constants match the canonical
/// fixture at packages/shared-js/src/__tests__/bridge-messages.txt.
///
/// This is the Dart half of the parity test — the TypeScript half lives at
/// packages/game-view/src/__tests__/bridge-contract.test.ts. Both read the
/// same fixture so drift on either side breaks a test immediately.
///
/// Phase E note: the previous duplicate copy at apps/frontend/test/bridge/
/// has been deleted. `flutter test` must be run from the repo root so the
/// upstream path resolves. Docker invocations: mount the whole repo, not
/// just apps/frontend/.
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

import '../../lib/bridge/bridge_messages.dart';

void main() {
  // Single source of truth — relative to the apps/frontend cwd that
  // `flutter test` runs from.
  final fixturePath = [
    '../../packages/shared-js/src/__tests__/bridge-messages.txt',
    // Fallback if invoked from repo root.
    'packages/shared-js/src/__tests__/bridge-messages.txt',
  ].firstWhere((p) => File(p).existsSync(), orElse: () {
    throw StateError(
      'bridge-messages.txt fixture not found. Run `flutter test` from '
      'apps/frontend or repo root, with the full repo on disk.',
    );
  });

  late Set<String> fixtureNames;

  setUpAll(() {
    final raw = File(fixturePath).readAsStringSync();
    fixtureNames = raw
        .split('\n')
        .map((l) => l.trim())
        .where((l) => l.isNotEmpty)
        .toSet();
  });

  // T-v0.6-I06 · Bridge-surface regression guard
  group('bridge contract — message name parity (T-v0.6-I06)', () {
    test('BridgeMessageType.all exactly matches the canonical fixture', () {
      expect(BridgeMessageType.all, equals(fixtureNames));
    });

    test(
        'no BridgeMessageType.all entry is missing from the fixture — '
        'adding a message without updating the fixture fails', () {
      final extra =
          BridgeMessageType.all.difference(fixtureNames);
      expect(
        extra,
        isEmpty,
        reason: 'These names are in BridgeMessageType.all but not in the '
            'fixture: $extra. Update bridge-messages.txt.',
      );
    });

    test(
        'no fixture entry is missing from BridgeMessageType.all — '
        'removing a Dart constant without updating the fixture fails', () {
      final missing =
          fixtureNames.difference(BridgeMessageType.all);
      expect(
        missing,
        isEmpty,
        reason: 'These fixture names are not in BridgeMessageType.all: '
            '$missing. Update bridge_messages.dart.',
      );
    });

    test('has exactly seven messages', () {
      expect(BridgeMessageType.all.length, equals(7));
    });

    test('shell→game names are present', () {
      expect(BridgeMessageType.all, contains(BridgeMessageType.startMatch));
      expect(
        BridgeMessageType.all,
        contains(BridgeMessageType.startLocalMatch),
      );
      expect(BridgeMessageType.all, contains(BridgeMessageType.appLifecycle));
      expect(
        BridgeMessageType.all,
        contains(BridgeMessageType.requestLeaveMatch),
      );
    });

    test('game→shell names are present', () {
      expect(BridgeMessageType.all, contains(BridgeMessageType.ready));
      expect(
        BridgeMessageType.all,
        contains(BridgeMessageType.authTokenRejected),
      );
      expect(BridgeMessageType.all, contains(BridgeMessageType.matchEnded));
    });
  });

  group('StartMatchMessage', () {
    test('round-trips through JSON', () {
      const msg = StartMatchMessage(
        roomToken: 'room.jwt.abc.def',
        expiresAt: 9999999,
      );
      final json = msg.toJson();
      final decoded = BridgeMessage.fromJson(json) as StartMatchMessage;
      expect(decoded.roomToken, equals(msg.roomToken));
      expect(decoded.expiresAt, equals(msg.expiresAt));
      expect(decoded.version, equals('1'));
    });
  });

  group('StartLocalMatchMessage', () {
    test('round-trips with no saved state through JSON', () {
      const msg = StartLocalMatchMessage(
        seed: 1234567,
        userId: 'user-alice',
      );
      final json = msg.toJson();
      final decoded =
          BridgeMessage.fromJson(json) as StartLocalMatchMessage;
      expect(decoded.seed, equals(1234567));
      expect(decoded.userId, equals('user-alice'));
      expect(decoded.savedState, isNull);
      expect(decoded.version, equals('1'));
    });

    test('round-trips with a saved state through JSON', () {
      final saved = SoloSnapshot(
        board: [
          [0, 1, 2],
          [3, 4, 0],
        ],
        rngState: 42,
        score: 250,
        nextTileId: 96,
      );
      final msg = StartLocalMatchMessage(
        seed: 999,
        userId: 'user-bob',
        savedState: saved,
      );
      final decoded =
          BridgeMessage.fromJson(msg.toJson()) as StartLocalMatchMessage;
      expect(decoded.seed, equals(999));
      expect(decoded.userId, equals('user-bob'));
      expect(decoded.savedState, isNotNull);
      expect(decoded.savedState!.board, equals(saved.board));
      expect(decoded.savedState!.rngState, equals(42));
      expect(decoded.savedState!.score, equals(250));
      expect(decoded.savedState!.nextTileId, equals(96));
      expect(decoded.savedState!.version, equals(1));
    });
  });

  group('AppLifecycleMessage', () {
    for (final state in AppLifecycleState.values) {
      test('round-trips state=${state.value}', () {
        final msg = AppLifecycleMessage(state: state);
        final decoded =
            BridgeMessage.fromJson(msg.toJson()) as AppLifecycleMessage;
        expect(decoded.state, equals(state));
      });
    }
  });

  group('RequestLeaveMatchMessage', () {
    test('round-trips through JSON', () {
      const msg = RequestLeaveMatchMessage();
      final decoded =
          BridgeMessage.fromJson(msg.toJson()) as RequestLeaveMatchMessage;
      expect(decoded.type, equals(BridgeMessageType.requestLeaveMatch));
      expect(decoded.version, equals('1'));
    });
  });

  group('ReadyMessage', () {
    test('round-trips through JSON', () {
      const msg = ReadyMessage();
      final decoded = BridgeMessage.fromJson(msg.toJson()) as ReadyMessage;
      expect(decoded.type, equals(BridgeMessageType.ready));
      expect(decoded.version, equals('1'));
    });
  });

  group('AuthTokenRejectedMessage', () {
    test('round-trips through JSON', () {
      const msg = AuthTokenRejectedMessage();
      final decoded =
          BridgeMessage.fromJson(msg.toJson()) as AuthTokenRejectedMessage;
      expect(decoded.type, equals(BridgeMessageType.authTokenRejected));
      expect(decoded.version, equals('1'));
    });
  });

  group('MatchEndedMessage', () {
    test('round-trips WIN outcome through JSON', () {
      const msg = MatchEndedMessage(
        outcome: MatchOutcome.win,
        selfScore: 1200,
        opponentScore: 800,
      );
      final decoded =
          BridgeMessage.fromJson(msg.toJson()) as MatchEndedMessage;
      expect(decoded.outcome, equals(MatchOutcome.win));
      expect(decoded.selfScore, equals(1200));
      expect(decoded.opponentScore, equals(800));
    });

    for (final outcome in MatchOutcome.values) {
      test('round-trips outcome=${outcome.value}', () {
        final msg = MatchEndedMessage(
          outcome: outcome,
          selfScore: 0,
          opponentScore: 0,
        );
        final decoded =
            BridgeMessage.fromJson(msg.toJson()) as MatchEndedMessage;
        expect(decoded.outcome, equals(outcome));
      });
    }
  });

  group('BridgeMessage.fromJson', () {
    test('throws FormatException for unknown type', () {
      expect(
        () => BridgeMessage.fromJson('{"type":"unknownType","version":"1","payload":{}}'),
        throwsA(isA<FormatException>()),
      );
    });
  });
}

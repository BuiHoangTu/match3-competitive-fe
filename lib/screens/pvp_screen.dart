import 'dart:async';
import 'package:flutter/material.dart';

import '../models/match_result.dart';
import '../net/board_delta_socket_client.dart';
import '../net/matchmaking_socket_client.dart';
import '../services/character_preference.dart';
import '../services/matchmaking_client.dart';
import '../widgets/matchmaking_waiting_panel.dart';
import 'character_select_screen.dart';
import 'online_game_screen.dart';
import 'result_screen.dart';

enum _PvpPhase {
  statusCheck,
  waiting,
  selecting,
  playing,
  result,
}

class PvpScreen extends StatefulWidget {
  const PvpScreen({
    super.key,
    required this.sessionToken,
    required this.backendUrl,
    required this.matchmaking,
    required this.onLeave,
    this.resumeRoomId,
    this.characterId,
    this.connectionFactory = createSocketIoBoardDeltaConnection,
  });

  final String sessionToken;
  final String backendUrl;
  final MatchmakingClient matchmaking;
  final VoidCallback onLeave;
  final String? resumeRoomId;
  final String? characterId;
  final BoardDeltaConnectionFactory connectionFactory;

  @override
  State<PvpScreen> createState() => _PvpScreenState();
}

class _PvpScreenState extends State<PvpScreen> {
  static const _characterPreference = CharacterPreference();

  late _PvpPhase _phase;
  String? _characterId;
  String? _roomToken;
  int? _roomTokenExpiresAt;
  String? _roomId;
  MatchResult? _result;

  MatchmakingSocketClient? _mmSocket;
  StreamSubscription<dynamic>? _matchReadySub;
  StreamSubscription<dynamic>? _matchConfirmedSub;
  StreamSubscription<dynamic>? _matchCancelledSub;
  StreamSubscription<dynamic>? _matchErrorSub;

  @override
  void initState() {
    super.initState();
    _characterId = widget.characterId;

    if (widget.resumeRoomId != null) {
      // Reconnecting to an existing match — skip to playing.
      _roomId = widget.resumeRoomId;
      _phase = _PvpPhase.playing;
    } else {
      _phase = _PvpPhase.statusCheck;
      _checkStatus();
    }
  }

  @override
  void dispose() {
    _cleanupMatchmakingSocket();
    super.dispose();
  }

  // ── Status check ───────────────────────────────────────────────────────

  Future<void> _checkStatus() async {
    try {
      final session = await widget.matchmaking.getActiveSession(
        sessionToken: widget.sessionToken,
      );
      if (!mounted) return;

      if (session != null) {
        // Active game — reconnect.
        setState(() {
          _roomId = session.roomId;
          _phase = _PvpPhase.playing;
        });
        return;
      }
    } catch (_) {
      // Transport error — treat as no session and proceed.
    }

    if (!mounted) return;
    setState(() => _phase = _PvpPhase.waiting);
    _startMatchmaking();
  }

  // ── Matchmaking ────────────────────────────────────────────────────────

  void _startMatchmaking() {
    // Connect matchmaking socket for real-time notifications.
    _mmSocket = MatchmakingSocketClient(
      serverUrl: widget.backendUrl,
      sessionToken: widget.sessionToken,
    );

    _matchReadySub = _mmSocket!.matchReady.listen((event) {
      if (!mounted) return;
      setState(() => _phase = _PvpPhase.selecting);
    });

    _matchConfirmedSub = _mmSocket!.matchConfirmed.listen((event) {
      if (!mounted) return;
      setState(() {
        _roomToken = event.roomToken;
        _roomTokenExpiresAt = event.expiresAt;
        _roomId = event.roomId;
        _phase = _PvpPhase.playing;
      });
    });

    _matchCancelledSub = _mmSocket!.matchCancelled.listen((_) {
      // Already handled by cancel button.
    });

    _matchErrorSub = _mmSocket!.matchError.listen((error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Matchmaking error: $error')),
      );
    });

    _mmSocket!.connect();

    // Fire HTTP join (non-blocking). Server will emit match_ready via socket.
    widget.matchmaking
        .join(
      sessionToken: widget.sessionToken,
      mode: MatchmakingMode.turnBased,
      characterId: _characterId ?? 'cat',
    )
        .then((result) {
      // Server may still return a room token directly (old blocking path).
      if (result.roomToken.isNotEmpty && mounted) {
        setState(() {
          _roomToken = result.roomToken;
          _roomTokenExpiresAt = result.expiresAt;
          _phase = _PvpPhase.playing;
        });
      }
    }).catchError((err) {
      // ALREADY_QUEUED or other error — socket will handle the flow.
      debugPrint('Matchmaking join: $err');
    });
  }

  void _cancelMatchmaking() {
    _mmSocket?.cancel();
    _cleanupMatchmakingSocket();
    widget.onLeave();
  }

  void _cleanupMatchmakingSocket() {
    _matchReadySub?.cancel();
    _matchConfirmedSub?.cancel();
    _matchCancelledSub?.cancel();
    _matchErrorSub?.cancel();
    _matchReadySub = null;
    _matchConfirmedSub = null;
    _matchCancelledSub = null;
    _matchErrorSub = null;
    _mmSocket?.dispose();
    _mmSocket = null;
  }

  // ── Character selection ────────────────────────────────────────────────

  void _onCharacterConfirmed(String characterId) {
    _characterId = characterId;
    // Send confirmation via matchmaking socket.
    _mmSocket?.confirmCharacter(characterId);
    // If server doesn't respond via socket within 5s, show error.
    Future.delayed(const Duration(seconds: 5), () {
      if (mounted && _phase == _PvpPhase.selecting) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Waiting for server confirmation...')),
        );
      }
    });
  }

  // ── Match complete ─────────────────────────────────────────────────────

  void _onMatchComplete(MatchResult result) {
    setState(() {
      _result = result;
      _phase = _PvpPhase.result;
    });
  }

  @override
  Widget build(BuildContext context) {
    switch (_phase) {
      case _PvpPhase.statusCheck:
        return const Scaffold(
          body: Center(child: CircularProgressIndicator()),
        );

      case _PvpPhase.waiting:
        return Scaffold(
          appBar: AppBar(
            title: const Text('vs Human'),
            leading: IconButton(
              icon: const Icon(Icons.arrow_back),
              tooltip: 'Cancel',
              onPressed: _cancelMatchmaking,
            ),
          ),
          body: Column(
            children: [
              MatchmakingWaitingPanel(onCancel: _cancelMatchmaking),
              const Expanded(
                child: Center(
                  child: Text(
                    'Waiting for opponent...',
                    style: TextStyle(fontSize: 16, color: Colors.grey),
                  ),
                ),
              ),
            ],
          ),
        );

      case _PvpPhase.selecting:
        return CharacterSelectScreen(
          onLoadDefault: _characterPreference.getDefaultCharacter,
          onConfirm: (characterId) async {
            await _characterPreference.setDefaultCharacter(characterId);
            if (mounted) _onCharacterConfirmed(characterId);
          },
          onBack: _cancelMatchmaking,
          autoConfirmSeconds: 30,
        );

      case _PvpPhase.playing:
        _cleanupMatchmakingSocket();
        return OnlineGameScreen(
          sessionToken: widget.sessionToken,
          backendUrl: widget.backendUrl,
          mode: MatchmakingMode.turnBased,
          characterId: _characterId ?? 'cat',
          matchmaking: widget.matchmaking,
          connectionFactory: widget.connectionFactory,
          resumeRoomId: _roomId ?? widget.resumeRoomId,
          roomToken: _roomToken,
          roomTokenExpiresAt: _roomTokenExpiresAt,
          onLeave: widget.onLeave,
          onMatchComplete: _onMatchComplete,
        );

      case _PvpPhase.result:
        return ResultScreen(
          result: _result!,
          onPlayAgainPressed: widget.onLeave,
        );
    }
  }
}

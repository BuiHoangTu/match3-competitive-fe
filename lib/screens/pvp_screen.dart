import 'package:flutter/material.dart';

import '../models/match_result.dart';
import '../net/board_delta_socket_client.dart';
import '../services/character_preference.dart';
import '../services/matchmaking_client.dart';
import 'character_select_screen.dart';
import 'online_game_screen.dart';
import 'result_screen.dart';

enum _PvpPhase { selecting, playing, result }

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
  MatchResult? _result;

  @override
  void initState() {
    super.initState();
    _characterId = widget.characterId;
    _phase = widget.resumeRoomId != null
        ? _PvpPhase.playing
        : _PvpPhase.selecting;
  }

  void _onCharacterConfirmed(String characterId) {
    setState(() {
      _characterId = characterId;
      _phase = _PvpPhase.playing;
    });
  }

  void _onMatchComplete(MatchResult result) {
    setState(() {
      _result = result;
      _phase = _PvpPhase.result;
    });
  }

  @override
  Widget build(BuildContext context) {
    switch (_phase) {
      case _PvpPhase.selecting:
        return CharacterSelectScreen(
          onLoadDefault: _characterPreference.getDefaultCharacter,
          onConfirm: (characterId) async {
            await _characterPreference.setDefaultCharacter(characterId);
            if (mounted) _onCharacterConfirmed(characterId);
          },
          onBack: widget.onLeave,
        );
      case _PvpPhase.playing:
        return OnlineGameScreen(
          sessionToken: widget.sessionToken,
          backendUrl: widget.backendUrl,
          mode: MatchmakingMode.turnBased,
          characterId: _characterId ?? 'cat',
          matchmaking: widget.matchmaking,
          connectionFactory: widget.connectionFactory,
          resumeRoomId: widget.resumeRoomId,
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

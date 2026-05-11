import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:shell/screens/pve_game_screen.dart';

void main() {
  testWidgets('PvE screen is native and score-free', (tester) async {
    var left = false;
    await tester.pumpWidget(MaterialApp(
      home: PveGameScreen(
        characterId: 'cat',
        onLeave: () => left = true,
      ),
    ));

    expect(find.text('vs Bot'), findsOneWidget);
    expect(find.byKey(const Key('pve_turn_label')), findsOneWidget);
    expect(find.textContaining('Score'), findsNothing);
    expect(find.textContaining('WIN'), findsNothing);
    expect(find.textContaining('LOSE'), findsNothing);

    await tester.tap(find.byTooltip('Leave match'));
    expect(left, isTrue);
  });
}

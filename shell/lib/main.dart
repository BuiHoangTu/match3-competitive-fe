// T-v0.6-A01..A02 + T-Local-07 — App entrypoint with router + LocalAuthService.

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import 'router.dart';
import 'services/local_auth_service.dart';

const _backendUrl = String.fromEnvironment(
  'BACKEND_URL',
  defaultValue: 'http://localhost:3001',
);

void main() {
  final localAuth = LocalAuthService(baseUrl: _backendUrl);
  final authState = LocalAuthStateAdapter(localAuth);
  final router = createRouter(auth: authState, localAuth: localAuth);
  runApp(Match3App(router: router));
}

class Match3App extends StatelessWidget {
  const Match3App({super.key, required this.router});
  final GoRouter router;

  @override
  Widget build(BuildContext context) {
    return MaterialApp.router(
      title: 'Match-3 Competitive',
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: Colors.deepPurple),
        useMaterial3: true,
      ),
      routerConfig: router,
    );
  }
}

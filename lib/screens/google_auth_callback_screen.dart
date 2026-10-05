import 'package:flutter/material.dart';

import '../services/sso/google_auth_client.dart';

class GoogleAuthCallbackScreen extends StatefulWidget {
  const GoogleAuthCallbackScreen({
    super.key,
    required this.code,
    required this.isLink,
    this.hasPendingIntent = true,
    this.errorCode,
    this.linkStateValid = true,
    required this.onLoginCode,
    required this.onLinkCode,
    required this.onConsumeIntent,
    required this.onReturn,
  });

  final String? code;
  final bool isLink;
  final bool hasPendingIntent;
  final String? errorCode;
  final bool linkStateValid;
  final Future<void> Function(String code) onLoginCode;
  final Future<void> Function(String code) onLinkCode;
  final VoidCallback onConsumeIntent;
  final VoidCallback onReturn;

  @override
  State<GoogleAuthCallbackScreen> createState() =>
      _GoogleAuthCallbackScreenState();
}

class _GoogleAuthCallbackScreenState extends State<GoogleAuthCallbackScreen> {
  String? _error;
  var _complete = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _exchange());
  }

  Future<void> _exchange() async {
    widget.onConsumeIntent();
    if (!widget.hasPendingIntent) {
      setState(() {
        _error = widget.isLink
            ? 'Google could not be connected. Please restart the connection from Account settings.'
            : 'Google sign-in could not be completed. Please start again.';
      });
      return;
    }
    final code = widget.code;
    if (widget.isLink && !widget.linkStateValid) {
      setState(() {
        _error =
            'Google could not be connected. Please restart the connection from Account settings.';
      });
      return;
    }
    if (widget.errorCode != null) {
      setState(() {
        _error = _callbackErrorMessage(
          isLink: widget.isLink,
          code: widget.errorCode,
        );
      });
      return;
    }

    if (code == null || code.isEmpty) {
      setState(() {
        _error = widget.isLink
            ? 'Google could not be connected. Please try again from Account settings.'
            : 'Google sign-in was cancelled or could not be completed. Please try again.';
      });
      return;
    }

    try {
      if (widget.isLink) {
        await widget.onLinkCode(code);
        if (!mounted) return;
        setState(() => _complete = true);
      } else {
        await widget.onLoginCode(code);
      }
    } on GoogleAuthError catch (error) {
      if (!mounted) return;
      setState(() => _error = error.message);
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _error = widget.isLink
            ? 'Google could not be connected. Please try again from Account settings.'
            : 'Google sign-in could not be completed. Please try again.';
      });
    }
  }

  String _callbackErrorMessage({required bool isLink, required String? code}) {
    if (isLink) {
      return 'Google could not be connected. Please check that you are signed in '
          'to the account you want to keep, then try again from Account settings.';
    }
    if (code == 'google_link_required') {
      return 'Sign in with your username and password, then connect Google from '
          'Account settings.';
    }
    return 'Google sign-in was cancelled or could not be completed. Please try again.';
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(widget.isLink ? 'Connect Google' : 'Google sign-in'),
      ),
      body: SafeArea(
        child: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: _complete
                ? Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Icon(Icons.check_circle_outline, size: 48),
                      const SizedBox(height: 16),
                      const Text('Google account connected.'),
                      const SizedBox(height: 16),
                      FilledButton(
                        key: const Key('google_callback_return_button'),
                        onPressed: widget.onReturn,
                        child: const Text('Return to Account'),
                      ),
                    ],
                  )
                : _error == null
                    ? const Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          CircularProgressIndicator(),
                          SizedBox(height: 16),
                          Text('Completing Google sign-in…'),
                        ],
                      )
                    : Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Text(
                            _error!,
                            key: const Key('google_callback_error'),
                            textAlign: TextAlign.center,
                          ),
                          const SizedBox(height: 16),
                          OutlinedButton(
                            key: const Key('google_callback_return_button'),
                            onPressed: widget.onReturn,
                            child: Text(
                              widget.isLink
                                  ? 'Return to Account'
                                  : 'Return to sign in',
                            ),
                          ),
                        ],
                      ),
          ),
        ),
      ),
    );
  }
}

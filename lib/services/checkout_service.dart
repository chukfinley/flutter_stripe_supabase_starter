import 'dart:convert';
import 'package:flutter_dotenv/flutter_dotenv.dart';
import 'package:http/http.dart' as http;
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:uuid/uuid.dart';
import 'package:url_launcher/url_launcher.dart';

class CheckoutService {
  final _uuid = const Uuid();

  Uri _functionsUri(String path) {
    final base = dotenv.get('SUPABASE_FUNCTIONS_URL',
        fallback: '${dotenv.get('SUPABASE_URL')}/functions/v1');
    return Uri.parse('$base/$path');
  }

  /// Returns client_reference_id. Throws on error.
  Future<String> createAndLaunchCheckout(String priceId) async {
    final clientRef = _uuid.v4(); // we’ll also send this to Stripe
    final uri = _functionsUri('create-checkout-session');

    // If the app is logged in with Supabase Auth, pass the JWT (optional)
    final session = Supabase.instance.client.auth.currentSession;
    final headers = <String, String>{
      'Content-Type': 'application/json',
      if (session != null) 'Authorization': 'Bearer ${session.accessToken}',
    };

    final res = await http.post(
      uri,
      headers: headers,
      body: jsonEncode({
        'price_id': priceId,
        'client_reference_id': clientRef,
      }),
    );

    if (res.statusCode != 200) {
      throw 'HTTP ${res.statusCode}: ${res.body}';
    }

    final data = jsonDecode(res.body) as Map<String, dynamic>;
    final url = data['url'] as String?;
    if (url == null) {
      throw 'Missing {url} in response';
    }

    final ok = await launchUrl(
      Uri.parse(url),
      mode: LaunchMode.externalApplication, // universal across platforms
      webOnlyWindowName: '_self', // works for Flutter web
    );
    if (!ok) {
      throw 'Could not open Checkout URL';
    }

    return clientRef;
  }
}

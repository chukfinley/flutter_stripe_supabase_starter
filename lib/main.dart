import 'package:flutter/material.dart';
import 'package:flutter_dotenv/flutter_dotenv.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'services/checkout_service.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await dotenv.load(fileName: ".env");
  await Supabase.initialize(
    url: dotenv.get('SUPABASE_URL'),
    anonKey: dotenv.get('SUPABASE_ANON_KEY'),
  );
  runApp(const MyApp());
}

class MyApp extends StatelessWidget {
  const MyApp({super.key});
  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Stripe Checkout (Hosted)',
      theme: ThemeData(useMaterial3: true, colorSchemeSeed: Colors.indigo),
      home: const HomePage(),
      debugShowCheckedModeBanner: false,
    );
  }
}

class HomePage extends StatefulWidget {
  const HomePage({super.key});
  @override
  State<HomePage> createState() => _HomePageState();
}

class _HomePageState extends State<HomePage> {
  final _checkout = CheckoutService();

  bool _loading = false;
  String? _lastClientRef;

  Future<void> _buy(String priceId) async {
    setState(() => _loading = true);
    try {
      final clientRef = await _checkout.createAndLaunchCheckout(priceId);
      setState(() => _lastClientRef = clientRef);
      // We intentionally do NOT await a return to the app.
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Error: $e')),
        );
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Stripe Checkout (Hosted)')),
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 420),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              if (_lastClientRef != null) ...[
                Text(
                  'Last client_reference_id:\n$_lastClientRef',
                  textAlign: TextAlign.center,
                  style: const TextStyle(fontSize: 12),
                ),
                const SizedBox(height: 16),
              ],
              ElevatedButton.icon(
                onPressed: _loading ? null : () => _buy('price_basic'),
                icon: const Icon(Icons.shopping_cart_checkout),
                label: const Text('Buy Basic'),
              ),
              const SizedBox(height: 12),
              ElevatedButton.icon(
                onPressed: _loading ? null : () => _buy('price_pro'),
                icon: const Icon(Icons.workspace_premium),
                label: const Text('Buy Pro'),
              ),
              const SizedBox(height: 24),
              if (_loading) const CircularProgressIndicator(),
            ],
          ),
        ),
      ),
    );
  }
}

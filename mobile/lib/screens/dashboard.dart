import 'package:flutter/material.dart';
import 'package:cloud_firestore/cloud_firestore.dart';

class DashboardScreen extends StatelessWidget {
  final String userId = "local_developer"; // Hardcoded for now, tie to auth later

  const DashboardScreen({Key? key}) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        title: const Text('SHACKLE OVERSEER', style: TextStyle(fontWeight: FontWeight.bold)),
        backgroundColor: Colors.redAccent.shade700,
        centerTitle: true,
      ),
      body: StreamBuilder<QuerySnapshot>(
        // Streaming the live session data from the Firestore matrix
        stream: FirebaseFirestore.instance
            .collection('users')
            .doc(userId)
            .collection('sessions')
            .orderBy('timestamp', descending: true)
            .limit(1)
            .snapshots(),
        builder: (context, snapshot) {
          if (snapshot.connectionState == ConnectionState.waiting) {
            return const Center(child: CircularProgressIndicator(color: Colors.red));
          }

          if (!snapshot.hasData || snapshot.data!.docs.isEmpty) {
            return const Center(
              child: Text("NO ACTIVE SESSIONS. GET TO WORK.", 
                style: TextStyle(color: Colors.white70, fontSize: 18, letterSpacing: 2)),
            );
          }

          var sessionData = snapshot.data!.docs.first.data() as Map<String, dynamic>;
          int strikes = sessionData['strike_count'] ?? 0;
          String latestRoast = sessionData['latest_roast'] ?? "Monitoring active.";
          bool isBreached = strikes >= 3;

          return Padding(
            padding: const EdgeInsets.all(24.0),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const Text("CURRENT STRIKE COUNT", textAlign: TextAlign.center, 
                  style: TextStyle(color: Colors.grey, fontSize: 16)),
                const SizedBox(height: 10),
                
                // Dynamic Strike Counter
                Text(
                  "$strikes / 3",
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    fontSize: 80,
                    fontWeight: FontWeight.bold,
                    color: isBreached ? Colors.red : Colors.greenAccent,
                  ),
                ),
                
                const SizedBox(height: 40),
                
                // Live Gemini AI Roast Feed
                Container(
                  padding: const EdgeInsets.all(20),
                  decoration: BoxDecoration(
                    color: Colors.grey.shade900,
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: isBreached ? Colors.red : Colors.transparent, width: 2)
                  ),
                  child: Column(
                    children: [
                      const Icon(Icons.record_voice_over, color: Colors.white, size: 30),
                      const SizedBox(height: 15),
                      Text(
                        latestRoast,
                        textAlign: TextAlign.center,
                        style: const TextStyle(color: Colors.white, fontSize: 16, fontStyle: FontStyle.italic),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          );
        },
      ),
    );
  }
}
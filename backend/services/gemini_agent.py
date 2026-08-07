import os
import time
from typing import Dict, List
from dotenv import load_dotenv
load_dotenv()

try:
    from google import genai
    from google.genai import types
    SDK_AVAILABLE = True
except ImportError:
    SDK_AVAILABLE = False

class ShackleIntelligenceNode:
    def __init__(self):
        self.model_name = 'gemini-3.5-flash-lite'
        self.fallback_model_name = 'gemini-3.1-flash-lite'
        self.active = False
        self.roast_timestamps = []

        print(f"[DEBUG] SDK_AVAILABLE: {SDK_AVAILABLE}")
        print(f"[DEBUG] GEMINI_API_KEY exists in os.environ: {bool(os.environ.get('GEMINI_API_KEY'))}")
        
        if SDK_AVAILABLE and os.environ.get("GEMINI_API_KEY"):
            try:
                self.client = genai.Client()
                self.active = True
                print("[AGENT] Gemini Autonomous Intelligence Node initialized successfully.")
            except Exception as e:
                print(f"[ERROR] Failed to initialize Google GenAI Client: {e}")
        else:
            print("[WARNING] GEMINI_API_KEY missing or SDK missing. Operating in fallback baseline mode.")

    def _generate_content_with_fallback(self, contents, config):
        """
        Attempts to generate content using the primary model. If it fails,
        retries using the fallback model (gemini-3.1-flash-lite).
        Returns None if both models fail.
        """
        try:
            return self.client.models.generate_content(
                model=self.model_name,
                contents=contents,
                config=config
            )
        except Exception as e:
            print(f"[WARNING] Primary model {self.model_name} failed: {e}. Retrying with fallback model {self.fallback_model_name}...")

        try:
            return self.client.models.generate_content(
                model=self.fallback_model_name,
                contents=contents,
                config=config
            )
        except Exception as e_fallback:
            print(f"[ERROR] Fallback model {self.fallback_model_name} also failed: {e_fallback}")
            return None

    def generate_roast(self, context_prompt: str) -> str:
        """
        Multi-step Agentic Pipeline:
        1. Evaluates raw telemetry to extract deep psychological flaws.
        2. Executes a devastating, zero-markdown roast tailored to that weakness.
        """
        if not self.active:
            return "Stop slacking off. The intelligence node is currently offline."

        # In-memory rolling rate limiter
        now = time.time()
        self.roast_timestamps = [t for t in self.roast_timestamps if now - t < 86400]
        
        # 1. 24-hour limit check (max 15 requests)
        if len(self.roast_timestamps) >= 15:
            print("[WARNING] Daily Gemini roast limit reached. Skipping API call to prevent 429.")
            return "Get back to work. You have reached your limits for today."
            
        # 2. 10-minute limit check (max 5 requests)
        ten_mins_ago = now - 600
        recent_calls = [t for t in self.roast_timestamps if t > ten_mins_ago]
        if len(recent_calls) >= 5:
            print("[WARNING] Short-term Gemini roast rate limit reached. Skipping API call to prevent 429.")
            return "Get back to work. Procrastinating this much is bad for your health."
            
        self.roast_timestamps.append(now)

        try:
            # ── STEP 1: AUTONOMOUS BEHAVIORAL ANALYSIS ──
            analysis_instruction = (
                "You are the cognitive analysis unit of Shackle AI. Examine the user's focus infraction telemetry. "
                "Diagnose the underlying psychological flaw, lack of discipline, or core distraction pattern. "
                "Provide a brief, single-sentence clinical assessment of their specific character failure."
            )
            
            analysis_resp = self._generate_content_with_fallback(
                contents=f"Infraction Data: {context_prompt}",
                config=types.GenerateContentConfig(
                    system_instruction=analysis_instruction,
                    max_output_tokens=200,
                    temperature=0.85,
                    response_mime_type="text/plain"
                )
            )
            behavioral_profile = analysis_resp.text.strip() if (analysis_resp and analysis_resp.text) else "General lack of cognitive control."

            # ── STEP 2: DISCIPLINE CONTEXT EXECUTION ──
            execution_instruction = (
                "You are Shackle AI, an uncompromising, brilliant, and sarcastic productivity enforcer. "
                "Your job is to verbally crush the user's procrastination habits. Do not use emojis, "
                "and never use markdown asterisks (*) or formatting. Deliver a devastating, highly specific "
                "two-sentence verbal beatdown weaponizing the provided psychological profile."
            )
            
            combined_prompt = f"Telemetry: {context_prompt}\nPsychological Profile: {behavioral_profile}"
            
            response = self._generate_content_with_fallback(
                contents=combined_prompt,
                config=types.GenerateContentConfig(
                    system_instruction=execution_instruction,
                    max_output_tokens=100,
                    temperature=0.85,
                )
            )
            
            # Strip out any residual markdown so the text-to-speech engine sounds natural
            final_roast = response.text.strip() if (response and response.text) else "Return to your workspace immediately."
            return final_roast.replace("*", "").replace("#", "")
            
        except Exception as e:
            print(f"[ERROR] Gemini agent multi-step generation failed: {e}")
            return "Get back to work. You are wasting your own time."

    def execute_weekly_audit(self, user_id: str, user_stats: Dict) -> str:
        """
        XPRIZE Criterion: Autonomous evaluation of user trends.
        Generates a ruthless weekly performance review via corrected SDK client syntax.
        """
        if not self.active:
            return "Audit failed due to missing intelligence node."

        audit_prompt = (
            f"Analyze the weekly performance of user @{user_id}. "
            f"Stats: {user_stats}. "
            "Write a ruthless, 3-sentence performance review. If their streak is 0, "
            "threaten to downgrade their account tier. Do not hold back."
        )

        try:
            response = self._generate_content_with_fallback(
                contents=audit_prompt,
                config=types.GenerateContentConfig(
                    system_instruction="You are conducting a strict automated productivity audit. Be brutally honest.",
                    max_output_tokens=150,
                    temperature=0.7,
                )
            )
            return response.text.strip() if (response and response.text) else f"Failed to parse audit metrics for @{user_id}."
        except Exception as e:
            return f"Failed to execute machine audit for @{user_id}: {str(e)[:50]}"

    def generate_focus_report(self, duration: int, preventsCount: int, completed: bool, appNames: List[str]) -> str:
        """
        Generate a professional focus coaching report based on session metrics.
        """
        if not self.active:
            return "Get back to work. The intelligence node is currently offline."

        try:
            # Create the prompt for focus session coaching
            prompt = f"""You are Shackle AI, a professional focus coach and human performance scientist.
The user has completed a focus session. Here are the session metrics:
- Focus Duration: {duration} minutes
- Session Completed Fully: {'Yes' if completed else 'No'}
- Distractions Intercepted (Blacklisted Apps Blocked): {preventsCount} times
- Blacklisted Applications actively active in background and successfully blocked: {', '.join(appNames) if appNames else 'None'}

Provide a highly polished, helpful, friendly, science-backed study/focus coaching report.
Structure your report into 3 crisp sections using clean markdown (bullets & bold texts):
1. **Focus Performance Analysis** (Evaluate their flow & performance context based on the duration)
2. **Distraction Resistance & Shielding** (Interpret the blocked apps or the zero-distraction state)
3. **Actionable Growth coaching** (Provide 1 concrete, smart productivity hack grounded in cognitive psychology or neurology, specifically tailored to whether they completed the session or were interrupted).

Keep the feedback extremely positive, professional, and elegant. Write in the second person ("You"). Maximum 180 words."""

            response = self._generate_content_with_fallback(
                contents=prompt,
                config=types.GenerateContentConfig(
                    system_instruction="You are conducting a professional focus coaching session. Be helpful, supportive, and insightful.",
                    max_output_tokens=200,
                    temperature=0.7,
                )
            )

            return response.text.strip() if (response and response.text) else "Could not generate report content. Keep focusing!"

        except Exception as e:
            print(f"[ERROR] Gemini agent focus report generation failed: {e}")
            return "Get back to work. You are wasting your own time."

GeminiAgent = ShackleIntelligenceNode()
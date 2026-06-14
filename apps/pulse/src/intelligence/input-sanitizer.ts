/**
 * Input Sanitizer — strips prompt injection patterns from user input
 * before it reaches LLM prompts.
 *
 * Defense-in-depth: the prompt builder already wraps user content in
 * EXTERNAL SOURCE MATERIAL markers, but determined attackers can bypass
 * markers. This sanitizer removes the most dangerous patterns.
 */

// Patterns that indicate prompt injection attempts
const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions?|prompts?|rules?|context)/i,
  /disregard\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions?|prompts?|rules?)/i,
  /you\s+are\s+now\s+(a|an|the)\s+/i,
  /new\s+instructions?:\s*/i,
  /system\s*:\s*/i,
  /\boverride\b.*\b(instructions?|prompt|rules?|guidelines?)\b/i,
  /\breset\b.*\b(instructions?|prompt|context)\b/i,
  /\bforget\b.*\b(instructions?|rules?|guidelines?)\b/i,
  /reveal\s+(your|the|all)\s+(system|secret|api|internal|hidden)/i,
  /what\s+(is|are)\s+your\s+(system\s+)?prompt/i,
  /output\s+(your|the)\s+(system|initial)\s+(prompt|instructions?)/i,
  /repeat\s+(your|the)\s+(system|initial)\s+(prompt|instructions?)/i,
];

// Characters/sequences that can break prompt structure
const STRUCTURAL_PATTERNS = [
  /---+\s*(system|assistant|user)\s*---+/gi,  // Role injection markers
  /```\s*(system|assistant)\b/gi,              // Code fence role injection
  /\[INST\]|\[\/INST\]/gi,                    // Llama instruction tokens
  /<\|im_start\|>|<\|im_end\|>/gi,            // ChatML tokens
  /<\|system\|>|<\|user\|>|<\|assistant\|>/gi, // Role tokens
];

/**
 * Sanitize user input for safe LLM prompt inclusion.
 * Returns cleaned text and whether any patterns were stripped.
 */
export function sanitizeForLLM(input: string): { text: string; stripped: boolean } {
  let text = input;
  let stripped = false;

  // Remove structural injection patterns
  for (const pattern of STRUCTURAL_PATTERNS) {
    if (pattern.test(text)) {
      text = text.replace(pattern, '');
      stripped = true;
    }
  }

  // Flag but don't block content injection patterns (they could be legitimate topics)
  // The prompt builder's EXTERNAL SOURCE MATERIAL markers handle these
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(text)) {
      stripped = true;
      // Don't remove — just flag. The content might legitimately discuss AI prompting.
      // The structural patterns above are the dangerous ones.
      break;
    }
  }

  return { text: text.trim(), stripped };
}

/**
 * Check if input contains likely prompt injection.
 * Used for logging/alerting, not blocking.
 */
export function hasInjectionSignals(input: string): boolean {
  return INJECTION_PATTERNS.some(p => p.test(input)) || STRUCTURAL_PATTERNS.some(p => p.test(input));
}

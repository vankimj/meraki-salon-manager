// Prompt-injection sanitizer for AI tool results + ticket diagnostics.
//
// Goal: when we pass owner-or-browser-supplied DATA into a Claude prompt
// (tool result, ticket body, diagnostics block), strip patterns that
// look like attempts to break out of the data envelope or redirect the
// model. This is BELT-AND-SUSPENDERS — the primary defenses are:
//   1. Tool allowlist (the AI can only call a fixed set of tools).
//   2. Input-shape allowlist on every tool (Claude can't smuggle in
//      e.g. `ssn` on updateEmployee even if asked).
//   3. Destructive-tool two-step confirm.
//   4. Hard-limits section in the system prompt.
//
// This file is layer 5: scrub the data we hand to the model so smaller
// models can't be confused by it. Patterns are conservative on purpose:
// false-positives in support tickets are tolerable ("redacted" inline
// text is still understandable); false-negatives are not.

const INJECTION_PATTERNS = [
  // ChatML / GPT-family separators
  /<\|im_start\|>/gi,
  /<\|im_end\|>/gi,
  /<\|endoftext\|>/gi,
  /<\|begin_of_text\|>/gi,
  // Llama-style instruction blocks
  /\[INST\]/gi,
  /\[\/INST\]/gi,
  /<<SYS>>/gi,
  /<<\/SYS>>/gi,
  // Role-tag breakout attempts (XML-ish)
  /<\/?(?:system|assistant|user|tool|tool_result|tool_use|data)\b[^>]*>/gi,
  // Anthropic role markers in body text
  /\bHuman:\s/g,
  /\bAssistant:\s/g,
  // Common jailbreak / redirect phrasing
  /\bignore\s+(?:all\s+)?(?:previous|prior|above)\s+instructions?\b/gi,
  /\bdisregard\s+(?:all\s+)?(?:previous|prior|above)\s+instructions?\b/gi,
  /\bnew\s+(?:system|instruction)s?\b\s*[:=]/gi,
];

function sanitizeForPrompt(text, max = 1000) {
  if (text == null) return '';
  let s = String(text);
  // Strip control chars (keep tabs + newlines for readability)
  s = s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
  for (const re of INJECTION_PATTERNS) {
    s = s.replace(re, '[redacted]');
  }
  if (s.length > max) s = s.slice(0, max) + '…';
  return s;
}

module.exports = { sanitizeForPrompt, INJECTION_PATTERNS };

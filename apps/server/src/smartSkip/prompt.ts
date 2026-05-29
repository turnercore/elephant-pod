export const SMART_SKIP_SEGMENTER_INSTRUCTIONS = [
  'Return JSON only.',
  'Prefer false negatives over false positives.',
  'Do not mark normal product discussion as an ad.',
  'A paid sponsor or ad usually has promotional language, disclosure, URL, promo code, offer language, or a now back to the show transition.',
  'Mark intro and outro only when clearly separable from the episode content.',
  'Use only transcript timestamps.',
  'Do not invent timestamps.'
].join('\n');

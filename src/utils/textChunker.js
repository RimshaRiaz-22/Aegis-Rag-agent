/**
 * Splits input text into overlapping chunks with word boundary preservation
 * @param {string} text - Raw input document text
 * @param {number} chunkSize - Maximum characters per chunk (default 500)
 * @param {number} chunkOverlap - Overlapping character count (default 50)
 * @returns {Array<string>} List of chunk strings
 */
export function chunkText(text, chunkSize = 500, chunkOverlap = 50) {
  if (!text || typeof text !== 'string') return [];

  // Normalize whitespace
  const clean = text.replace(/\r\n/g, '\n').replace(/\t/g, ' ').trim();
  if (clean.length <= chunkSize) {
    return [clean];
  }

  const chunks = [];
  let startIndex = 0;

  while (startIndex < clean.length) {
    let endIndex = startIndex + chunkSize;

    if (endIndex >= clean.length) {
      chunks.push(clean.slice(startIndex).trim());
      break;
    }

    // Try finding a natural break (period, newline, question mark, or space) near endIndex
    const lookback = Math.min(60, chunkSize / 4);
    const windowToInspect = clean.slice(endIndex - lookback, endIndex);
    const breakMatch = windowToInspect.search(/([.\n?!]\s+|\s+)(?!.*[.\n?!]\s+)/);

    if (breakMatch !== -1) {
      endIndex = endIndex - lookback + breakMatch + 1;
    }

    const chunk = clean.slice(startIndex, endIndex).trim();
    if (chunk.length > 0) {
      chunks.push(chunk);
    }

    // Advance forward respecting overlap
    startIndex = Math.max(startIndex + 1, endIndex - chunkOverlap);
  }

  return chunks;
}

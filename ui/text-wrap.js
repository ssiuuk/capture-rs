// Line breaking for text and callout annotations. Kept free of the DOM so
// it can be tested with Node.

const graphemes = typeof Intl !== 'undefined' && Intl.Segmenter
  ? (() => {
    const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    return (s) => Array.from(seg.segment(s), (g) => g.segment);
  })()
  : (s) => Array.from(s);

// Splits `text` into lines no wider than `maxWidth` as measured by
// `width(string)`. Lines break at spaces; a run without spaces that is
// wider than a line (a long URL, unspaced CJK text) breaks between
// characters, never inside a character such as an emoji with modifiers.
export function wrapLines(text, maxWidth, width) {
  const lines = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const token of para.split(/(\s+)/)) {
      if (!token) continue;
      if (width(line + token) <= maxWidth) {
        line += token;
        continue;
      }
      if (!token.trim()) {
        // Spaces that overflow end the line and are dropped.
        lines.push(line.trimEnd());
        line = '';
        continue;
      }
      if (line.trim()) lines.push(line.trimEnd());
      line = '';
      for (const g of graphemes(token)) {
        if (line && width(line + g) > maxWidth) {
          lines.push(line);
          line = g;
        } else {
          line += g;
        }
      }
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

// Stable identities for interactive blocks and quiz questions, so saved progress survives content edits
// that insert or reorder blocks. A key depends on what the block IS, not on where it sits.
export function hash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  return h.toString(36);
}
function signature(b) {
  if (typeof b !== 'object' || !b) return null;
  if (b.t === 'exercise') return 'x' + hash(b.prompt || '');
  if (b.t === 'predict') return 'p' + hash(b.q || '');
  if (b.t === 'widget') {
    const p = b.props || {};
    return 'w' + hash(b.name + '|' + (b.name === 'c-lab' ? (p.title || '') + (p.prompt || '').slice(0, 120) : JSON.stringify(p)));
  }
  return null;
}
/** Keys for every block of a lesson or lab part, parallel to `blocks`. Non-interactive blocks get an index key. */
export function blockKeys(prefix, blocks) {
  const seen = {};
  return (blocks || []).map((b, i) => {
    const sig = signature(b);
    if (!sig) return `${prefix}:${i}`;
    seen[sig] = (seen[sig] || 0) + 1;
    return `${prefix}:${sig}${seen[sig] > 1 ? '-' + seen[sig] : ''}`;
  });
}
export const questionId = (lessonId, q) => `${lessonId}~${hash(q.q || '')}`;
/** Does this block count toward a lesson's practice total? */
export function isPractice(b) {
  if (typeof b !== 'object' || !b) return false;
  if (b.t === 'exercise') return true;
  if (b.t !== 'widget' || b.practice === false) return false;
  const p = b.props || {};
  return b.name === 'c-lab' || !!(b.challenge || p.challenge || p.scenario || p.device || p.capture || p.image);
}
export function practiceLabel(b) {
  if (b.t === 'exercise') return 'Exercise';
  if (b.name === 'c-lab') return 'C exercise';
  return 'Challenge';
}

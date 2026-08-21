import { splitFeedback } from './callVisuals';

/**
 * A saved call note packs every ticked result into a "[Label · Label] free text"
 * prefix. splitFeedback pulls the labels back out so the journal and history can
 * show ALL of them (not just the single strongest outcome). These guard that
 * round-trip and the awkward edges.
 */
describe('splitFeedback', () => {
  it('splits the bracketed labels from the free text', () => {
    const r = splitFeedback('[Interested — sell · Agent] Spoke to the owner');
    expect(r.tags).toEqual(['Interested — sell', 'Agent']);
    expect(r.text).toBe('Spoke to the owner');
  });

  it('handles a tags-only note (no free text)', () => {
    const r = splitFeedback('[Agent]');
    expect(r.tags).toEqual(['Agent']);
    expect(r.text).toBe('');
  });

  it('treats a plain note as free text with no tags', () => {
    const r = splitFeedback('Just a note, no results ticked');
    expect(r.tags).toEqual([]);
    expect(r.text).toBe('Just a note, no results ticked');
  });

  it('is safe on empty / missing notes', () => {
    expect(splitFeedback(undefined)).toEqual({ tags: [], text: '' });
    expect(splitFeedback('')).toEqual({ tags: [], text: '' });
  });

  it('keeps a stray ] in the free text out of the tags', () => {
    const r = splitFeedback('[No answer · Agent] tried again ] later');
    expect(r.tags).toEqual(['No answer', 'Agent']);
    expect(r.text).toBe('tried again ] later');
  });
});

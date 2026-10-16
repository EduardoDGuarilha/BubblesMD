import { describe, expect, it } from 'vitest';
import { diffCandidate } from '../core/changes';
import { renderCandidate } from './candidateHtml';

const render = (source: string, candidate: string, popped: string[] = []) => {
  const diff = diffCandidate(source, candidate);
  const { root, groups } = renderCandidate(diff, popped, false, 'r1');
  // Every live change stays identifiable and individually poppable, inline or listed.
  for (const g of groups) expect(root.querySelector(`[data-review="r1"][data-change="${g.id}"]`), g.id).not.toBeNull();
  return { root, diff };
};
const changed = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>('.cand-change')].map((e) => e.textContent);

const TAIL = ' wandered into the library to pick up some books.';
const LINK = '**[Albus Dumbledore](https://example.org/albus)**';

describe('candidate rendering around change markers', () => {
  it('renders a bold link right after a change that ends in a space (transcribed screenshot 2)', () => {
    const { root } = render(
      `It was a rainy Friday afternoon near the start of term when ${LINK}${TAIL}`,
      `It was a cold Friday afternoon near the start of term, the kind of day when the sky sat low. It was then that ${LINK}${TAIL}`,
    );
    expect(root.querySelector('strong > a')?.textContent).toBe('Albus Dumbledore');
    expect(root.textContent).not.toContain('**');
    expect(changed(root)).toContain(', the kind of day');
    expect(changed(root).some((t) => t?.includes('Albus'))).toBe(false);
    expect(root.querySelector('.cand-unseen')).toBeNull();
  });

  it('keeps emphasis and strikethrough around links next to change boundaries', () => {
    for (const [d, tag] of [['*', 'em'], ['~~', 'del'], ['**', 'strong']]) {
      const link = `${d}[the guide](https://example.org)${d}`;
      const before = render(`Read ${link} now.`, `Read and also ${link} now.`).root;
      expect(before.querySelector(`${tag} > a`)?.textContent, `${d} after`).toBe('the guide');
      const after = render(`Meet ${link}`, `Meet ${link} today`).root;
      expect(after.querySelector(`${tag} > a`)?.textContent, `${d} before`).toBe('the guide');
      expect(changed(after)).toEqual([' today']);
      expect(before.querySelector('.cand-unseen'), d).toBeNull();
    }
  });

  it('highlights only the changed word inside a partially changed bold span', () => {
    const { root } = render('**old bold** text', '**new bold** text');
    expect(root.querySelector('strong')?.textContent).toBe('new bold');
    expect([...root.querySelectorAll('strong .cand-change')].map((e) => e.textContent)).toEqual(['new']);
  });

  it('lists a change it cannot mark inline by its own text, with the Markdown rendered intact', () => {
    const { root, diff } = render('named **[A](https://example.org)** here', 'named (**[A](https://example.org)**) here');
    expect(root.querySelector('strong > a')?.textContent).toBe('A');
    const chips = [...root.querySelectorAll<HTMLElement>('.cand-unseen [data-change]')];
    expect(chips.length).toBeGreaterThan(0);
    for (const chip of chips) {
      const g = diff.groups.find((x) => x.id === chip.dataset.change)!;
      expect(chip.textContent).toContain(g.replacement.trim());
      expect(chip.getAttribute('role')).toBe('button');
    }
  });

  it('marks each deletion point with a red − button, also for a whole-selection deletion', () => {
    const several = render('one two three four five', 'one three five').root;
    const minus = [...several.querySelectorAll<HTMLElement>('.cand-delete')];
    expect(minus.length).toBe(2);
    for (const m of minus) {
      expect(m.querySelector('.minus-icon')).not.toBeNull();
      expect(m.getAttribute('role')).toBe('button');
      expect(m.getAttribute('aria-label')).toMatch(/^Deleted: “.+”\. Pop to keep it\.$/);
    }
    const whole = render('Delete all of this.', '').root;
    expect(whole.querySelectorAll('.cand-delete').length).toBe(1);
  });
});

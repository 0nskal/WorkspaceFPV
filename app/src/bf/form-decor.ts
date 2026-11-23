/**
 * Adds lightbulb tips and Basic/Expert visibility to rows rendered by mountFormTab() without touching form.ts:
 * rows are matched by their `data-row` key, panels by their header title. Runs after every re-render (MutationObserver)
 * and is idempotent. See docs/TIPS.md.
 */
import { tip, type TipKey } from '../ui/tip';

export interface RowRule {
  /** Field key (exact string) or a pattern. */
  key: string | RegExp;
  tip?: TipKey;
  /** Hidden in Basic mode. */
  expert?: boolean;
}

export interface PanelRule {
  /** Translated group title as rendered. */
  title: string;
  tip?: TipKey;
  expert?: boolean;
}

export function decorateForm(el: HTMLElement, rows: RowRule[], panels: PanelRule[] = []): () => void {
  const apply = () => {
    el.querySelectorAll<HTMLElement>('.bf-row[data-row]').forEach((row) => {
      const key = row.dataset.row ?? '';
      const rule = rows.find((r) => (typeof r.key === 'string' ? r.key === key : r.key.test(key)));
      if (!rule) return;
      if (rule.expert) row.dataset.level = 'expert';
      // the curated tip takes the row's help slot (right column), replacing the field's own short tip
      const slot = row.querySelector<HTMLElement>(':scope > .tip:not([data-decor]), :scope > .bf-tip-gap');
      if (rule.tip && slot) slot.outerHTML = tip(rule.tip).replace('class="tip"', 'class="tip" data-decor');
    });
    el.querySelectorAll<HTMLElement>('.bf-panel').forEach((panel) => {
      const span = panel.querySelector<HTMLElement>(':scope > header > span');
      const title = span?.firstChild?.textContent?.trim() ?? '';
      const rule = panels.find((p) => p.title === title);
      if (!rule) return;
      if (rule.expert) panel.dataset.level = 'expert';
      if (rule.tip && span && !span.querySelector('.tip')) span.insertAdjacentHTML('beforeend', ` ${tip(rule.tip)}`);
    });
    // a panel whose every row is expert-only would show up empty in Basic mode: hide the whole panel there
    el.querySelectorAll<HTMLElement>('.bf-panel').forEach((panel) => {
      const rows = panel.querySelectorAll<HTMLElement>('.bf-row[data-row]');
      if (rows.length && [...rows].every((r) => r.dataset.level === 'expert')) panel.dataset.level = 'expert';
    });
  };
  apply();
  const mo = new MutationObserver(apply);
  mo.observe(el, { childList: true, subtree: true });
  return () => mo.disconnect();
}

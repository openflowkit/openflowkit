import { IconChevronDown, IconChevronUp, IconX } from '@tabler/icons-react';
import { Field, Icon, IconButton } from '../design-system';
import type { useV2Find } from './useV2Find';
import { composing } from './useV2Keyboard';

/** The ⌘F bar: a query, "n of m", and previous/next. Enter and Shift+Enter step; Escape closes and restores. */
export function V2FindBar({ find, label = 'Find on canvas' }: { readonly find: ReturnType<typeof useV2Find>; readonly label?: string }): React.JSX.Element {
  const { query, index, count } = find;
  const status = !query.trim() ? '' : count === 0 ? 'No matches' : index < 0 ? `${count} found` : `${index + 1} of ${count}`;
  return (
    <div className="ofk-v2-find" role="search" aria-label={label}>
      <Field ref={(input) => find.register(input)} label={label} type="search" autoFocus autoComplete="off" value={query}
        placeholder={label}
        onChange={(event) => find.search(event.target.value)}
        onKeyDown={(event) => {
          if (composing(event)) return;
          if (event.key === 'Enter') find.step(event.shiftKey ? -1 : 1);
          else if (event.key === 'Escape') find.close(true);
          else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') find.show();
          else return;
          event.preventDefault();
          event.stopPropagation();
        }} />
      <span className="ofk-v2-find-count" aria-live="polite">{status}</span>
      <IconButton variant="quiet" label="Previous match" disabled={count === 0} icon={<Icon icon={IconChevronUp} />}
        onClick={() => find.step(-1)} />
      <IconButton variant="quiet" label="Next match" disabled={count === 0} icon={<Icon icon={IconChevronDown} />}
        onClick={() => find.step(1)} />
      <IconButton variant="quiet" label="Close find" icon={<Icon icon={IconX} />} onClick={() => find.close(false)} />
    </div>
  );
}

/** "3 things didn’t come across: a; b; c." — the first few, so a toast stays readable. Every import and paste says it. */
export function lossNote(losses: readonly string[]): string {
  const shown = losses.slice(0, 3).join('; ');
  const more = losses.length > 3 ? `; and ${losses.length - 3} more` : '';
  return `${losses.length} ${losses.length === 1 ? 'thing' : 'things'} didn’t come across: ${shown}${more}.`;
}

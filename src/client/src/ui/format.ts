/** Charged cost display. Unknown is never shown as $0; fixture calls say so explicitly. */
export function formatCost(cost: number | null | undefined, provider?: string | null): string {
  if (provider === 'fake') return 'fixture · no charge';
  if (cost === null || cost === undefined) return 'cost unknown';
  if (cost === 0) return '$0.0000';
  if (cost < 0.0001) return '<$0.0001';
  return `$${cost.toFixed(4)}`;
}

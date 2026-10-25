// Conservative application budget, not a promise about the provider's external invoice.
export const MAX_OUTPUT = 4096;
export const MAX_INPUT_BYTES = 12000;
export const BUDGET_MONTH = () => new Date().toISOString().slice(0,7); // Explicit UTC billing month.
export function monthlyBudget(raw: string | undefined): number {
  if (!raw) return 0;
  if (!/^\d{1,4}(?:\.\d{1,2})?$/.test(raw)) return 0;
  const value = Math.round(Number(raw)*1_000_000);
  return value <= 1000_000_000 ? value : 0;
}
export function requestReservation(params: any) {
  if (params.model !== 'claude-opus-5-5' || params.tools?.length || params.fallbacks || params.betas?.length ||
      !Number.isInteger(params.max_tokens) || params.max_tokens < 1 || params.max_tokens > MAX_OUTPUT) {
    throw Object.assign(new Error('This paid request is outside the approved budget profile. Live research and automatic fallback are paused.'),{status:402});
  }
  const bytes = Buffer.byteLength(JSON.stringify(params),'utf8');
  if (bytes>MAX_INPUT_BYTES) throw Object.assign(new Error('Analysis context is too large. Use the free debt plan or ask a narrower question.'),{status:413});
  // Reserve the complete maximum, including a 2,048-token envelope margin.
  // $8/M input covers even a 1-hour cache write; $20/M output includes thinking.
  // Prices reviewed 2026-10-24. Each reservation stays charged even on errors.
  return (bytes+2048)*8 + params.max_tokens*20;
}

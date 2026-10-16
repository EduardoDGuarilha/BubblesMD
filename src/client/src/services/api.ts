import type { KeepOriginal, Mode, SuggestAction, Usage } from '../core/workspace';

export interface SuggestPayload {
  requestId: string;
  reviewId: string;
  revision: number;
  action: SuggestAction;
  mode: Mode;
  selection: string;
  contextBefore: string;
  contextAfter: string;
  /** isNew marks reflections added or edited since the active suggestion was generated. */
  reflections: { id: string; text: string; isNew: boolean }[];
  prior: { source: string; candidate: string; keepOriginal: KeepOriginal[] } | null;
}

export interface SuggestResponse {
  requestId: string;
  reviewId: string;
  revision: number;
  outcome: 'replace' | 'unchanged' | 'cannot_apply';
  replacement: string | null;
  reason: string | null;
  mode: Mode;
  model: string;
  provider: string;
  usage: Usage;
  latencyMs: number;
  /** One entry per provider call (two when the server made a no-change correction). */
  attempts?: AttemptInfo[];
}

export interface AttemptInfo {
  model: string;
  outcome: string;
  usage: Usage;
  latencyMs: number;
}

export interface ModeInfo {
  mode: Mode;
  label: string;
  model: string;
  inputPerMillion: number | null;
  outputPerMillion: number | null;
}

export interface AppConfig {
  provider: string;
  keyConfigured: boolean;
  modes: ModeInfo[];
  limits: { selectionChars: number; contextChars: number; reflectionChars: number; importBytes: number };
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    /** Whether the provider may have charged for this failed request. */
    readonly charged: 'no' | 'unknown',
    /** Provider calls that did complete before the failure (their usage still counts). */
    readonly attempts: AttemptInfo[] = [],
  ) {
    super(message);
  }
}

export type SuggestFn = (payload: SuggestPayload, signal: AbortSignal) => Promise<SuggestResponse>;

export const suggest: SuggestFn = async (payload, signal) => {
  let res: Response;
  try {
    res = await fetch('/api/suggest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal,
    });
  } catch (e) {
    if (signal.aborted) throw new ApiError('Request cancelled.', 0, 'cancelled', 'unknown');
    throw new ApiError('Could not reach the Bubbles.MD server.', 0, 'network', 'unknown');
  }
  if (res.ok) return (await res.json()) as SuggestResponse;
  let body: { error?: { code?: string; message?: string; charged?: 'no' | 'unknown'; attempts?: AttemptInfo[] } } = {};
  try {
    body = await res.json();
  } catch {
    /* non-JSON error body */
  }
  throw new ApiError(
    body.error?.message ?? `Server error (${res.status}).`,
    res.status,
    body.error?.code ?? 'http_error',
    body.error?.charged ?? 'unknown',
    body.error?.attempts ?? [],
  );
};

export async function fetchConfig(): Promise<AppConfig | null> {
  try {
    const res = await fetch('/api/config');
    return res.ok ? ((await res.json()) as AppConfig) : null;
  } catch {
    return null;
  }
}

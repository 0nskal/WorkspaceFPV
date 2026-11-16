/**
 * Tiny adapter: the single place where the ESC / ELRS info flows get their connection from.
 * Today it wraps `ctx.link()` (FcLink: MSP request + raw session); when the new core store lands only this file changes.
 */
import type { AppContext } from '../context';
import type { FcLink, RawIo } from '../serial/types';

export interface HwIo {
  readonly kind: 'serial' | 'demo';
  /** MSP v1 request while the link is in normal mode. */
  request(cmd: number, payload?: Uint8Array, timeoutMs?: number): Promise<Uint8Array>;
  /** Raw session (MSP suspended); see RawIo. */
  raw<T>(fn: (io: RawIo) => Promise<T>): Promise<T>;
  /** Identity of the underlying link, to tell "same link" from "reconnected link". */
  readonly token: unknown;
}

/** null when there is no connection or the link cannot do raw sessions. */
export function hwIo(ctx: AppContext): HwIo | null {
  const link: FcLink | null = ctx.link();
  if (!link || !link.raw) return null;
  const raw = link.raw.bind(link);
  return {
    kind: link.kind,
    request: (cmd, payload, timeoutMs) => link.request(cmd, payload, timeoutMs),
    raw,
    token: link,
  };
}

/** True when the app currently has a link (any kind). */
export const hasLink = (ctx: AppContext): boolean => ctx.link() !== null;
export const currentToken = (ctx: AppContext): unknown => ctx.link();

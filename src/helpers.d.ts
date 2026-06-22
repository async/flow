import type { FlowHandler } from "./runtime.js";

export const status: typeof import("./define.js").defineStatus;
export function set(name: string, value: unknown): FlowHandler;
export function set(updates: Record<string, unknown>): FlowHandler;
export function update(
  name: string,
  fn: (current: unknown, store: Record<string, unknown>, input: unknown, previous: unknown) => unknown
): FlowHandler;
export function when(
  predicate: (store: Record<string, unknown>, input: unknown, previous: unknown) => boolean
): FlowHandler;
export function onError(
  handle: (error: unknown, store: Record<string, unknown>, input: unknown, previous: unknown) => unknown,
  handler: FlowHandler
): FlowHandler;
export function guard(
  predicate: (store: Record<string, unknown>, input: unknown, previous: unknown) => boolean,
  handler: FlowHandler
): FlowHandler;
export function transition(
  config:
    | Record<string, unknown>
    | { from?: unknown | readonly unknown[]; to: unknown; when?: (store: Record<string, unknown>, input: unknown, previous: unknown) => boolean }
    | readonly { from?: unknown | readonly unknown[]; to: unknown; when?: (store: Record<string, unknown>, input: unknown, previous: unknown) => boolean }[],
  options?: { status?: string; state?: string; signal?: string }
): FlowHandler;
export function can(eventName: string, options?: { status?: string; state?: string }): unknown;
export function matches(value: unknown, options?: { status?: string; state?: string; signal?: string }): unknown;

import type { FlowHandler, FlowHandlerContext } from "./runtime.js";
import type { FlowStateDefinition } from "./define.js";

export function state<T>(initial: T, allowed: readonly T[]): FlowStateDefinition<T>;

export function set(
  updates: Record<string, unknown>
): FlowHandler;
export function set(
  name: string,
  value: unknown
): FlowHandler;
export function update(
  name: string,
  fn: (current: unknown, context: FlowHandlerContext) => unknown
): FlowHandler;
export function when(
  predicate: (context: FlowHandlerContext) => boolean
): FlowHandler;
export function onError(
  handle: (error: unknown, context: FlowHandlerContext) => unknown,
  handler: FlowHandler
): FlowHandler;
export function guard(
  predicate: (context: FlowHandlerContext) => boolean,
  handler: FlowHandler
): FlowHandler;
export function transition(
  config:
    | Record<string, unknown>
    | { from?: unknown | readonly unknown[]; to: unknown; when?: (context: FlowHandlerContext) => boolean }
    | readonly { from?: unknown | readonly unknown[]; to: unknown; when?: (context: FlowHandlerContext) => boolean }[],
  options?: { state?: string; signal?: string }
): FlowHandler;
export function can(eventName: string, options?: { state?: string; signal?: string }): import("./define.js").FlowComputedDefinition<boolean>;
export function matches(value: unknown, options?: { state?: string; signal?: string }): import("./define.js").FlowComputedDefinition<boolean>;

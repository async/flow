import type { FlowHandler } from "./runtime.js";

export const TRANSITION: unique symbol;
export const GUARD: unique symbol;
export const status: typeof import("./define.js").defineStatus;
export type FlowMetadataOptions = {
  reason?: string;
  label?: string;
};
export type FlowStepResolver = (
  store: Record<string, unknown>,
  input: unknown,
  previous: unknown
) => unknown;
export type FlowStepValue = unknown | FlowStepResolver;
export type FlowPredicate = (
  store: Record<string, unknown>,
  input: unknown,
  previous: unknown
) => boolean;
export type FlowBranchCase =
  | readonly [FlowPredicate, FlowHandler]
  | {
      when?: FlowPredicate;
      then: FlowHandler;
      default?: boolean;
    }
  | FlowHandler;
export function set(name: string, value: FlowStepValue): FlowHandler;
export function set(updates: Record<string, FlowStepValue>): FlowHandler;
export function dispatch(eventName: string, input?: FlowStepValue): FlowHandler;
export function after(ms: number, eventName: string, input?: FlowStepValue): FlowHandler;
export function update(
  name: string,
  fn: (current: unknown, store: Record<string, unknown>, input: unknown, previous: unknown) => unknown
): FlowHandler;
export function when(
  predicate: FlowPredicate
): FlowHandler;
export function branch(cases: readonly FlowBranchCase[]): FlowHandler;
export function onError(
  handle: (error: unknown, store: Record<string, unknown>, input: unknown, previous: unknown) => unknown,
  handler: FlowHandler
): FlowHandler;
export function guard(
  predicate: (store: Record<string, unknown>, input: unknown, previous: unknown) => boolean,
  handler: FlowHandler,
  options?: FlowMetadataOptions
): FlowHandler;
export function transition(
  statusName: string,
  config:
    | Record<string, unknown>
    | ({
        from?: unknown | readonly unknown[];
        to: unknown;
        when?: (store: Record<string, unknown>, input: unknown, previous: unknown) => boolean;
      } & FlowMetadataOptions)
    | readonly ({
        from?: unknown | readonly unknown[];
        to: unknown;
        when?: (store: Record<string, unknown>, input: unknown, previous: unknown) => boolean;
      } & FlowMetadataOptions)[]
): FlowHandler;
export function can(eventName: string): unknown;
export function can(statusName: string, eventName: string): unknown;
export function matches(statusName: string, value: unknown): unknown;

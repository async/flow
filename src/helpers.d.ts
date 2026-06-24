import type { FlowHandler } from "./runtime.js";
import type { FlowComputedDefinition } from "./define.js";

export const TRANSITION: unique symbol;
export const GUARD: unique symbol;
export const AVAILABILITY: unique symbol;
export const status: typeof import("./define.js").defineStatus;
export type FlowMetadataOptions = {
  reason?: string;
  label?: string;
};
export type FlowAvailabilityOptions = FlowMetadataOptions & {
  availability?: boolean;
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
export type FlowBooleanPredicate = (
  this: unknown,
  store: Record<string, unknown>,
  input: unknown,
  previous: unknown
) => unknown;
export type FlowBooleanCondition =
  | FlowComputedDefinition<unknown>
  | FlowBooleanPredicate;
export type FlowBranchCase =
  | readonly [FlowBooleanCondition, FlowHandler]
  | {
      when?: FlowBooleanCondition;
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
export function bool(condition: FlowBooleanCondition): FlowComputedDefinition<boolean>;
export function every(...conditions: FlowBooleanCondition[]): FlowComputedDefinition<boolean>;
export function some(...conditions: FlowBooleanCondition[]): FlowComputedDefinition<boolean>;
export function not(condition: FlowBooleanCondition): FlowComputedDefinition<boolean>;
export function when(
  predicate: FlowBooleanCondition,
  options?: FlowAvailabilityOptions
): FlowHandler;
export function branch(cases: readonly FlowBranchCase[]): FlowHandler;
export function onError(
  handle: (error: unknown, store: Record<string, unknown>, input: unknown, previous: unknown) => unknown,
  handler: FlowHandler
): FlowHandler;
export function guard(
  predicate: FlowBooleanCondition,
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
        when?: FlowBooleanCondition;
      } & FlowMetadataOptions)
    | readonly ({
        from?: unknown | readonly unknown[];
        to: unknown;
        when?: FlowBooleanCondition;
      } & FlowMetadataOptions)[]
): FlowHandler;
export function can(eventName: string): FlowComputedDefinition<boolean>;
export function can(statusName: string, eventName: string): FlowComputedDefinition<boolean>;
export function matches(statusName: string, value: unknown | readonly unknown[]): FlowComputedDefinition<boolean>;

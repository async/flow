import {
  AVAILABILITY,
  GUARD,
  STANDALONE_AFTER,
  STANDALONE_DISPATCH,
  STANDALONE_TRANSITION,
  TRANSITION
} from "./protocol.js";
import type { Computed, FlowHandler, FlowHandlerReceiver, FlowInstance, Signal, Status } from "./runtime.js";
import type { FlowComputedDefinition } from "./define.js";

export {
  AVAILABILITY,
  GUARD,
  STANDALONE_AFTER,
  STANDALONE_DISPATCH,
  STANDALONE_TRANSITION,
  TRANSITION
} from "./protocol.js";
export const status: typeof import("./runtime.js").createStatus;
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
  | Computed<unknown>
  | Signal<unknown>
  | Status<unknown>
  | FlowBooleanPredicate;
export type FlowLiveBooleanCondition = Computed<unknown> | Signal<unknown> | Status<unknown>;
export type FlowBranchCase =
  | readonly [FlowBooleanCondition, FlowHandler]
  | {
      when?: FlowBooleanCondition;
      then: FlowHandler;
      default?: boolean;
    }
  | FlowHandler;
export type StandaloneAfter = {
  (input?: unknown): () => void;
  readonly [STANDALONE_AFTER]: {
    readonly ms: number;
  };
};
export type FlowDispatchDomTarget = {
  dispatchEvent(event: unknown): boolean;
};
export type FlowDispatchEmitterTarget = {
  emit(eventName: string, payload?: unknown): unknown;
};
export type FlowDispatchSenderTarget = {
  send(eventName: string, payload?: unknown): unknown;
};
export type FlowDispatchTarget =
  | FlowInstance
  | FlowHandlerReceiver
  | FlowDispatchDomTarget
  | FlowDispatchEmitterTarget
  | FlowDispatchSenderTarget;
export type StandaloneDispatch = FlowHandler & {
  readonly [STANDALONE_DISPATCH]: {
    readonly event: string;
    readonly payload: boolean;
  };
  send(target: FlowDispatchTarget, payload?: unknown): unknown;
  emit(target: FlowDispatchTarget, payload?: unknown): unknown;
};
export type FlowInspection =
  | Record<string, unknown>
  | {
      type: "signal" | "computed";
      value: unknown;
    }
  | {
      type: "status";
      value: unknown;
      allowed?: readonly unknown[];
    }
  | {
      type: "transition";
      status?: string;
      target?: FlowInspection;
      rules: readonly Record<string, unknown>[];
    }
  | {
      type: "after";
      ms: number;
    }
  | {
      type: "dispatch";
      event: string;
      payload: boolean;
    };
export function set(name: string, value: FlowStepResolver): FlowHandler;
export function set(name: string, value: FlowStepValue): FlowHandler;
export function set(ref: Signal<unknown> | Status<unknown>, value: FlowStepResolver): FlowHandler;
export function set(ref: Signal<unknown> | Status<unknown>, value: FlowStepValue): FlowHandler;
export function set(updates: Record<string, FlowStepValue>): FlowHandler;
export function dispatch(eventName: string, payload?: FlowStepValue): StandaloneDispatch;
export function dispatch(target: FlowDispatchTarget, eventName: string, payload?: unknown): unknown;
export function after(ms: number, eventName: string, input?: FlowStepValue): FlowHandler;
export function after(ms: number, task: (input: unknown) => unknown, input?: unknown): StandaloneAfter;
export function update(
  name: string,
  fn: (current: unknown, store: Record<string, unknown>, input: unknown, previous: unknown) => unknown
): FlowHandler;
export function update(
  ref: Signal<unknown> | Status<unknown>,
  fn: (current: unknown, store: Record<string, unknown>, input: unknown, previous: unknown) => unknown
): FlowHandler;
export function bool(condition: FlowLiveBooleanCondition): Computed<boolean>;
export function bool(condition: FlowBooleanCondition): FlowComputedDefinition<boolean>;
export function every(...conditions: FlowLiveBooleanCondition[]): Computed<boolean>;
export function every(...conditions: FlowBooleanCondition[]): FlowComputedDefinition<boolean>;
export function some(...conditions: FlowLiveBooleanCondition[]): Computed<boolean>;
export function some(...conditions: FlowBooleanCondition[]): FlowComputedDefinition<boolean>;
export function not(condition: FlowLiveBooleanCondition): Computed<boolean>;
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
  statusTarget: string | Signal<unknown> | Status<unknown>,
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
export function can(flow: FlowInstance | FlowHandlerReceiver, eventName: string, input?: unknown): Computed<boolean>;
export function can(transitionStep: FlowHandler, input?: unknown): Computed<boolean>;
export function matches(statusName: string, value: unknown | readonly unknown[]): FlowComputedDefinition<boolean>;
export function matches(ref: Signal<unknown> | Status<unknown>, value: unknown | readonly unknown[]): Computed<boolean>;
export function inspect(target: unknown): FlowInspection;

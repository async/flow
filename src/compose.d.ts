export { COMPOSE_BATCH } from "./protocol.js";

export type MaybePromise<T> = T | PromiseLike<T>;
export type Step<TStore = Record<string, unknown>, TInput = unknown, TResult = unknown> = (
  this: unknown,
  store: TStore,
  input: TInput,
  previous: unknown
) => MaybePromise<TResult | void>;
export type ComposedHandler<TStore = Record<string, unknown>, TInput = unknown, TResult = unknown> = (
  this: unknown,
  store: TStore,
  input: TInput
) => MaybePromise<TResult | void>;

export function compose<TStore = Record<string, unknown>, TInput = unknown, TResult = unknown>(
  step: Step<TStore, TInput, TResult>
): ComposedHandler<TStore, TInput, TResult>;
export function compose<TStore = Record<string, unknown>, TInput = unknown, TResult = unknown>(
  steps: Step<TStore, TInput, TResult>[]
): ComposedHandler<TStore, TInput, TResult>;
export function parallel<TStore = Record<string, unknown>, TInput = unknown>(
  branches: Step<TStore, TInput, unknown>[] | Record<string, Step<TStore, TInput, unknown>>
): Step<TStore, TInput, void>;
export function remember<TStore = Record<string, unknown>, TInput = unknown, TResult = unknown>(
  mapping: readonly [string, string],
  step: Step<TStore, TInput, TResult> | Step<TStore, TInput, TResult>[]
): Step<TStore, TInput, TResult>;
export function remember<TStore = Record<string, unknown>, TInput = unknown, TResult = unknown>(
  mappings: readonly (readonly [string, string])[],
  step: Step<TStore, TInput, TResult> | Step<TStore, TInput, TResult>[]
): Step<TStore, TInput, TResult>;
export function isPromiseLike(value: unknown): value is PromiseLike<unknown>;

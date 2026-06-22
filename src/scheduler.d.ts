import type { FlowScheduler } from "./runtime.js";

export function createDefaultScheduler(): FlowScheduler;
export let defaultScheduler: FlowScheduler;
export function getDefaultScheduler(): FlowScheduler;
export function setDefaultScheduler(scheduler: FlowScheduler): FlowScheduler;
export function resetDefaultScheduler(): FlowScheduler;
export function resolveScheduler(options?: { scheduler?: FlowScheduler }): FlowScheduler;
export function validateScheduler(scheduler: FlowScheduler): void;

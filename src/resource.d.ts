export {
  defineResource,
  defineResource as resource,
  isImmediateResource,
  isResource,
  isResourceDefinition,
  RESOURCE,
  RESOURCE_IMMEDIATE
} from "./define.js";
export {
  createResource
} from "./runtime.js";
export type {
  FlowResourceDefinition,
  FlowResourceOptions
} from "./define.js";
export type {
  Resource,
  ResourceSnapshot
} from "./runtime.js";

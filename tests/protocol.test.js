import assert from "node:assert/strict";
import test from "node:test";
import { COMPOSE_BATCH } from "@async/flow/compose";
import {
  ASYNC_SIGNAL,
  ASYNC_SIGNAL_IMMEDIATE,
  COMPUTED,
  SIGNAL,
  STATUS
} from "@async/flow/define";
import { FLOW_GRAPH, FLOW_GRAPH_KIND } from "@async/flow/graph";
import {
  AVAILABILITY,
  GUARD,
  STANDALONE_AFTER,
  STANDALONE_DISPATCH,
  STANDALONE_TRANSITION,
  TRANSITION
} from "@async/flow/helpers/core";
import { FLOW_INSPECT, FLOW_INSTANCE } from "@async/flow/framework-runtime";
import * as protocol from "@async/flow/protocol";

test("protocol subpath owns shared Flow brands", () => {
  assert.equal(protocol.SIGNAL, SIGNAL);
  assert.equal(protocol.STATUS, STATUS);
  assert.equal(protocol.COMPUTED, COMPUTED);
  assert.equal(protocol.ASYNC_SIGNAL, ASYNC_SIGNAL);
  assert.equal(protocol.ASYNC_SIGNAL_IMMEDIATE, ASYNC_SIGNAL_IMMEDIATE);
  assert.equal(protocol.FLOW_INSTANCE, FLOW_INSTANCE);
  assert.equal(protocol.FLOW_INSPECT, FLOW_INSPECT);
  assert.equal(protocol.TRANSITION, TRANSITION);
  assert.equal(protocol.GUARD, GUARD);
  assert.equal(protocol.AVAILABILITY, AVAILABILITY);
  assert.equal(protocol.STANDALONE_TRANSITION, STANDALONE_TRANSITION);
  assert.equal(protocol.STANDALONE_AFTER, STANDALONE_AFTER);
  assert.equal(protocol.STANDALONE_DISPATCH, STANDALONE_DISPATCH);
  assert.equal(protocol.COMPOSE_BATCH, COMPOSE_BATCH);
  assert.equal(protocol.FLOW_GRAPH, FLOW_GRAPH);
  assert.equal(protocol.FLOW_GRAPH_KIND, FLOW_GRAPH_KIND);
});

test("protocol subpath stays metadata-only", () => {
  assert.equal(protocol.flow, undefined);
  assert.equal(protocol.createFlow, undefined);
  assert.equal(protocol.setDefaultScheduler, undefined);
  assert.equal(protocol.toGraph, undefined);
});

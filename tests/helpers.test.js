import assert from "node:assert/strict";
import test from "node:test";
import { flow, onError, set, update, when } from "@async/flow";
import { run } from "@async/flow/run";

test("set and update helpers write through Flow signals", () => {
  const counter = flow({
    signals: {
      loading: false,
      count: 0
    },
    on: {
      start: set({ loading: true }),
      increment: update("count", (count) => count + 1)
    }
  });

  counter.start();
  counter.increment();

  assert.equal(counter.signals.loading, true);
  assert.equal(counter.signals.count, 1);
});

test("run helpers can be used as a normal Flow handler function", async () => {
  const checkout = flow({
    signals: {
      loading: false,
      canSubmit: true,
      orderId: null
    },
    on: {
      submit: run([
        when(({ signals }) => signals.canSubmit),
        set("loading", true),
        async ({ input }) => ({
          loading: false,
          orderId: input.orderId
        })
      ])
    }
  });

  const result = checkout.submit({ orderId: "ord_123" });

  assert.equal(checkout.signals.loading, true);
  assert.deepEqual(await result, {
    loading: false,
    orderId: "ord_123"
  });
  assert.deepEqual(checkout.snapshot(), {
    loading: false,
    canSubmit: true,
    orderId: "ord_123"
  });
});

test("when stops a helper chain without applying later steps", () => {
  const checkout = flow({
    signals: {
      canSubmit: false,
      loading: false
    },
    on: {
      submit: run([
        when(({ signals }) => signals.canSubmit),
        set("loading", true)
      ])
    }
  });

  assert.equal(checkout.submit(), undefined);
  assert.equal(checkout.signals.loading, false);
});

test("onError maps sync throws and async rejections to signal updates", async () => {
  const checkout = flow({
    signals: {
      error: null
    },
    on: {
      sync: onError(
        (error) => ({ error: error.message }),
        () => {
          throw new Error("sync failed");
        }
      ),
      asyncFailure: onError(
        (error) => ({ error: error.message }),
        async () => {
          throw new Error("async failed");
        }
      )
    }
  });

  checkout.sync();
  assert.equal(checkout.signals.error, "sync failed");

  await checkout.asyncFailure();
  assert.equal(checkout.signals.error, "async failed");
});

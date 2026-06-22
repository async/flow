import assert from "node:assert/strict";
import test from "node:test";
import { flow, onError, set, update, when } from "@async/flow";
import { compose } from "@async/flow/compose";

test("set and update helpers write through Flow store values", () => {
  const counter = flow({
    store: {
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

  assert.equal(counter.store.loading, true);
  assert.equal(counter.store.count, 1);
});

test("compose helpers can be used as a normal Flow handler function", async () => {
  const checkout = flow({
    store: {
      loading: false,
      canSubmit: true,
      orderId: null
    },
    on: {
      submit: compose([
        when((store) => store.canSubmit),
        set("loading", true),
        async (_store, input) => ({
          loading: false,
          orderId: input.orderId
        })
      ])
    }
  });

  const result = checkout.submit({ orderId: "ord_123" });

  assert.equal(checkout.store.loading, true);
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
    store: {
      canSubmit: false,
      loading: false
    },
    on: {
      submit: compose([
        when((store) => store.canSubmit),
        set("loading", true)
      ])
    }
  });

  assert.equal(checkout.submit(), undefined);
  assert.equal(checkout.store.loading, false);
});

test("onError maps sync throws and async rejections to store updates", async () => {
  const checkout = flow({
    store: {
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
  assert.equal(checkout.store.error, "sync failed");

  await checkout.asyncFailure();
  assert.equal(checkout.store.error, "async failed");
});

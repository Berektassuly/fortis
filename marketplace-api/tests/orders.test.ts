import test from "node:test";
import assert from "node:assert/strict";

import {
  applyFortisWebhookUpdate,
  mapFortisTransferToOrderUpdate,
  mergeOrderStatusUpdate,
  persistOrderStatusUpdate,
} from "../lib/services/order-updates.ts";

type OrderRecord = {
  error_message: string | null;
  fortis_request_id: string | null;
  id: number;
  listing_id: number | null;
  status: "Created" | "Pending" | "Processing" | "Success" | "Failed" | null;
  tx_hash: string | null;
  user_id: string | null;
};

type Filters = {
  eq: Array<{ column: string; value: string | number }>;
  in: Array<{ column: string; values: string[] }>;
};

function cloneOrder(order: OrderRecord | null) {
  return order ? { ...order } : null;
}

function matchesFilters(order: OrderRecord, filters: Filters) {
  const matchesEq = filters.eq.every(({ column, value }) => {
    const key = column as keyof OrderRecord;
    return order[key] === value;
  });
  const matchesIn = filters.in.every(({ column, values }) => {
    const key = column as keyof OrderRecord;
    return values.includes(String(order[key]));
  });
  return matchesEq && matchesIn;
}

function createFakeSupabase(initialOrders: OrderRecord[]) {
  const state = {
    filters: [] as Filters[],
    orders: initialOrders.map((order) => ({ ...order })),
  };

  class FakeQuery {
    private filters: Filters = { eq: [], in: [] };
    private updatePayload:
      | {
          error_message: string | null;
          status: OrderRecord["status"];
          tx_hash: string | null;
        }
      | null = null;

    eq(column: string, value: string | number) {
      this.filters.eq.push({ column, value });
      return this;
    }

    in(column: string, values: string[]) {
      this.filters.in.push({ column, values });
      return this;
    }

    select(_selection: string) {
      return this;
    }

    update(payload: {
      error_message: string | null;
      status: OrderRecord["status"];
      tx_hash: string | null;
    }) {
      this.updatePayload = payload;
      return this;
    }

    async maybeSingle() {
      state.filters.push({
        eq: [...this.filters.eq],
        in: [...this.filters.in],
      });

      const order = state.orders.find((candidate) => matchesFilters(candidate, this.filters)) ?? null;

      if (!this.updatePayload) {
        return { data: cloneOrder(order), error: null };
      }

      if (!order) {
        return { data: null, error: null };
      }

      order.error_message = this.updatePayload.error_message;
      order.status = this.updatePayload.status;
      order.tx_hash = this.updatePayload.tx_hash;

      return { data: cloneOrder(order), error: null };
    }
  }

  return {
    state,
    from(table: string) {
      assert.equal(table, "orders");
      return new FakeQuery();
    },
  };
}

function createOrder(overrides: Partial<OrderRecord> = {}): OrderRecord {
  return {
    error_message: null,
    fortis_request_id: "fortis-123",
    id: 1,
    listing_id: 2,
    status: "Processing",
    tx_hash: null,
    user_id: "F5ySAQT2fWfzxUP9GuhzywSvxtZ2CZHEUjQ3jsWvzrVM",
    ...overrides,
  };
}

test("pending_submission/submitted transition to confirmed persists Success with txHash", async () => {
  const order = createOrder();
  const supabase = createFakeSupabase([order]);
  const updated = await persistOrderStatusUpdate(
    supabase as never,
    order as never,
    mapFortisTransferToOrderUpdate({
      blockchain_last_error: null,
      blockchain_signature: "tx-confirmed",
      blockchain_status: "confirmed",
      compliance_status: "approved",
      id: "fortis-123",
    }),
    "id,listing_id,user_id,status,tx_hash,fortis_request_id,error_message",
  );

  assert.equal(updated.status, "Success");
  assert.equal(updated.tx_hash, "tx-confirmed");
  assert.equal(supabase.state.orders[0]?.status, "Success");
});

test("submitted transition to failed persists Failed state", async () => {
  const order = createOrder();
  const supabase = createFakeSupabase([order]);
  const updated = await persistOrderStatusUpdate(
    supabase as never,
    order as never,
    mapFortisTransferToOrderUpdate({
      blockchain_last_error: "simulation failed",
      blockchain_signature: "tx-failed",
      blockchain_status: "failed",
      compliance_status: "approved",
      id: "fortis-123",
    }),
    "id,listing_id,user_id,status,tx_hash,fortis_request_id,error_message",
  );

  assert.equal(updated.status, "Failed");
  assert.equal(updated.tx_hash, "tx-failed");
  assert.equal(updated.error_message, "simulation failed");
});

test("webhook path looks up and updates orders by fortisRequestId", async () => {
  const supabase = createFakeSupabase([createOrder()]);
  const updated = await applyFortisWebhookUpdate(
    supabase as never,
    {
      blockchain_signature: "webhook-tx",
      blockchain_status: "confirmed",
      fortisRequestId: "fortis-123",
    },
    "id,listing_id,user_id,status,tx_hash,fortis_request_id,error_message",
  );

  assert.equal(updated.status, "Success");
  assert.equal(updated.txHash, "webhook-tx");
  assert.deepEqual(supabase.state.filters[0]?.eq, [
    { column: "fortis_request_id", value: "fortis-123" },
  ]);
});

test("late non-terminal refresh does not regress a terminal order", async () => {
  const staleView = createOrder();
  const persistedTerminal = createOrder({
    status: "Success",
    tx_hash: "terminal-hash",
  });
  const supabase = createFakeSupabase([persistedTerminal]);
  const updated = await persistOrderStatusUpdate(
    supabase as never,
    staleView as never,
    mergeOrderStatusUpdate(staleView, {
      errorMessage: null,
      status: "Processing",
      txHash: null,
    }),
    "id,listing_id,user_id,status,tx_hash,fortis_request_id,error_message",
  );

  assert.equal(updated.status, "Success");
  assert.equal(updated.tx_hash, "terminal-hash");
});

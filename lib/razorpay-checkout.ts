"use client";

/**
 * Razorpay Standard Checkout, browser side.
 *
 * The page never decides an amount: it asks the Worker for an order
 * (`createPaymentOrder`), opens Checkout on that order, and hands the signed
 * result back to the Worker to verify (`verifyPayment`). Checkout's own
 * `handler` is a convenience — the Worker also settles from Razorpay's webhook,
 * so a closed tab does not lose a payment.
 */
import { trackPaymentCompleted } from "./analytics";
import { createPaymentOrder, verifyPayment, type CheckoutOrder } from "./auth-client";

const SCRIPT_SRC = "https://checkout.razorpay.com/v1/checkout.js";

type RazorpaySuccess = { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string };

type RazorpayOptions = {
  key: string;
  order_id: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  prefill: { name: string; email: string; contact: string };
  theme: { color: string };
  modal: { ondismiss: () => void; confirm_close: boolean };
  handler: (response: RazorpaySuccess) => void;
};

type RazorpayInstance = {
  open(): void;
  on(event: "payment.failed", cb: (response: { error?: { description?: string } }) => void): void;
};

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayOptions) => RazorpayInstance;
  }
}

let scriptPromise: Promise<void> | null = null;

/** Loads checkout.js once; a failed load is retried on the next call. */
function loadCheckoutScript(): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("No window."));
  if (window.Razorpay) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<void>((resolve, reject) => {
    const el = document.createElement("script");
    el.src = SCRIPT_SRC;
    el.async = true;
    el.onload = () => resolve();
    el.onerror = () => {
      scriptPromise = null;
      el.remove();
      reject(new Error("Could not load the payment window."));
    };
    document.head.appendChild(el);
  });
  return scriptPromise;
}

export type PayOutcome =
  | { kind: "paid"; paidInr: number }
  | { kind: "dismissed" }
  | { kind: "failed"; message: string };

/**
 * Runs one payment end to end for a request. Resolves — never rejects — with
 * what happened, so the caller can just render the outcome.
 */
export async function payForRequest(requestId: string): Promise<PayOutcome> {
  const order = await createPaymentOrder(requestId);
  if (!order.ok) return { kind: "failed", message: order.error };

  try {
    await loadCheckoutScript();
  } catch (error) {
    return { kind: "failed", message: error instanceof Error ? error.message : "Could not load the payment window." };
  }
  const Razorpay = window.Razorpay;
  if (!Razorpay) return { kind: "failed", message: "Could not load the payment window." };

  return new Promise<PayOutcome>((resolve) => {
    const o: CheckoutOrder = order.data;
    const checkout = new Razorpay({
      key: o.keyId,
      order_id: o.orderId,
      amount: o.amountPaise,
      currency: o.currency,
      name: "Retro Holidays",
      description: o.description,
      prefill: o.prefill,
      theme: { color: "#c9a24a" },
      modal: { confirm_close: true, ondismiss: () => resolve({ kind: "dismissed" }) },
      handler: async (response) => {
        const verified = await verifyPayment(requestId, response);
        if (verified.ok) {
          trackPaymentCompleted(requestId, verified.data.paidInr);
          resolve({ kind: "paid", paidInr: verified.data.paidInr });
        }
        else resolve({ kind: "failed", message: verified.error });
      },
    });
    checkout.on("payment.failed", (r) => {
      // Checkout keeps its window open for a retry, so this is informational;
      // the outcome is only resolved by success or by the traveller closing it.
      console.warn("Razorpay payment attempt failed", r.error?.description);
    });
    checkout.open();
  });
}

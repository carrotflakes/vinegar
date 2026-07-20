import { create } from "zustand";

// App-wide transient notifications ("toasts"). Kept in a standalone Zustand
// store — like `uiStore` — so that non-React code (IO helpers, the command
// registry) can raise a toast without threading callbacks through React.
//
// Use the `notify` helpers for the common cases; `useToasts` is for the
// rendering container and manual dismissal.

export type ToastKind = "error" | "success" | "info";

export interface Toast {
  id: string;
  kind: ToastKind;
  message: string;
}

/** Default lifetime per kind (ms). Errors linger until dismissed by hand. */
const DEFAULT_TIMEOUT: Record<ToastKind, number | null> = {
  error: null,
  success: 4000,
  info: 5000,
};

interface ToastState {
  toasts: Toast[];
  /** Add a toast; returns its id. Auto-dismisses unless timeout is null. */
  push: (kind: ToastKind, message: string, timeout?: number | null) => string;
  dismiss: (id: string) => void;
}

let seq = 0;

export const useToasts = create<ToastState>((set, get) => ({
  toasts: [],
  push: (kind, message, timeout) => {
    const id = `toast-${++seq}`;
    set((s) => ({ toasts: [...s.toasts, { id, kind, message }] }));
    const ms = timeout === undefined ? DEFAULT_TIMEOUT[kind] : timeout;
    if (ms != null) {
      window.setTimeout(() => get().dismiss(id), ms);
    }
    return id;
  },
  dismiss: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

/** Convenience entry points callable from anywhere, React or not. */
export const notify = {
  error: (message: string, timeout?: number | null) =>
    useToasts.getState().push("error", message, timeout),
  success: (message: string, timeout?: number | null) =>
    useToasts.getState().push("success", message, timeout),
  info: (message: string, timeout?: number | null) =>
    useToasts.getState().push("info", message, timeout),
};

/** Report a completed conversion that could not carry node effects forward. */
export const notifyEffectsRemoved = () =>
  notify.info("Some effects were removed by this operation.");

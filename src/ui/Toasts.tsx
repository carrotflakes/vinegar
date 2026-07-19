import { LuCircleAlert, LuCircleCheck, LuInfo, LuX } from "react-icons/lu";
import { useToasts, type ToastKind } from "../store/toastStore";
import * as css from "./Toasts.css";

const ICONS: Record<ToastKind, typeof LuInfo> = {
  error: LuCircleAlert,
  success: LuCircleCheck,
  info: LuInfo,
};

/** Renders the live toast stack. Mount once near the app root. */
export default function Toasts() {
  const toasts = useToasts((s) => s.toasts);
  const dismiss = useToasts((s) => s.dismiss);
  if (toasts.length === 0) return null;

  return (
    <div className={css.stack} role="region" aria-label="Notifications">
      {toasts.map((t) => {
        const Icon = ICONS[t.kind];
        return (
          <div
            key={t.id}
            className={css.toast({ kind: t.kind })}
            role={t.kind === "error" ? "alert" : "status"}
          >
            <Icon className={css.icon({ kind: t.kind })} aria-hidden size={16} />
            <span className={css.message}>{t.message}</span>
            <button
              className={css.close}
              onClick={() => dismiss(t.id)}
              title="Dismiss"
              aria-label="Dismiss"
            >
              <LuX aria-hidden size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

import { create } from "zustand";

export type RecoveryPhase =
  | "ready"
  | "saving"
  | "saved"
  | "recovered"
  | "error";

export interface RecoveryStatus {
  phase: RecoveryPhase;
  at?: string;
  error?: string;
}

interface RecoveryStatusState {
  status: RecoveryStatus;
}

export const useRecoveryStatus = create<RecoveryStatusState>(() => ({
  status: { phase: "ready" },
}));

export function setRecoveryStatus(status: RecoveryStatus): void {
  useRecoveryStatus.setState({ status });
}

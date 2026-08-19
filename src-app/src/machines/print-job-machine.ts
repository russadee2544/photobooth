import { PrintJobState } from '@/types';

/**
 * Defines the canonical allowed state transitions for a Print Job.
 * 
 * Rules:
 * - retry_wait can go back to preflight ONLY when proven bytes weren't dispatched
 * - ambiguous_needs_admin has NO automatic outgoing transition
 */
export const PRINT_JOB_TRANSITIONS: Record<PrintJobState, PrintJobState[]> = {
  [PrintJobState.Queued]: [
    PrintJobState.Preflight,
    PrintJobState.Cancelled,
  ],
  [PrintJobState.Preflight]: [
    PrintJobState.PrintingCopy1,
    PrintJobState.Blocked,
    PrintJobState.AmbiguousNeedsAdmin,
    PrintJobState.Cancelled,
  ],
  [PrintJobState.PrintingCopy1]: [
    PrintJobState.Cutting1,
    PrintJobState.Blocked,
    PrintJobState.RetryWait,
    PrintJobState.AmbiguousNeedsAdmin,
    PrintJobState.Cancelled,
  ],
  [PrintJobState.Cutting1]: [
    PrintJobState.PrintingCopy2,
    PrintJobState.Completed, // Might complete here if only 1 copy is needed
    PrintJobState.Blocked,
    PrintJobState.RetryWait,
    PrintJobState.AmbiguousNeedsAdmin,
    PrintJobState.Cancelled,
  ],
  [PrintJobState.PrintingCopy2]: [
    PrintJobState.Cutting2,
    PrintJobState.Blocked,
    PrintJobState.RetryWait,
    PrintJobState.AmbiguousNeedsAdmin,
    PrintJobState.Cancelled,
  ],
  [PrintJobState.Cutting2]: [
    PrintJobState.Completed,
    PrintJobState.Blocked,
    PrintJobState.RetryWait,
    PrintJobState.AmbiguousNeedsAdmin,
    PrintJobState.Cancelled,
  ],
  [PrintJobState.Completed]: [],
  [PrintJobState.Blocked]: [
    PrintJobState.Preflight,
    PrintJobState.Cancelled,
  ],
  [PrintJobState.RetryWait]: [
    PrintJobState.Preflight,
    PrintJobState.Cancelled,
  ],
  [PrintJobState.AmbiguousNeedsAdmin]: [
    PrintJobState.Preflight,
    PrintJobState.Completed,
    PrintJobState.Cancelled,
  ],
  [PrintJobState.Cancelled]: [],
};

/**
 * Checks if a print job state is a terminal state.
 * @param state - The state to check
 * @returns true if the state has no outgoing transitions
 */
export function isPrintJobTerminal(state: PrintJobState): boolean {
  return PRINT_JOB_TRANSITIONS[state].length === 0;
}

/**
 * Checks if a transition from the current state to the target state is allowed.
 * @param current - The current print job state
 * @param target - The desired target state
 * @returns true if the transition is defined in the canonical map
 */
export function canTransitionPrintJob(current: PrintJobState, target: PrintJobState): boolean {
  return PRINT_JOB_TRANSITIONS[current].includes(target);
}

/**
 * Gets all available transitions from the current state.
 * @param state - The current print job state
 * @returns An array of allowed target states
 */
export function getAvailablePrintJobTransitions(state: PrintJobState): PrintJobState[] {
  return PRINT_JOB_TRANSITIONS[state] || [];
}

/**
 * Executes a state transition, throwing an error if invalid.
 * @param current - The current print job state
 * @param target - The desired target state
 * @returns The new state if valid
 * @throws Error if the transition is not allowed
 */
export function transitionPrintJob(current: PrintJobState, target: PrintJobState): PrintJobState {
  if (!canTransitionPrintJob(current, target)) {
    throw new Error(`Invalid print job transition: ${current} -> ${target}`);
  }
  return target;
}

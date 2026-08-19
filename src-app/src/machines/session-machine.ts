import { SessionState } from '@/types';

/**
 * Defines the canonical allowed state transitions for a Session.
 * 
 * Rules:
 * - Event free: skips redeem, goes directly to authorized
 * - Paid redeem: created → authorized after atomic claim
 * - Inactivity: any non-terminal → timed_out after 2min + 30s warning
 */
export const SESSION_TRANSITIONS: Record<SessionState, SessionState[]> = {
  [SessionState.Created]: [
    SessionState.Authorized,
    SessionState.Cancelled,
    SessionState.TimedOut,
    SessionState.Failed,
    SessionState.Abandoned,
  ],
  [SessionState.Authorized]: [
    SessionState.Selecting,
    SessionState.Cancelled,
    SessionState.TimedOut,
    SessionState.Failed,
    SessionState.Abandoned,
  ],
  [SessionState.Selecting]: [
    SessionState.Capturing,
    SessionState.Cancelled,
    SessionState.TimedOut,
    SessionState.Failed,
    SessionState.Abandoned,
  ],
  [SessionState.Capturing]: [
    SessionState.Composing,
    SessionState.Cancelled,
    SessionState.TimedOut,
    SessionState.Failed,
    SessionState.Abandoned,
  ],
  [SessionState.Composing]: [
    SessionState.PrintQueued,
    SessionState.Cancelled,
    SessionState.TimedOut,
    SessionState.Failed,
    SessionState.Abandoned,
  ],
  [SessionState.PrintQueued]: [
    SessionState.Completed,
    SessionState.Failed,
    SessionState.TimedOut,
  ],
  [SessionState.Completed]: [],
  [SessionState.Cancelled]: [],
  [SessionState.TimedOut]: [],
  [SessionState.Failed]: [],
  [SessionState.Abandoned]: [],
};

/**
 * Checks if a session state is a terminal state.
 * @param state - The state to check
 * @returns true if the state has no outgoing transitions
 */
export function isSessionTerminal(state: SessionState): boolean {
  return SESSION_TRANSITIONS[state].length === 0;
}

/**
 * Checks if a transition from the current state to the target state is allowed.
 * @param current - The current session state
 * @param target - The desired target state
 * @returns true if the transition is defined in the canonical map
 */
export function canTransitionSession(current: SessionState, target: SessionState): boolean {
  return SESSION_TRANSITIONS[current].includes(target);
}

/**
 * Gets all available transitions from the current state.
 * @param state - The current session state
 * @returns An array of allowed target states
 */
export function getAvailableSessionTransitions(state: SessionState): SessionState[] {
  return SESSION_TRANSITIONS[state] || [];
}

/**
 * Executes a state transition, throwing an error if invalid.
 * @param current - The current session state
 * @param target - The desired target state
 * @returns The new state if valid
 * @throws Error if the transition is not allowed
 */
export function transitionSession(current: SessionState, target: SessionState): SessionState {
  if (!canTransitionSession(current, target)) {
    throw new Error(`Invalid session transition: ${current} -> ${target}`);
  }
  return target;
}

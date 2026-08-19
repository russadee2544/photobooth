import { EventState } from '@/types';

/**
 * Defines the canonical allowed state transitions for an Event.
 * 
 * Rules:
 * - export_failed → exporting (retry)
 * - closing is irreversible (no going back to open)
 * - closing commits immutable cutoff + admitted session set
 */
export const EVENT_TRANSITIONS: Record<EventState, EventState[]> = {
  [EventState.Draft]: [EventState.Open],
  [EventState.Open]: [EventState.Closing],
  [EventState.Closing]: [EventState.Exporting],
  [EventState.Exporting]: [EventState.Verified, EventState.ExportFailed],
  [EventState.ExportFailed]: [EventState.Exporting], // Retry allowed
  [EventState.Verified]: [EventState.Closed],
  [EventState.Closed]: [],
};

/**
 * Checks if an event state is a terminal state.
 * @param state - The state to check
 * @returns true if the state has no outgoing transitions
 */
export function isEventTerminal(state: EventState): boolean {
  return EVENT_TRANSITIONS[state].length === 0;
}

/**
 * Checks if a transition from the current state to the target state is allowed.
 * @param current - The current event state
 * @param target - The desired target state
 * @returns true if the transition is defined in the canonical map
 */
export function canTransitionEvent(current: EventState, target: EventState): boolean {
  return EVENT_TRANSITIONS[current].includes(target);
}

/**
 * Gets all available transitions from the current state.
 * @param state - The current event state
 * @returns An array of allowed target states
 */
export function getAvailableEventTransitions(state: EventState): EventState[] {
  return EVENT_TRANSITIONS[state] || [];
}

/**
 * Executes a state transition, throwing an error if invalid.
 * @param current - The current event state
 * @param target - The desired target state
 * @returns The new state if valid
 * @throws Error if the transition is not allowed
 */
export function transitionEvent(current: EventState, target: EventState): EventState {
  if (!canTransitionEvent(current, target)) {
    throw new Error(`Invalid event transition: ${current} -> ${target}`);
  }
  return target;
}

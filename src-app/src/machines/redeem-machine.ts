import { RedeemCodeState } from '@/types';

/**
 * Defines the canonical allowed state transitions for a Redeem Code.
 * 
 * Rules:
 * - created → active when voucher print intent is created (before dispatch)
 * - active → claimed when atomic claim creates authorized session
 * - active|claimed → replaced when Admin issues replacement
 */
export const REDEEM_TRANSITIONS: Record<RedeemCodeState, RedeemCodeState[]> = {
  [RedeemCodeState.Created]: [
    RedeemCodeState.Active,
    RedeemCodeState.Revoked,
  ],
  [RedeemCodeState.Active]: [
    RedeemCodeState.Claimed,
    RedeemCodeState.Expired,
    RedeemCodeState.Revoked,
    RedeemCodeState.Replaced,
  ],
  [RedeemCodeState.Claimed]: [
    RedeemCodeState.Replaced,
  ],
  [RedeemCodeState.Expired]: [],
  [RedeemCodeState.Revoked]: [],
  [RedeemCodeState.Replaced]: [],
};

/**
 * Checks if a redeem code state is a terminal state.
 * @param state - The state to check
 * @returns true if the state has no outgoing transitions
 */
export function isRedeemCodeTerminal(state: RedeemCodeState): boolean {
  return REDEEM_TRANSITIONS[state].length === 0;
}

/**
 * Checks if a transition from the current state to the target state is allowed.
 * @param current - The current redeem code state
 * @param target - The desired target state
 * @returns true if the transition is defined in the canonical map
 */
export function canTransitionRedeemCode(current: RedeemCodeState, target: RedeemCodeState): boolean {
  return REDEEM_TRANSITIONS[current].includes(target);
}

/**
 * Gets all available transitions from the current state.
 * @param state - The current redeem code state
 * @returns An array of allowed target states
 */
export function getAvailableRedeemCodeTransitions(state: RedeemCodeState): RedeemCodeState[] {
  return REDEEM_TRANSITIONS[state] || [];
}

/**
 * Executes a state transition, throwing an error if invalid.
 * @param current - The current redeem code state
 * @param target - The desired target state
 * @returns The new state if valid
 * @throws Error if the transition is not allowed
 */
export function transitionRedeemCode(current: RedeemCodeState, target: RedeemCodeState): RedeemCodeState {
  if (!canTransitionRedeemCode(current, target)) {
    throw new Error(`Invalid redeem code transition: ${current} -> ${target}`);
  }
  return target;
}

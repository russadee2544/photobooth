import { AssetState } from '@/types';

/**
 * Defines the canonical allowed state transitions for an Asset.
 * 
 * Rules:
 * - Event export branch: uploaded → export_queued → exported_verified → delete_pending
 */
export const ASSET_TRANSITIONS: Record<AssetState, AssetState[]> = {
  [AssetState.LocalPending]: [
    AssetState.UploadQueued,
    AssetState.RetryWait,
    AssetState.DeadLetter,
  ],
  [AssetState.UploadQueued]: [
    AssetState.Uploaded,
    AssetState.RetryWait,
    AssetState.DeadLetter,
  ],
  [AssetState.Uploaded]: [
    AssetState.DeletePending,
    AssetState.ExportQueued, // Event export branch
  ],
  [AssetState.ExportQueued]: [
    AssetState.ExportedVerified,
    AssetState.RetryWait,
    AssetState.DeadLetter,
  ],
  [AssetState.ExportedVerified]: [
    AssetState.DeletePending,
  ],
  [AssetState.DeletePending]: [
    AssetState.DeletedVerified,
    AssetState.RetryWait,
    AssetState.DeadLetter,
  ],
  [AssetState.DeletedVerified]: [],
  [AssetState.RetryWait]: [
    AssetState.UploadQueued,
    AssetState.ExportQueued,
    AssetState.DeletePending,
  ],
  [AssetState.DeadLetter]: [],
};

/**
 * Checks if an asset state is a terminal state.
 * @param state - The state to check
 * @returns true if the state has no outgoing transitions
 */
export function isAssetTerminal(state: AssetState): boolean {
  return ASSET_TRANSITIONS[state].length === 0;
}

/**
 * Checks if a transition from the current state to the target state is allowed.
 * @param current - The current asset state
 * @param target - The desired target state
 * @returns true if the transition is defined in the canonical map
 */
export function canTransitionAsset(current: AssetState, target: AssetState): boolean {
  return ASSET_TRANSITIONS[current].includes(target);
}

/**
 * Gets all available transitions from the current state.
 * @param state - The current asset state
 * @returns An array of allowed target states
 */
export function getAvailableAssetTransitions(state: AssetState): AssetState[] {
  return ASSET_TRANSITIONS[state] || [];
}

/**
 * Executes a state transition, throwing an error if invalid.
 * @param current - The current asset state
 * @param target - The desired target state
 * @returns The new state if valid
 * @throws Error if the transition is not allowed
 */
export function transitionAsset(current: AssetState, target: AssetState): AssetState {
  if (!canTransitionAsset(current, target)) {
    throw new Error(`Invalid asset transition: ${current} -> ${target}`);
  }
  return target;
}

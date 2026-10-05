// "I am alive" signal for the owner dashboard: one POST per minute with the kiosk's state.
// A failed beat is simply retried at the next tick; it never affects the kiosk itself.
export function createHeartbeat({ send, snapshot, intervalMs = 60_000, log = () => {} }) {
  let timer = null;
  let inFlight = false;

  async function beat() {
    if (inFlight) return false;
    inFlight = true;
    try {
      const reply = await send(await snapshot());
      if (reply?.error) throw new Error(reply.error);
      return true;
    } catch (error) {
      log(`heartbeat failed: ${error instanceof Error ? error.message : error}`);
      return false;
    } finally {
      inFlight = false;
    }
  }

  return {
    beat,
    start() {
      void beat();
      timer = setInterval(() => { void beat(); }, intervalMs);
      timer.unref?.();
      return timer;
    },
    stop() { clearInterval(timer); timer = null; },
  };
}

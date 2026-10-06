/**
 * Policy: a machine is silent once its trierarch's last seen is older than
 * the threshold (docs/trierarch.md, "Assignment"). A trierarch no session
 * crews has no last seen and is never silent. Nothing moves because of it.
 */
export function isSilent(lastSeenAt: Date | null, at: { now: Date; silentAfterMs: number }): boolean {
  return lastSeenAt !== null && at.now.getTime() - lastSeenAt.getTime() > at.silentAfterMs;
}

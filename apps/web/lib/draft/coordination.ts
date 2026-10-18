import type { Coordinator } from "./types";

export function createCoordinator(
  ownerId: string,
  portfolioId: string,
  onRevision: (revision: number) => void = () => {},
  onAttempt: (id: string | null) => void = () => {},
): Coordinator {
  const name = `hasaweb-draft:${ownerId}:${portfolioId}`;
  const channel =
    typeof window === "undefined" || typeof BroadcastChannel === "undefined"
      ? null
      : new BroadcastChannel(name);
  let closed = false;
  if (channel)
    channel.onmessage = ({ data }) => {
      if (data?.type === "revision" && Number.isSafeInteger(data.revision))
        onRevision(data.revision);
      if (
        data?.type === "attempt" &&
        (data.id === null || typeof data.id === "string")
      )
        onAttempt(data.id);
    };
  return {
    exclusive: typeof navigator !== "undefined" && Boolean(navigator.locks),
    async run(work) {
      return typeof navigator !== "undefined" && navigator.locks
        ? navigator.locks.request(name, work)
        : work();
    },
    publish(revision) {
      if (!closed) channel?.postMessage({ type: "revision", revision });
    },
    publishAttempt(id) {
      if (!closed) channel?.postMessage({ type: "attempt", id });
    },
    close() {
      closed = true;
      channel?.close();
    },
  };
}

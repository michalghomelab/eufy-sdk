import { describe, it, expect, vi } from "vitest";
import { P2PCommandRouter, type P2PRouterDeps } from "../command-router.js";
import { connectedSession, type FakeP2PSession } from "./session-fixtures.js";

/**
 * A hard-required level-2 wait (`waitLevel2: true`) used to charge every caller the SAME 25s call
 * grace, plus a reprompt's second 25s, regardless of topology — including an own-session device that
 * (per `setPayload`'s own doc, and `attached-media-requires-level2.spec.ts`'s own-session/attached
 * split) is never GUARANTEED a level-2 key the way a HomeBase-attached one effectively is. A
 * `"direct-binary"` scalar write (motion detection, audio recording, …) is exactly such a caller, and
 * on a standalone camera the 50s worst case blocked this session's whole command queue — everything
 * else waiting on the same session — for the full stall before failing anyway.
 *
 * Fixed by giving an own-session device the shorter `"settle"` budget (8s, one shot, no reprompt)
 * instead: still a real chance for the key, just not the double-25s a device that was never going to
 * get one cannot be rewarded for waiting through.
 */
const SN = "T8410P0000000000"; // own-session: stationSn === sn, no parent_sn
const ACCOUNT_ID = "0000000000000000000000000000000000000000";

function router(session: FakeP2PSession, opts: { attached: boolean }) {
  const parentSn = opts.attached ? "T8010P0000000000" : SN;
  const deps: P2PRouterDeps = {
    mega: {} as P2PRouterDeps["mega"],
    listDevices: () => [
      {
        sn: SN,
        stationSn: parentSn,
        raw: opts.attached
          ? { parent_sn: parentSn, device_channel: 0, member: { admin_user_id: ACCOUNT_ID } }
          : { device_channel: 0, member: { admin_user_id: ACCOUNT_ID } },
      } as never,
    ],
    ensureDevices: async () => {},
    onConnect: () => {},
    onClose: () => {},
    onError: () => {},
    onLevel2Ready: () => {},
    onFrame: () => {},
  };
  const r = new P2PCommandRouter(deps);
  (r as unknown as { manager: { register(sn: string, v: unknown): void } }).manager.register(parentSn, session);
  return r;
}

async function dispatchScalar(r: P2PCommandRouter): Promise<unknown> {
  return r.dispatchCommand(SN, { kind: "set-param", param: 1011, value: 1, form: "direct-binary", channel: 0 });
}

describe("resolveSession — hard-required level-2 wait budget by topology", () => {
  it("gives an own-session device only the settle grace, no reprompt, when no key ever comes", async () => {
    const session = connectedSession(false);
    session.repromptLevel2Key = vi.fn(() => false);
    await expect(dispatchScalar(router(session, { attached: false }))).rejects.toThrow(/own-session device/);

    expect(session.awaitLevel2Key).toHaveBeenCalledTimes(1);
    expect(session.awaitLevel2Key).toHaveBeenCalledWith(8_000, "session");
    expect(session.repromptLevel2Key).not.toHaveBeenCalled();
  });

  it("still succeeds on an own-session device whose key is already there", async () => {
    const session = connectedSession(true) as FakeP2PSession & { sendRawLevel2Bytes: ReturnType<typeof vi.fn> };
    session.sendRawLevel2Bytes = vi.fn(() => true);
    await expect(dispatchScalar(router(session, { attached: false }))).resolves.toBeUndefined();
    expect(session.sendRawLevel2Bytes).toHaveBeenCalled();
  });

  it("leaves an attached device's full grace + reprompt unchanged", async () => {
    const session = connectedSession(false);
    session.repromptLevel2Key = vi.fn(() => false);
    await expect(dispatchScalar(router(session, { attached: true }))).rejects.toThrow(
      "level-2 key not ready for T8010P0000000000",
    );

    expect(session.awaitLevel2Key).toHaveBeenCalledTimes(1);
    expect(session.awaitLevel2Key).toHaveBeenCalledWith(25_000, "call");
    expect(session.repromptLevel2Key).toHaveBeenCalledTimes(1);
  });
});

import { describe, expect, it, vi } from "vitest";
import { EufyMega } from "../eufy-mega.js";

/**
 * `getDevice()` needs one live record both to construct the model and to bind its command context.
 * A regression here doubles `get_device_param_list` traffic for every device in every host refresh.
 */
describe("getDevice record reuse", () => {
  it("uses one registry record for the model and its command context", async () => {
    const eufy = new EufyMega({ email: "t@example.com", password: "x" });
    const registry = (eufy as any).registry;
    const sn = "T8410P0000000000";
    const record = {
      deviceType: 30,
      model: "T8410",
      category: "eufy_security",
      params: { 6040: "0" },
      paramUpdatedAt: {},
    };
    const rawDevice = {
      sn,
      category: "eufy_security",
      realtime: "p2p",
      raw: { device_type: 30, device_channel: 0, p2p_did: "DID-XYZ" },
    };

    const fetchRecord = vi.spyOn(registry, "record").mockResolvedValue(record);
    vi.spyOn(registry, "require").mockReturnValue(rawDevice);
    vi.spyOn(eufy as any, "awaitFirstRealtimeState").mockResolvedValue(undefined);
    vi.spyOn(eufy as any, "commandSinkFor").mockReturnValue({ dispatch: async () => undefined });
    vi.spyOn(eufy as any, "mediaProviderFor").mockReturnValue(undefined);
    vi.spyOn(eufy as any, "ff09SettingsReaderFor").mockReturnValue(undefined);

    const device = await eufy.getDevice(sn);

    expect(device.sn).toBe(sn);
    expect(fetchRecord).toHaveBeenCalledTimes(1);
  });
});

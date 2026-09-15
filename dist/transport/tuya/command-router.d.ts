/**
 * `TuyaCommandRouter` — the transport-side command router for eufy Home/Clean Tuya vacuums (X8,
 * G-series and other `eufy_home_tuya` category devices).
 *
 * Usage: call {@link bind} after a successful mega login, then {@link registerDevice} for each
 * `eufy_home_tuya` device (the facade does both). On the first {@link dispatchCommand} the router
 * logs into the Tuya cloud lazily (once, shared across all subsequent sends). The dp.publish write
 * is sent via `TuyaClient.publishDps` — note the `dp.publish` param shape is not yet confirmed from
 * a live eufy Home/Clean capture (gated by {@link TuyaCommandRouterConfig.allowUnverified}, default `false`).
 *
 * Layering: imports `../../core` only — no `model/` import, consistent with the capability↔transport
 * decorrelation invariant. Sibling tuya/* imports are same-layer (transport).
 */
import type { Command } from "../../core/contracts.js";
import type { TuyaHttpPost } from "./request.js";
export interface TuyaCommandRouterConfig {
    /**
     * Opt-in to unverified Tuya DP writes. Defaults to `false` — {@link dispatchCommand} will throw
     * until a live `publishDps` capture confirms the dp.publish round-trip. Set `true` only after that
     * confirmation and remove the gate when the write is shipped as verified.
     */
    allowUnverified?: boolean;
    /** Inject a POST transport (test stub); default = native fetch. Forwarded to the internal TuyaClient. */
    http?: TuyaHttpPost;
}
export declare class TuyaCommandRouter {
    private readonly allowUnverified;
    private readonly http;
    private userId;
    private dialCode;
    private client;
    /** Promise that resolves once Tuya login has completed. Reset by {@link bind}. */
    private loginOnce;
    /**
     * eufy SN → Tuya device ids, populated by the facade via {@link registerDevice}.
     * The facade extracts the Tuya id from the `raw` device record fields (`tuya_uuid`,
     * `tuya_virtual_id`, `tuya_device_id`, `virtualId`) and registers it once the device list loads.
     */
    private readonly snMap;
    constructor(config?: TuyaCommandRouterConfig);
    /**
     * Supply credentials for lazy Tuya login. Called by the facade after a successful mega login.
     * The router logs into Tuya on the first {@link dispatchCommand}, not immediately.
     *
     * `regionShard` is the mega shard string (`"eu-pr"`, `"us-pr"`, …) used as a coarse fallback;
     * `isoCode` is the ISO 3166-1 alpha-2 country code from {@link MegaClientConfig} (e.g. `"DE"`)
     * and takes precedence — a German user on the EU shard gets dial code `"49"`, not `"44"`.
     */
    bind(userId: string, regionShard?: string, isoCode?: string): void;
    /**
     * Register a eufy SN → Tuya devId mapping. Called by the facade for each `eufy_home_tuya`
     * device after the cloud device list loads. The facade extracts the Tuya id from the device's
     * raw record (`tuya_uuid` / `tuya_virtual_id` / `tuya_device_id` / `virtualId` fields).
     * `gwId` defaults to `devId` — standalone devices share the two.
     */
    registerDevice(sn: string, devId: string, gwId?: string): void;
    private ensureLoggedIn;
    /**
     * Fetch a device's cached DPs from the Tuya cloud (`thing.m.device.cache.dp.get`) and deliver
     * the raw DP map to the caller. Used for initial state hydration after MQTT subscribe — gets the
     * last-known state without waiting for the first realtime push.
     *
     * The response shape from `getDeviceDps` is not yet pinned from a live capture. The defensive
     * extraction tries both `result.dps` (a nested map) and bare `result` (a flat map), and returns
     * `null` when neither yields a non-empty record.
     */
    fetchDps(sn: string): Promise<Record<string, unknown> | null>;
    /**
     * Route an `aiot-dp` {@link Command} to the Tuya REST API.
     *
     * Logs in lazily on first call. The eufy SN must have been registered via {@link registerDevice}
     * before dispatch — the facade does this when the device list is loaded.
     *
     * ⚠️ `dp.publish` is unverified — see {@link TuyaCommandRouterConfig.allowUnverified}. By default
     * this throws. Pass `allowUnverified: true` in the router config only after a live capture
     * confirms the full round-trip, then remove the gate.
     */
    dispatchCommand(sn: string, cmd: Command): Promise<void>;
}

import { type Surface } from "./members.js";
import type { CapabilityModule, CommandContext } from "./types.js";
import type { Command } from "../../core/contracts.js";
/**
 * The guard modes {@link ArmingActions} can SET — the three whose write was captured byte-exact against a
 * real station. `ArmingMode` is both the const value-object (`ArmingMode.home`) and the union type of its
 * values, so callers pass the named constant: `setMode(ArmingMode.home)`.
 *
 * Deliberately NARROWER than the set a device may report. The other six modes are ones the app itself
 * defines and the `mode` read still names them, but no capture shows one being SENT — and
 * on a fire-and-forget wire a wrong one looks exactly like success. Leaving them out of this union is the
 * compile-time half of the refusal; `mode`'s published argument and the generated rejection are the
 * runtime half.
 */
export declare const ArmingMode: {
    /** Armed — full protection, nobody home (wire value 0). */
    readonly away: "away";
    /** Armed for occupancy — reduced/perimeter protection while home (wire value 1). */
    readonly home: "home";
    /** Disarmed — no alarms; sensors still report state (wire value 63). */
    readonly disarmed: "disarmed";
};
export type ArmingMode = (typeof ArmingMode)[keyof typeof ArmingMode];
/**
 * The P2P **feature-command ids** this arming capability drives. Capability-owned wire vocabulary
 * (transport forwards `cmd.param` opaquely; full id→name catalog in the generated
 * `transport/p2p/commands.ts`).
 */
export declare const ARMING_CMD: {
    /**
     * Guard/arming mode (app `GUARD_MODE`). ✅ Wire ENVELOPE verified live on a T8030 (
     * 2026-07-23), cycling Away→Disarmed→Home in the
     * real app: `1350` SET_PAYLOAD, cmd 1224 (SAME id as the read param), mChannel 0, explicit
     * mValue3:0, `payload:{mode_type:<int>, user_name:<string>}`.
     *
     * ⚠️ Only 3 of the 9 modes were exercised in that capture — `mode_type` 0 (away), 63 (disarmed), 1
     * (home), all confirmed byte-exact, and those three are the whole of {@link ArmingMode}. Re-confirmed
     * live 2026-08-05: each reported its own MODE_SWITCH push within ~5s of the write. The remaining six are
     * named by the app but never observed leaving it, so this capability reads them and refuses to send
     * them. See `ARMING_MODE_WIRE` for the per-value breakdown.
     */
    readonly SET_ARMING: 1224;
    /**
     * The per-mode alarm/arm-delay configuration write. ✅ WIRE CAPTURED live on a T8030 (
     * 2026-07-23, both directions): a **bare
     * JSON frame, no `1350`/`1700` envelope** — outer P2P cmd IS `1255` itself, station channel 255,
     * plaintext `{account_id, count_down_alarm:{channel_list,delay_time},
     * count_down_arm:{channel_list,delay_time}, devices:[{action,device_channel}], mode_id,
     * siren_sensor_action:[{action,device_channel}]}`.
     *
     * **Disambiguated from a live-countdown-state echo** (2026-07-23): a full arm→wait-through-exit-
     * delay→disarm cycle produced ZERO traffic on this cmd, while every edit of the app's "Alarm Delay"
     * screen did — so this is a genuine settings WRITE, not a realtime push.
     *
     * **Why `setAlarmDelayConfig` takes the FULL config, not just a duration**: `channelList` identifies
     * WHICH sensor channels get the delay (confirmed: setting 45s on one specific sensor produced
     * `channel_list:[<that sensor's channel>], delay_time:45`) — it is not a simple on/off. The
     * corresponding GET command (`1310`/inner cmd `40003`, sent by the app right before editing) always
     * replied `{count:0,data:null}` in every capture — genuinely empty, not a decrypt failure (confirmed
     * via the same bidirectional decrypt this finding used) — so the app does NOT read the current
     * config this way; how it does is still unknown. Without a working GET, safely PATCHING just one
     * channel in or out of an existing list isn't possible without risking clobbering the rest — so
     * this ships as a caller-supplies-everything write instead of guessing a merge.
     * `devices`/`siren_sensor_action` are even less understood (raw per-device action codes, meaning
     * unconfirmed) and MUST come from a value independently read/captured for the target mode —
     * see `AlarmDelayConfig`'s field docs.
     */
    readonly ALARM_DELAY_CONFIG: 1255;
};
/**
 * Alarm-delay durations the app's OWN picker UI offers — `AlarmDelaySeconds` is both the const
 * value-object (`AlarmDelaySeconds.sec45`) and the union type of its values, so callers pass the
 * named constant: `{delaySeconds: AlarmDelaySeconds.sec45}`.
 *
 * **NOT a wire constraint** — the device itself does NOT validate against this list: a live test sent
 * `50` (off this list) and the app reflected it correctly, no rejection. Typed as a closed set anyway
 * so `setAlarmDelayConfig` callers get the same choices a human editing the same setting in the app
 * would see, rather than an arbitrary int that could silently diverge from every value the real UI
 * can actually produce.
 */
export declare const AlarmDelaySeconds: {
    readonly off: 0;
    readonly sec15: 15;
    readonly sec30: 30;
    readonly sec45: 45;
    readonly sec60: 60;
    readonly min3: 180;
    readonly min5: 300;
};
export type AlarmDelaySeconds = (typeof AlarmDelaySeconds)[keyof typeof AlarmDelaySeconds];
/** One `channelList`+`delaySeconds` countdown pair — see {@link AlarmDelayConfig}. */
export type AlarmDelayCountdown = {
    /** Device channels this countdown applies to. */
    channelList: number[];
    /** Delay duration — one of {@link AlarmDelaySeconds}, shared across every channel in `channelList`. */
    delaySeconds: AlarmDelaySeconds;
};
/** One device's participation entry in {@link AlarmDelayConfig.devices} / `.sirenSensorAction`. */
export type AlarmDelayDeviceAction = {
    deviceChannel: number;
    /** Raw per-device action code. Meaning NOT independently confirmed — pass through verbatim from a
     * value read/captured for this exact mode, never invented. */
    action: number;
};
/**
 * The FULL per-mode alarm/arm-delay configuration the device accepts as one write — see the
 * `setAlarmDelayConfig` doc for why this is a caller-supplies-everything shape rather than a simple
 * `setEntryDelay(seconds)` toggle.
 */
export type AlarmDelayConfig = {
    /** Per-sensor ENTRY/alarm delay — the app's "Alarm Delay" UI setting. Confirmed on-device: a delay
     * set on one sensor lands as that sensor's channel plus the chosen duration. */
    countDownAlarm: AlarmDelayCountdown;
    /** A second, distinct countdown carried alongside `countDownAlarm`. It stayed empty across every
     * observed `countDownAlarm` edit, so its own trigger condition is UNCONFIRMED. */
    countDownArm: AlarmDelayCountdown;
    /** Every device's participation + action for THIS mode. UNCONFIRMED semantics (the action code's
     * meaning is unknown) — it stayed identical across every `countDownAlarm`-only edit within the same
     * mode, so pass through exactly what was read back for that mode; never invent a value. */
    devices: AlarmDelayDeviceAction[];
    /** Siren behavior per device for this mode. Same caveat as `devices`. */
    sirenSensorAction: AlarmDelayDeviceAction[];
};
/**
 * Bound guard-mode controls — the object returned by `dev.arming()`.
 *
 * Everything is DERIVED from `ARMING_MEMBERS`. `setMode` is the mode member's own derived setter;
 * `setAlarmDelayConfig` is a `method` because it takes TWO arguments (a mode and a whole config),
 * which no value setter can express.
 */
export type ArmingActions = Surface<typeof ARMING_MEMBERS>;
/**
 * Every `arming` feature, declared once.
 *
 * Exported but NOT published: each entry states its wire id and the evidence it was confirmed on,
 * which the reference site does not carry.
 * @internal
 */
export declare const ARMING_MEMBERS: {
    /**
     * The one member whose write domain is NARROWER than its read: `enumValues` names all nine modes a
     * station can report, and the argument's `values` publishes only the three whose wire was captured. That
     * argument IS the domain the derived setter enforces and the refusal names, so an uncaptured mode is
     * refused by naming the three that work — nine labels for the read and three for the write, off one
     * declaration.
     *
     * `armingCommand` may also throw synchronously (missing account identity) and `bindMembers` turns that
     * into a rejection, so the builder stays plain.
     *
     * The setter takes either vocabulary — see `armingModeOf` — because the getter answers the wire integer,
     * and a value a caller just read has to be one it can write back.
     *
     * MODE_SWITCH carries no value. Live qualification on a standalone camera showed that authoritative
     * readback requires a bounded cloud-list refresh, and that its P2P session must be reset after
     * convergence before a following mode write; an attached device must never reset its shared HomeBase.
     */
    readonly mode: {
        readonly accepts: ArmingMode;
        readonly param: 1224;
        readonly property: "armingMode";
        readonly type: "enum";
        readonly kind: "enum";
        readonly enumValues: Record<number, string>;
        readonly provenance: "verified";
        readonly args: readonly [{
            readonly name: "mode";
            readonly kind: "enum";
            readonly values: readonly number[];
        }];
        readonly description: string;
        readonly observation: {
            readonly event: "armingModeChanged";
            readonly reflects: (value: string | number | boolean) => {
                param: 1224;
                expected: number;
            };
            readonly resetStandaloneSession: true;
            readonly timeoutMs: 20000;
        };
        readonly write: (v: string | number | boolean, ctx: CommandContext) => Command | undefined;
    };
    /**
     * Write the FULL per-mode alarm/arm-delay configuration. The device accepts the whole config as one
     * write, not a single duration field, so a partial update is not possible. An expert/advanced API: the
     * caller is responsible for supplying `devices`/`sirenSensorAction` (and the `countDownAlarm`/
     * `countDownArm` entries they are NOT changing) from a value they have independently read/captured for
     * this mode — there is no known GET to fetch it automatically, and a wrong guess here can silently
     * misconfigure which sensors arm/trigger for real.
     *
     * Takes {@link ArmingMode}, so a delay can only be configured for a mode whose `mode_id` integer is
     * captured. The frame carries that same integer, so a schedule/custom mode would be the identical guess
     * `setMode` refuses.
     */
    readonly setAlarmDelayConfig: import("./members.js").MethodMember<(mode: ArmingMode, config: AlarmDelayConfig) => Promise<void>>;
};
/**
 * `arming` — guard/arming mode. `armingMode` (see {@link ARMING_CMD.SET_ARMING}) has a verified
 * read/write MECHANISM, but only 3 of its 8 {@link ArmingMode} values (away/home/disarmed) are
 * wire-captured — see `ARMING_MODE_WIRE` for which 5 are still unverified third-party integers.
 */
export declare const ARMING: CapabilityModule;

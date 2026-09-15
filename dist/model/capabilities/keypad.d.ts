import { type Surface } from "./members.js";
import type { CapabilityModule } from "./types.js";
/**
 * Every `keypad` feature, declared once. Only `rssi` is a verified read.
 *
 * The battery pair is `unexposed`: both ids are placeholders, and the keypad's real battery state is
 * reported under model-specific params (`keypadBatteryCapState` / `keypadBatteryChargerState`, seen
 * live) whose low/charging semantics are not confirmed. They stay in the schema so a diagnosis can
 * reach them through `getProperty`, with no typed getter asserting a meaning this SDK cannot back.
 * A live probe of the fleet's T8960 confirms neither is reported at all today.
 *
 * Exported but NOT published: each entry states its wire id and the evidence it was confirmed on,
 * which the reference site does not carry.
 * @internal
 */
export declare const KEYPAD_MEMBERS: {
    /**
     * `unexposed`, so it reaches a diagnosis through `getProperty` but gets no typed getter. 1103 is a
     * placeholder AND a likely collision — the app's own param table names 1103 GET_CAMERA_INFO — so a
     * getter here would be asserting a meaning nothing backs. The keypad's real battery state arrives
     * under `keypadBatteryCapState`, whose low/charging semantics are not confirmed.
     */
    readonly batteryLow: {
        readonly param: 1103;
        readonly type: "bool";
        readonly kind: "boolean";
        readonly provenance: "guessed";
        readonly unexposed: true;
        readonly description: string;
    };
    /**
     * The charging half of the battery pair, `unexposed` for the same reason as `batteryLow`: 1102 is a
     * placeholder id, and the state the keypad actually reports (`keypadBatteryChargerState`) has no
     * confirmed value space. In the schema for `getProperty`, absent from the typed surface.
     */
    readonly charging: {
        readonly param: 1102;
        readonly type: "bool";
        readonly kind: "boolean";
        readonly provenance: "guessed";
        readonly unexposed: true;
        readonly description: "Keypad charging flag. UNVERIFIED: placeholder id pending verification.";
    };
    /**
     * The keypad's link quality in dBm — the one verified read in this table, on the same param 1141 the
     * other sub-1G sensors report signal strength on. Reported as the device measures it: raw dBm, never
     * normalised to a bar count.
     */
    readonly rssi: {
        readonly param: 1141;
        readonly type: "number";
        readonly unit: "dBm";
        readonly kind: "dbm";
        readonly provenance: "verified";
        readonly description: "Keypad signal strength (verified: param 1141 = RSSI).";
    };
};
/** Bound keypad reads — the object returned by `dev.keypad()`. Read-only. */
export type KeypadActions = Surface<typeof KEYPAD_MEMBERS>;
/** `keypad` — security keypad. Battery low/charging and signal. Param ids here are placeholders apart from RSSI. */
export declare const KEYPAD: CapabilityModule;

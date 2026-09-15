/** The evidence a family decision needs — a structural subset of `CommandContext`. */
export interface FamilyContext {
    /** eufy vendor DeviceType, when known (undefined ⇒ unknown ⇒ don't guess). */
    deviceType?: number;
    /** Model / T-code, when known. */
    model?: string;
    /**
     * API category string — e.g. `"eufy_home"`, `"eufy_home_tuya"`, `"eufy_security"`. Supplied by
     * the mega `get_devs_list` response; absent in unit-test contexts that build a minimal context
     * without a real API record. Used as the PRIMARY transport discriminator for the clean line:
     * `"eufy_home_tuya"` devices are on the ThingClips/Tuya Cloud platform, not Anker AIoT MQTT.
     */
    category?: string;
}
/** Indoor cams, incl. indoor pan/tilt + S350/E30/C-series + mini. */
export declare const INDOOR_CAMERA_TYPES: ReadonlySet<number>;
/** Indoor pan/tilt S350 family. */
export declare const INDOOR_PT_S350_TYPES: ReadonlySet<number>;
/** Outdoor pan/tilt + solo-PT. */
export declare const OUTDOOR_PT_TYPES: ReadonlySet<number>;
/** Floodlight cams. */
export declare const FLOODLIGHT_TYPES: ReadonlySet<number>;
/** Wall-light cams. */
export declare const WALL_LIGHT_TYPES: ReadonlySet<number>;
/**
 * HomeBase-family hubs — the station-class devices with a built-in **speaker + alarm siren**, so
 * they own the hub-audio surface (alarm / voice-prompt volume). A deliberate SUBSET of the `station`
 * codec that EXCLUDES the NVRs (S4 Max, PoE NVR): those resolve to `station` for arming/storage but
 * have no speaker, so they must NOT expose the hub-audio controls (they'd fire at nothing). The
 * alarm/prompt wire is verified on HomeBase 3 (HB3); the other hubs share the hub hardware.
 */
export declare const HOMEBASE_TYPES: ReadonlySet<number>;
/** Indoor camera (any indoor variant). */
export declare const isIndoorCamera: (ctx: FamilyContext) => boolean;
/** Indoor cost-down "mini" cam. */
export declare const isIndoorCamMini: (ctx: FamilyContext) => boolean;
/** Indoor pan/tilt S350 family. */
export declare const isIndoorPanTiltS350: (ctx: FamilyContext) => boolean;
/** Outdoor pan/tilt (+ solo-PT) family. */
export declare const isOutdoorPanTilt: (ctx: FamilyContext) => boolean;
/** Floodlight cam family. */
export declare const isFloodLight: (ctx: FamilyContext) => boolean;
/** HomeBase-family hub (has a speaker/alarm) — a station EXCLUDING the NVRs, per `HOMEBASE_TYPES`. */
export declare const isHomeBase: (ctx: FamilyContext) => boolean;
/** Wired doorbell (DeviceType.DOORBELL). */
export declare const isWiredDoorbell: (ctx: FamilyContext) => boolean;
/**
 * Whether a vacuum uses the **Anker AIoT MQTT** transport (modern DP 150–180 protobuf scheme).
 *
 * A **negative exclusion**: returns `false` only for the one confirmed non-AIoT platform
 * (`"eufy_home_tuya"` — ThingClips/Tuya Cloud). Any absent, unknown, or unrecognised category
 * defaults to `true`, matching the polarity of `routeCommand` which sends `aiot-dp` to MQTT
 * unless `category === "eufy_home_tuya"`. The two gates agree: an unknown-category AIoT
 * vacuum both routes to MQTT *and* has its setters installed.
 *
 * | `category`          | platform                           | returns |
 * | ------------------- | ---------------------------------- | ------- |
 * | `"eufy_home"`       | Anker AIoT MQTT ✅ confirmed       | `true`  |
 * | `"eufy_home_tuya"`  | ThingClips/Tuya Cloud ✅ confirmed  | `false` |
 * | absent / any other  | unknown — default to AIoT          | `true`  |
 *
 * Live-confirmed categories sourced from `get_devs_list` dumps: `"eufy_home_tuya"` from a T2266
 * X8 Pro (2026-08-04). Additional category strings are added here as devices are captured.
 */
export declare const isAiotVacuum: (ctx: FamilyContext) => boolean;
/**
 * Whether a vacuum is on the **ThingClips/Tuya Cloud** platform (`"eufy_home_tuya"` category).
 *
 * The positive complement of the negative-exclusion {@link isAiotVacuum}: returns `true` only for
 * the one confirmed non-AIoT platform. Used to extend capability `available` guards so Tuya
 * vacuums receive the same write actions as AIoT ones, routed by the facade's `routeCommand`.
 */
export declare const isTuyaVacuum: (ctx: FamilyContext) => boolean;

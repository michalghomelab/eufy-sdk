/**
 * AUTHORITATIVE param dictionary — the app's own decompiled constant names joined with a live
 * param-sweep of real owned devices.
 *
 * Two namespaces (params are per-transport, NOT globally unique):
 *  - SECURITY_PARAMS — eufy P2P param space (ids 1000+). **Membership is the observation**: an id is
 *    listed only because the sweep saw it on a real owned device, so the id is real/accepted.
 *    `provenance` is the trust of the NAME/meaning: "verified" (our captures) > "apk" (the app's own
 *    decompiled constant name) > "guessed" (no name source — needs toggle-diff).
 *  - CLEAN_PARAMS — RoboVac Tuya DP space (ids 1 and above), names from the cloud
 *    `get_product_data_point` data_point_list (provenance "mega" — authoritative).
 *
 * Which models reported an id, and the capture that named it, are in the commit that adds the entry.
 */
import type { PropertyValueType, PropertySource, ParamEncoding } from "./types.js";
/** One param definition in the dictionary. */
export interface ParamDef {
    /** Stable camelCase code-facing name. */
    name: string;
    type: PropertyValueType;
    provenance: PropertySource;
    /** How the wire value is encoded, when not a plain scalar (decode on read, encode on write). */
    encoding?: ParamEncoding;
}
/** eufy P2P security param space (ids 1000+). */
export declare const SECURITY_PARAMS: Record<number, ParamDef>;
/** RoboVac Tuya DP space (ids ~150-180), from get_product_data_point. */
export declare const CLEAN_PARAMS: Record<number, ParamDef>;

/**
 * Inbound Tuya DP event parsing and routing for eufy Home/Clean (`eufy_home_tuya`) devices.
 *
 * {@link parseTuyaDpReport} unwraps the Anker MQTT `{head, payload}` envelope and extracts the
 * raw DP map. {@link parseTuyaDpEvent} then validates and normalises it to a numeric-keyed record.
 * {@link TuyaDpRouter} delivers the result to the registered {@link TuyaDpInbound} listener so the
 * capability layer can consume Tuya state through the same typed getters as AIoT.
 *
 * Inbound messages arrive on `cmd/eufy_home/{model}/{sn}/res` with `sign_code: 0` (no additional
 * encryption — confirmed from clean-device captures). If a future capture shows `sign_code ≠ 0` the
 * payload will be AES-128-ECB encrypted with the device's localKey before the JSON can be parsed.
 */
import type { TuyaDpInbound } from "../../core/contracts.js";
/**
 * Validate and convert a raw ThingClips DP callback payload to a numeric-keyed record.
 *
 * The callback delivers `{ "<dpId>": <value>, … }` with string keys and typed values; this
 * normalises the keys to positive integer DP ids. Unrecognised keys (non-positive-integer, non-scalar
 * values) are skipped rather than rejecting the whole map — the same defensive posture as
 * {@link parseAiotDpReport}. Returns `null` only when the input is not a non-empty object or when no
 * valid DP entry was found.
 */
export declare function parseTuyaDpEvent(payload: unknown): Record<number, boolean | number | string> | null;
/**
 * Extract a raw DP map from an inbound Anker MQTT message for a `eufy_home_tuya` device.
 *
 * Messages arrive in the same `{head, payload}` envelope the AIoT path uses, where `payload` is a
 * JSON **string**:
 * ```json
 * { "head": { "cmd": 65537, "cmd_status": 2, "sign_code": 0, ... },
 *   "payload": "{\"t\":\"…\",\"protocol\":2,\"data\":{\"104\":80,\"106\":0}}" }
 * ```
 * Two DP layouts inside the decoded payload are handled: Tuya-native (`data.dps`) and AIoT-direct
 * (`data` with integer-keyed DP ids). Falls back to flat `envelope.dps` / `envelope.data.dps`
 * shapes for any pre-parsed delivery. Returns `undefined` when no recognised shape is found.
 *
 * @internal
 */
export declare function parseTuyaDpReport(raw: unknown): Record<string, unknown> | undefined;
/**
 * Routes validated inbound Tuya DP events to the registered {@link TuyaDpInbound} listener.
 *
 * Mirrors the AIoT MQTT inbound path: the transport owns parsing; the capability layer owns
 * semantics. A malformed or empty payload is silently dropped; the listener sees only
 * successfully parsed DP maps.
 */
export declare class TuyaDpRouter {
    private listener;
    /** Register the inbound listener. Replaces any previously registered one. */
    setListener(listener: TuyaDpInbound): void;
    /**
     * Parse `dps` and, if valid, deliver it to the registered listener for `sn`.
     * Silently drops malformed or empty payloads.
     */
    deliver(sn: string, dps: unknown): void;
}

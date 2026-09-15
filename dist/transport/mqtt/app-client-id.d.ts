export interface AppClientIdInput {
    /** Topic scope, e.g. "eufy_security". */
    appName: string;
    /** The logged-in user id (40-hex) — NOT necessarily the device owner if it's a shared device. */
    uid: string;
    /** Stable per-install identifier (`AIOTDeviceSdk.getMqttUUID()` on the real app). Any stable 16-hex
     * string works for our purposes — generate once and persist it, don't re-randomize per connect. */
    mqttUuid: string;
    /** Connect-time unix SECONDS. Defaults to now; inject for deterministic tests. */
    timestamp?: number;
}
/** Build a client_id shaped like `android-{appName}-{uid}-{mqttUuid}-{timestamp}`. */
export declare function buildAppShapedClientId(input: AppClientIdInput): string;
/** A fresh stable-looking install UUID (16 hex chars) — generate ONCE per identity and persist it
 * (a new random value on every connect defeats the point of "stable"). */
export declare function generateMqttUuid(): string;

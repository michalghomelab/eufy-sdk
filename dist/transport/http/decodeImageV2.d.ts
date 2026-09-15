/**
 * Per-channel auto-contrast, a byte-exact port of PIL `ImageOps.autocontrast` (cutoff 0.5%). The lost
 * quant tables leave the reconstruction low-contrast ("foggy"); stretching each channel's clipped range
 * to full scale restores a natural-looking image. Mutates `data` (RGBA) in place.
 *
 * Parity notes vs PIL: the cutoff count is `n * cutoff // 100` (integer floor); it is trimmed off each
 * end by zeroing whole histogram bins until the count is spent; the range is then the first/last
 * non-empty bins; and the LUT truncates toward zero (`int()`), NOT rounds — rounding would shift pixels.
 */
export declare function autoContrast(data: Uint8Array, width: number, height: number, cutoff?: number): void;
/** True if the blob is a v2 `v2_eufysecurity:` push thumbnail. */
export declare function isV2Image(data: Buffer): boolean;
/**
 * Decode a v2 blob to a plain JPEG buffer by reconstructing its header, or null if it isn't v2 or the
 * plaintext scan can't be located. The search first chooses subsampling and coarse geometry, derives
 * the fixed MCU count, refines width by row shear, and pins the exact fill height before applying
 * auto-contrast and re-encoding. See the module doc for the keyless-splice rationale.
 */
export declare function decodeImageV2(data: Buffer): Buffer | null;

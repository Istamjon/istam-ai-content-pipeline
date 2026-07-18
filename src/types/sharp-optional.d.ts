/**
 * Optional peer for Instagram JPEG conversion.
 * Not required at install time — dynamic import fails soft if missing.
 */
declare module "sharp" {
  // Minimal surface used by publishToInstagram
  interface SharpInstance {
    rotate(): SharpInstance;
    flatten(opts: { background: { r: number; g: number; b: number } }): SharpInstance;
    jpeg(opts?: { quality?: number; mozjpeg?: boolean }): SharpInstance;
    toFile(path: string): Promise<unknown>;
  }
  function sharp(input: string): SharpInstance;
  export default sharp;
}

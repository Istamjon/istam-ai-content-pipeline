/**
 * Optional peer for Instagram JPEG conversion + brand face prep.
 * Not required at install time — dynamic import fails soft if missing.
 */
declare module "sharp" {
  // Minimal surface used by publishToInstagram + brandFace
  interface SharpInstance {
    rotate(): SharpInstance;
    resize(
      width?: number,
      height?: number,
      options?: { fit?: string; withoutEnlargement?: boolean },
    ): SharpInstance;
    flatten(opts: { background: { r: number; g: number; b: number } }): SharpInstance;
    jpeg(opts?: { quality?: number; mozjpeg?: boolean }): SharpInstance;
    toFile(path: string): Promise<unknown>;
    toBuffer(): Promise<Buffer>;
  }
  function sharp(input: string | Buffer): SharpInstance;
  export default sharp;
}

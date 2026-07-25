// subset-font ships no types; build-time script only.
declare module "subset-font" {
  export default function subsetFont(
    font: Buffer,
    text: string,
    options?: { targetFormat?: "sfnt" | "woff" | "woff2" },
  ): Promise<Buffer>;
}

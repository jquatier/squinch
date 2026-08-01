// Share links keep the source in the URL fragment — it never reaches a server.
// base64url: the standard alphabet's `+` and `/` are not fragment-safe, and the
// `=` padding is noise in a link people paste into chat.

/**
 * The chunking is not decoration. The original spread `String.fromCharCode(...bytes)`
 * over the whole array, which passes every byte as a separate argument — fine
 * for a toy diagram and a `RangeError: Maximum call stack size exceeded` for a
 * real one, at somewhere around 64k–125k bytes depending on the engine. Sharing
 * is exactly what you do with a diagram once it is big enough to be worth
 * showing someone.
 */
function toBinary(bytes: Uint8Array): string {
  let out = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK)
    out += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return out;
}

export function encodeShare(source: string): string {
  return btoa(toBinary(new TextEncoder().encode(source)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function decodeShare(fragment: string): string | undefined {
  try {
    const b64 = fragment.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b64);
    return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  } catch {
    return undefined;
  }
}

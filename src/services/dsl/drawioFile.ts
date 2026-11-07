// Where the draw.io diagram sits inside a file: a `.drawio`/`.xml` file is the diagram,
// a `.drawio.svg` keeps it in the root's `content` attribute, and a `.drawio.png`
// keeps it, URI-encoded, in a PNG text chunk keyed `mxfile` (tEXt, zTXt or iTXt).

import { looksLikeDrawio } from './drawio';
import { parseXml } from './xmlReader';

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

/** True when `bytes` start like a PNG. */
export function isPng(bytes: Uint8Array): boolean {
  return PNG_SIGNATURE.every((byte, index) => bytes[index] === byte);
}

/** The draw.io XML in an SVG's text, or null when it carries none. */
export function drawioFromSvg(text: string): string | null {
  if (!/<svg\b/i.test(text.slice(0, 4096))) return null;
  const parsed = parseXml(text);
  if ('error' in parsed || parsed.root.name !== 'svg') return null;
  const content = parsed.root.attributes.content;
  return content && looksLikeDrawio(content) ? content : null;
}

const latin1 = (bytes: Uint8Array) => new TextDecoder('latin1').decode(bytes);
const utf8 = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

async function inflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Response(bytes).body!.pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** One PNG text chunk's value when its keyword is `mxfile`; null for any other chunk. */
async function chunkText(type: string, data: Uint8Array): Promise<string | null> {
  const nul = data.indexOf(0);
  if (nul === -1 || latin1(data.subarray(0, nul)) !== 'mxfile') return null;
  const rest = data.subarray(nul + 1);
  if (type === 'tEXt') return latin1(rest);
  if (type === 'zTXt') return latin1(await inflate(rest.subarray(1)));
  // iTXt: compressed flag, method, then language and translated keyword, each NUL-ended.
  const compressed = rest[0] === 1;
  const language = rest.indexOf(0, 2);
  const translated = language === -1 ? -1 : rest.indexOf(0, language + 1);
  if (translated === -1) return null;
  const body = rest.subarray(translated + 1);
  return utf8(compressed ? await inflate(body) : body);
}

/** The draw.io XML a PNG carries, or null. A chunk that can't be read is the same as none. */
export async function drawioFromPng(bytes: Uint8Array): Promise<string | null> {
  if (!isPng(bytes)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let at = 8; at + 8 <= bytes.length;) {
    const length = view.getUint32(at);
    const type = latin1(bytes.subarray(at + 4, at + 8));
    const end = at + 12 + length;
    if (end > bytes.length || type === 'IEND') return null;
    if (type === 'tEXt' || type === 'zTXt' || type === 'iTXt') {
      try {
        const text = await chunkText(type, bytes.subarray(at + 8, at + 8 + length));
        if (text !== null) {
          const xml = decodeURIComponent(text);
          return looksLikeDrawio(xml) ? xml : null;
        }
      } catch {
        return null;
      }
    }
    at = end;
  }
  return null;
}

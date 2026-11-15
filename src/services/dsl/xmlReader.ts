// A small XML reader for imported diagram files (draw.io). No DOMParser, so it
// runs the same in a worker, in Node and in tests. It reads elements,
// attributes and text; comments, processing instructions and DOCTYPE are skipped.
// ponytail: no namespaces or DTD entities — enough for mxfile; add them if a format needs them.

export interface XmlElement {
  readonly name: string;
  readonly attributes: Readonly<Record<string, string>>;
  readonly children: readonly XmlElement[];
  readonly text: string;
}

const NAMED: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' };

/** HTML's named characters a label is likely to hold, each as its code point; names are case-sensitive (`&Omega;` Ω, `&omega;` ω). */
const HTML_NAMED: Readonly<Record<string, number>> = {
  iexcl: 161, cent: 162, pound: 163, curren: 164, yen: 165, brvbar: 166, sect: 167, uml: 168, copy: 169, ordf: 170, laquo: 171, not: 172, shy: 173,
  reg: 174, macr: 175, deg: 176, plusmn: 177, sup2: 178, sup3: 179, acute: 180, micro: 181, para: 182, middot: 183, cedil: 184, sup1: 185, ordm: 186,
  raquo: 187, frac14: 188, frac12: 189, frac34: 190, iquest: 191, times: 215, divide: 247,
  Agrave: 192, Aacute: 193, Acirc: 194, Atilde: 195, Auml: 196, Aring: 197, AElig: 198, Ccedil: 199, Egrave: 200, Eacute: 201, Ecirc: 202, Euml: 203,
  Igrave: 204, Iacute: 205, Icirc: 206, Iuml: 207, Ntilde: 209, Ograve: 210, Oacute: 211, Ocirc: 212, Otilde: 213, Ouml: 214, Oslash: 216, Ugrave: 217,
  Uacute: 218, Ucirc: 219, Uuml: 220, szlig: 223, agrave: 224, aacute: 225, acirc: 226, atilde: 227, auml: 228, aring: 229, aelig: 230, ccedil: 231,
  egrave: 232, eacute: 233, ecirc: 234, euml: 235, igrave: 236, iacute: 237, icirc: 238, iuml: 239, ntilde: 241, ograve: 242, oacute: 243, ocirc: 244,
  otilde: 245, ouml: 246, oslash: 248, ugrave: 249, uacute: 250, ucirc: 251, uuml: 252,
  Alpha: 913, Beta: 914, Gamma: 915, Delta: 916, Epsilon: 917, Zeta: 918, Eta: 919, Theta: 920, Iota: 921, Kappa: 922, Lambda: 923, Mu: 924, Nu: 925,
  Xi: 926, Omicron: 927, Pi: 928, Rho: 929, Sigma: 931, Tau: 932, Upsilon: 933, Phi: 934, Chi: 935, Psi: 936, Omega: 937,
  alpha: 945, beta: 946, gamma: 947, delta: 948, epsilon: 949, zeta: 950, eta: 951, theta: 952, iota: 953, kappa: 954, lambda: 955, mu: 956, nu: 957,
  xi: 958, omicron: 959, pi: 960, rho: 961, sigmaf: 962, sigma: 963, tau: 964, upsilon: 965, phi: 966, chi: 967, psi: 968, omega: 969,
  ensp: 8194, emsp: 8195, thinsp: 8201, zwnj: 8204, zwj: 8205, ndash: 8211, mdash: 8212, lsquo: 8216, rsquo: 8217, sbquo: 8218, ldquo: 8220, rdquo: 8221,
  bdquo: 8222, dagger: 8224, Dagger: 8225, bull: 8226, hellip: 8230, permil: 8240, prime: 8242, Prime: 8243, lsaquo: 8249, rsaquo: 8250, euro: 8364,
  trade: 8482, larr: 8592, uarr: 8593, rarr: 8594, darr: 8595, harr: 8596, lArr: 8656, rArr: 8658, hArr: 8660, forall: 8704, part: 8706, exist: 8707,
  empty: 8709, nabla: 8711, isin: 8712, ni: 8715, prod: 8719, sum: 8721, minus: 8722, radic: 8730, infin: 8734, cap: 8745, cup: 8746, int: 8747,
  there4: 8756, asymp: 8776, ne: 8800, equiv: 8801, le: 8804, ge: 8805, sub: 8834, sup: 8835, loz: 9674, spades: 9824, clubs: 9827, hearts: 9829, diams: 9830,
};

/** `&amp;` `&#10;` `&#x41;` → their characters; an unknown entity stays as written. */
export function decodeEntities(text: string): string {
  if (!text.includes('&')) return text;
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    if (Object.hasOwn(HTML_NAMED, body)) return String.fromCodePoint(HTML_NAMED[body]!);
    const lower = body.toLowerCase();
    return Object.hasOwn(NAMED, lower) ? NAMED[lower]! : whole;
  });
}

const ATTRIBUTE = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

function readAttributes(source: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const match of source.matchAll(ATTRIBUTE)) attributes[match[1]!] = decodeEntities(match[2] ?? match[3] ?? '');
  return attributes;
}

interface Building {
  name: string;
  attributes: Record<string, string>;
  children: XmlElement[];
  text: string;
}

/** The document's root element, or an error saying where reading stopped. */
export function parseXml(source: string): { readonly root: XmlElement } | { readonly error: string } {
  const stack: Building[] = [{ name: '', attributes: {}, children: [], text: '' }];
  let at = 0;
  while (at < source.length) {
    const open = source.indexOf('<', at);
    const textEnd = open === -1 ? source.length : open;
    if (textEnd > at) stack[stack.length - 1]!.text += decodeEntities(source.slice(at, textEnd));
    if (open === -1) break;
    if (source.startsWith('<!--', open)) {
      const end = source.indexOf('-->', open + 4);
      if (end === -1) return { error: 'A comment is never closed' };
      at = end + 3;
      continue;
    }
    if (source.startsWith('<![CDATA[', open)) {
      const end = source.indexOf(']]>', open + 9);
      if (end === -1) return { error: 'A CDATA section is never closed' };
      stack[stack.length - 1]!.text += source.slice(open + 9, end);
      at = end + 3;
      continue;
    }
    if (source[open + 1] === '?' || source[open + 1] === '!') {
      const end = source.indexOf('>', open);
      if (end === -1) return { error: 'A declaration is never closed' };
      at = end + 1;
      continue;
    }
    const close = findTagEnd(source, open);
    if (close === -1) return { error: 'A tag is never closed' };
    const tag = source.slice(open + 1, close);
    at = close + 1;
    if (tag[0] === '/') {
      const name = tag.slice(1).trim();
      const element = stack.pop();
      if (!element || stack.length === 0 || element.name !== name) return { error: `</${name}> closes nothing open` };
      stack[stack.length - 1]!.children.push(element);
      continue;
    }
    const selfClosing = tag.endsWith('/');
    const body = selfClosing ? tag.slice(0, -1) : tag;
    const name = /^[^\s/>]+/.exec(body)?.[0];
    if (!name) return { error: 'A tag has no name' };
    const element: Building = { name, attributes: readAttributes(body.slice(name.length)), children: [], text: '' };
    if (selfClosing) stack[stack.length - 1]!.children.push(element);
    else stack.push(element);
  }
  if (stack.length !== 1) return { error: `<${stack[stack.length - 1]!.name}> is never closed` };
  const root = stack[0]!.children[0];
  return root ? { root } : { error: 'There is no XML element in it' };
}

/** Where the tag opened at `open` ends: its `>`, skipping any `>` inside a quoted attribute value. */
function findTagEnd(source: string, open: number): number {
  let quote: string | null = null;
  for (let index = open + 1; index < source.length; index += 1) {
    const char = source[index];
    if (quote) { if (char === quote) quote = null; continue; }
    if (char === '"' || char === "'") quote = char;
    else if (char === '>') return index;
  }
  return -1;
}

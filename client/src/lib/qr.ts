/**
 * qr.ts — Local QR code encoder (Prompt 9.7 requirement 3: no third-party QR API).
 *
 * Encodes text as a real, scannable QR code (ISO/IEC 18004): byte mode, error correction level M,
 * versions 1–10 (up to 213 UTF-8 bytes, far more than a short link needs), automatic mask choice.
 * Zero dependencies. The algorithm follows the public-domain reference by Project Nayuki.
 *
 * WHY level M: it survives ~15% damage (a folded or smudged printed flyer) while keeping the
 * module count low enough to scan from a phone screen at story size.
 */

// Error-correction codewords per block and block count for level M, indexed by version (1–10).
const ECC_PER_BLOCK = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
const NUM_BLOCKS = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
const MAX_VERSION = 10;
const FORMAT_ECC_M = 0; // the 2-bit format code for level M

export interface QrCode {
  /** Modules per side (21 for version 1, +4 per version). */
  size: number;
  version: number;
  mask: number;
  /** modules[y][x] — true is a dark module. */
  modules: boolean[][];
}

function rawDataModules(ver: number): number {
  let result = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const numAlign = Math.floor(ver / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;
    if (ver >= 7) result -= 36;
  }
  return result;
}

function dataCodewords(ver: number): number {
  return Math.floor(rawDataModules(ver) / 8) - ECC_PER_BLOCK[ver] * NUM_BLOCKS[ver];
}

function alignmentPositions(ver: number): number[] {
  if (ver === 1) return [];
  const numAlign = Math.floor(ver / 7) + 2;
  const step = Math.floor((ver * 8 + numAlign * 3 + 5) / (numAlign * 4 - 4)) * 2;
  const result = [6];
  for (let pos = ver * 4 + 17 - 7; result.length < numAlign; pos -= step) result.splice(1, 0, pos);
  return result;
}

/** GF(2^8) multiply with the QR polynomial 0x11D. */
function gfMul(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

function rsDivisor(degree: number): number[] {
  const result = new Array(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = gfMul(result[j], root);
      if (j + 1 < result.length) result[j] ^= result[j + 1];
    }
    root = gfMul(root, 0x02);
  }
  return result;
}

/** Reed–Solomon error-correction codewords for `data`. Exported for the test's known vector. */
export function rsRemainder(data: number[], degree: number): number[] {
  const divisor = rsDivisor(degree);
  const result = new Array(degree).fill(0);
  for (const b of data) {
    const factor = b ^ (result.shift() as number);
    result.push(0);
    divisor.forEach((coef, i) => { result[i] ^= gfMul(coef, factor); });
  }
  return result;
}

function bit(value: number, i: number): boolean {
  return ((value >>> i) & 1) !== 0;
}

function maskAt(mask: number, x: number, y: number): boolean {
  switch (mask) {
    case 0: return (x + y) % 2 === 0;
    case 1: return y % 2 === 0;
    case 2: return x % 3 === 0;
    case 3: return (x + y) % 3 === 0;
    case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    case 5: return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6: return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    default: return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
  }
}

/** The 15 format bits (level + mask, BCH-protected, XOR-masked) as drawn beside the finders. */
export function formatBits(mask: number): number {
  const data = (FORMAT_ECC_M << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

/** Splits data into blocks, appends each block's ECC and interleaves them (spec §7.6). */
function addEccAndInterleave(data: number[], ver: number): number[] {
  const numBlocks = NUM_BLOCKS[ver];
  const eccLen = ECC_PER_BLOCK[ver];
  const rawCodewords = Math.floor(rawDataModules(ver) / 8);
  const numShortBlocks = numBlocks - (rawCodewords % numBlocks);
  const shortBlockLen = Math.floor(rawCodewords / numBlocks);

  const blocks: number[][] = [];
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const dat = data.slice(k, k + shortBlockLen - eccLen + (i < numShortBlocks ? 0 : 1));
    k += dat.length;
    const ecc = rsRemainder(dat, eccLen);
    if (i < numShortBlocks) dat.push(0);
    blocks.push(dat.concat(ecc));
  }

  const result: number[] = [];
  for (let i = 0; i < blocks[0].length; i++) {
    blocks.forEach((block, j) => {
      // The padding byte added to short blocks is not part of the stream.
      if (i !== shortBlockLen - eccLen || j >= numShortBlocks) result.push(block[i]);
    });
  }
  return result;
}

function encodeData(bytes: number[], ver: number): number[] {
  const bits: number[] = [];
  const push = (value: number, len: number) => { for (let i = len - 1; i >= 0; i--) bits.push((value >>> i) & 1); };
  push(0b0100, 4); // byte mode
  push(bytes.length, ver <= 9 ? 8 : 16);
  bytes.forEach((b) => push(b, 8));

  const capacity = dataCodewords(ver) * 8;
  push(0, Math.min(4, capacity - bits.length));
  push(0, (8 - (bits.length % 8)) % 8);

  const codewords: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    codewords.push(bits.slice(i, i + 8).reduce((acc, b) => (acc << 1) | b, 0));
  }
  for (let pad = 0xec; codewords.length < dataCodewords(ver); pad ^= 0xec ^ 0x11) codewords.push(pad);
  return codewords;
}

/** Penalty score for a masked symbol (spec §7.8.3); the mask with the lowest score is kept. */
function penalty(m: boolean[][]): number {
  const size = m.length;
  let score = 0;

  // N1: runs of 5+ same-colour modules in a row or column.
  for (let pass = 0; pass < 2; pass++) {
    for (let a = 0; a < size; a++) {
      let run = 1;
      for (let b = 1; b < size; b++) {
        const cur = pass === 0 ? m[a][b] : m[b][a];
        const prev = pass === 0 ? m[a][b - 1] : m[b - 1][a];
        if (cur === prev) {
          run++;
          if (run === 5) score += 3;
          else if (run > 5) score += 1;
        } else {
          run = 1;
        }
      }
    }
  }

  // N2: 2×2 blocks of one colour.
  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const c = m[y][x];
      if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) score += 3;
    }
  }

  // N3: finder-like 1:1:3:1:1 patterns with four light modules on one side.
  const patterns = [
    [true, false, true, true, true, false, true, false, false, false, false],
    [false, false, false, false, true, false, true, true, true, false, true],
  ];
  for (let a = 0; a < size; a++) {
    for (let b = 0; b <= size - 11; b++) {
      for (const p of patterns) {
        let row = true;
        let col = true;
        for (let k = 0; k < 11 && (row || col); k++) {
          if (m[a][b + k] !== p[k]) row = false;
          if (m[b + k][a] !== p[k]) col = false;
        }
        if (row) score += 40;
        if (col) score += 40;
      }
    }
  }

  // N4: dark/light balance.
  let dark = 0;
  m.forEach((r) => r.forEach((c) => { if (c) dark++; }));
  const total = size * size;
  score += Math.floor(Math.abs(dark * 20 - total * 10) / total) * 10;
  return score;
}

/** Encodes `text` (UTF-8) as a QR code. Throws if it does not fit version 10 at level M. */
export function encodeQr(text: string): QrCode {
  const bytes = Array.from(new TextEncoder().encode(String(text ?? '')));
  let ver = 1;
  for (; ver <= MAX_VERSION; ver++) {
    if (4 + (ver <= 9 ? 8 : 16) + bytes.length * 8 <= dataCodewords(ver) * 8) break;
  }
  if (ver > MAX_VERSION) throw new RangeError('QR_TOO_LONG');

  const size = ver * 4 + 17;
  const modules = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const isFn = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const setFn = (x: number, y: number, dark: boolean) => { modules[y][x] = dark; isFn[y][x] = true; };

  // Timing patterns.
  for (let i = 0; i < size; i++) {
    setFn(6, i, i % 2 === 0);
    setFn(i, 6, i % 2 === 0);
  }
  // Finder patterns with their separators.
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        if (x >= 0 && x < size && y >= 0 && y < size) setFn(x, y, dist !== 2 && dist !== 4);
      }
    }
  }
  // Alignment patterns (none where they would sit on a finder).
  const align = alignmentPositions(ver);
  const last = align.length - 1;
  align.forEach((ax, i) => {
    align.forEach((ay, j) => {
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) setFn(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    });
  });

  const drawFormat = (mask: number) => {
    const bits = formatBits(mask);
    for (let i = 0; i <= 5; i++) setFn(8, i, bit(bits, i));
    setFn(8, 7, bit(bits, 6));
    setFn(8, 8, bit(bits, 7));
    setFn(7, 8, bit(bits, 8));
    for (let i = 9; i < 15; i++) setFn(14 - i, 8, bit(bits, i));
    for (let i = 0; i < 8; i++) setFn(size - 1 - i, 8, bit(bits, i));
    for (let i = 8; i < 15; i++) setFn(8, size - 15 + i, bit(bits, i));
    setFn(8, size - 8, true); // the always-dark module
  };
  drawFormat(0); // reserve the area; redrawn once the mask is chosen

  if (ver >= 7) {
    let rem = ver;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (ver << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      setFn(a, b, bit(bits, i));
      setFn(b, a, bit(bits, i));
    }
  }

  // Codewords in the two-column zigzag, skipping the vertical timing column.
  const stream = addEccAndInterleave(encodeData(bytes, ver), ver);
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!isFn[y][x] && i < stream.length * 8) {
          modules[y][x] = bit(stream[i >>> 3], 7 - (i & 7));
          i++;
        }
      }
    }
  }

  const applyMask = (mask: number) => {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) if (!isFn[y][x] && maskAt(mask, x, y)) modules[y][x] = !modules[y][x];
    }
  };

  let best = 0;
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    applyMask(mask);
    drawFormat(mask);
    const score = penalty(modules);
    if (score < bestScore) { best = mask; bestScore = score; }
    applyMask(mask); // XOR again undoes it
  }
  applyMask(best);
  drawFormat(best);

  return { size, version: ver, mask: best, modules };
}

/**
 * SVG path data for the dark modules, one unit per module, starting at (0,0). Callers scale it
 * with a transform and draw the light background (and the 4-module quiet zone) themselves.
 */
export function qrPathData(qr: QrCode): string {
  let d = '';
  qr.modules.forEach((row, y) => {
    row.forEach((dark, x) => { if (dark) d += `M${x} ${y}h1v1h-1z`; });
  });
  return d;
}

/**
 * A ready-to-embed `<g>` drawing `text` as a QR code inside a `box`×`box` square at (x, y), with a
 * light background and the standard quiet zone. Returns '' when there is no text (an empty QR
 * scans as nothing) or it is too long to encode.
 */
export function qrSvgGroup(text: string, x: number, y: number, box: number, fg = '#000000', bg = '#ffffff'): string {
  if (!text) return '';
  let qr: QrCode;
  try {
    qr = encodeQr(text);
  } catch {
    return '';
  }
  const quiet = 4;
  const scale = box / (qr.size + quiet * 2);
  return `<g transform="translate(${x} ${y})">`
    + `<rect width="${box}" height="${box}" fill="${bg}"/>`
    + `<path transform="translate(${(quiet * scale).toFixed(3)} ${(quiet * scale).toFixed(3)}) scale(${scale.toFixed(4)})" d="${qrPathData(qr)}" fill="${fg}" shape-rendering="crispEdges"/>`
    + '</g>';
}

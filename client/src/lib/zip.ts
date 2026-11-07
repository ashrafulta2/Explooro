/**
 * zip.ts — a minimal ZIP writer (PKWARE APPNOTE 6.3, "stored" entries, no compression).
 *
 * Used by the Flyer Studio's bulk download to hand over many flyer images as one file.
 *
 * WHY stored and not deflated: the entries are PNGs, which are already deflate-compressed, so a
 * second pass saves almost nothing and would mean writing a compressor. Stored entries need only
 * a CRC-32 and the headers below, and every unzip tool (Windows Explorer, Android file managers,
 * macOS Archive Utility) opens them.
 *
 * Limits: no ZIP64, so fewer than 65,535 entries and under 4 GB in total — far beyond a batch of
 * flyers (the studio caps a batch, see BULK_LIMIT in FlyerStudio.ts).
 */

export interface ZipEntry {
  name: string;
  data: Uint8Array;
  date?: Date;
}

let crcTable: Uint32Array | null = null;

function table(): Uint32Array {
  if (crcTable) return crcTable;
  crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  return crcTable;
}

/** CRC-32 (IEEE 802.3), as ZIP stores it. */
export function crc32(data: Uint8Array): number {
  const tbl = table();
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) crc = tbl[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function dosTime(d: Date): { time: number; date: number } {
  const year = Math.max(1980, d.getFullYear());
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

/** Builds the bytes of a ZIP archive holding `entries`, in order. */
export function zipBytes(entries: ZipEntry[]): Uint8Array {
  if (entries.length >= 0xffff) throw new Error('ZIP_TOO_MANY_ENTRIES');
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const crc = crc32(entry.data);
    const size = entry.data.length;
    const { time, date } = dosTime(entry.date || new Date());
    if (offset + 30 + name.length + size > 0xffffffff) throw new Error('ZIP_TOO_LARGE');

    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); // local file header signature
    lv.setUint16(4, 20, true); // version needed: 2.0
    lv.setUint16(6, 0x0800, true); // flags: bit 11 = names are UTF-8 (Bangla file names stay readable)
    lv.setUint16(8, 0, true); // method: stored
    lv.setUint16(10, time, true);
    lv.setUint16(12, date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, size, true); // compressed size
    lv.setUint32(22, size, true); // uncompressed size
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true); // extra field length
    local.set(name, 30);

    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true); // central directory header signature
    cv.setUint16(4, 20, true); // version made by
    cv.setUint16(6, 20, true); // version needed
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, size, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, name.length, true);
    // 30 extra length, 32 comment length, 34 disk start, 36 internal attrs, 38 external attrs: all 0
    cv.setUint32(42, offset, true); // offset of the local header
    central.set(name, 46);

    locals.push(local, entry.data);
    centrals.push(central);
    offset += local.length + size;
  }

  const centralSize = centrals.reduce((s, c) => s + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); // end of central directory signature
  ev.setUint16(8, entries.length, true); // entries on this disk
  ev.setUint16(10, entries.length, true); // entries in total
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true); // central directory offset

  const out = new Uint8Array(offset + centralSize + end.length);
  let pos = 0;
  for (const part of [...locals, ...centrals, end]) {
    out.set(part, pos);
    pos += part.length;
  }
  return out;
}

/** The archive as a Blob ready to download. */
export function zipBlob(entries: ZipEntry[]): Blob {
  return new Blob([zipBytes(entries) as Uint8Array<ArrayBuffer>], { type: 'application/zip' });
}

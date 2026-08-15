/*
 * Read a few files out of a very large remote ZIP, without downloading it.
 *
 * The Jupiter-4 audio lives in GitHub release assets that total about ten gigabytes — Bass alone
 * is 627 MB and Pads is 3.2 GB across four parts. APL Beats needs perhaps thirty AIFF files out
 * of that. Downloading 7 GB to keep 30 MB would make the preparation pipeline something nobody
 * would ever run twice, which is the same as it not being reproducible.
 *
 * A ZIP is readable from the end: the End of Central Directory record points at a central
 * directory that lists every entry with its offset and compressed size. GitHub's asset host
 * answers `Range` requests with 206, so three small reads — the tail, the directory, and then the
 * bytes of each wanted entry — are enough. Fetching one bass note costs about 300 KB rather than
 * 627 MB.
 *
 * Two wrinkles this handles:
 *
 *   **Split archives.** Four of the six categories are published as `.001`, `.002` … which are a
 *   plain byte-split of one ZIP rather than a true spanned archive. So the parts are treated as
 *   one contiguous stream and a global offset is mapped onto (part, offset within part), with
 *   reads allowed to straddle a boundary.
 *
 *   **Data descriptors.** An entry written by a streaming zipper may declare zero sizes in its
 *   local header. The central directory is authoritative and is what this reads, so the local
 *   header is used only to find where the data starts.
 *
 * Nothing here is clever about compression: it handles stored and deflated entries, which is
 * everything these archives contain.
 */

import { inflateRawSync } from 'node:zlib';

const EOCD_SIGNATURE = 0x06054b50;
const EOCD64_LOCATOR = 0x07064b50;
const EOCD64_SIGNATURE = 0x06064b50;
const CENTRAL_SIGNATURE = 0x02014b50;

/** How far back from the end to look for the End of Central Directory record. */
const TAIL_BYTES = 128 * 1024;

/**
 * A ZIP made of one or more remote parts, addressed as a single byte stream.
 *
 * `parts` are given in order with their exact sizes, which the release metadata already knows —
 * so no request is needed merely to discover how long anything is.
 */
export class RemoteZip {
  /** @param {{url: string, size: number}[]} parts */
  constructor(parts) {
    this.parts = parts;
    this.total = parts.reduce((sum, part) => sum + part.size, 0);
    /** Bytes actually pulled over the network, so a pipeline can report its own cost. */
    this.bytesRead = 0;
    /** @type {Map<string, {offset: number, compressedSize: number, size: number, method: number}>} */
    this.entries = new Map();
  }

  /**
   * Bytes `[from, from + length)` of the concatenated archive.
   *
   * Straddles part boundaries, because a central directory that happens to begin near the end of
   * `.003` is not a special case worth failing on.
   */
  async read(from, length) {
    const chunks = [];
    let cursor = 0;
    let want = length;
    let at = from;

    for (const part of this.parts) {
      const partEnd = cursor + part.size;
      if (at < partEnd && want > 0) {
        const start = at - cursor;
        const take = Math.min(want, part.size - start);
        chunks.push(await fetchRange(part.url, start, start + take - 1));
        this.bytesRead += take;
        at += take;
        want -= take;
      }
      cursor = partEnd;
      if (want <= 0) break;
    }

    return Buffer.concat(chunks);
  }

  /** Read the central directory. One or two small requests, whatever the archive weighs. */
  async open() {
    const tailLength = Math.min(TAIL_BYTES, this.total);
    const tail = await this.read(this.total - tailLength, tailLength);

    let eocd = -1;
    for (let at = tail.length - 22; at >= 0; at -= 1) {
      if (tail.readUInt32LE(at) === EOCD_SIGNATURE) {
        eocd = at;
        break;
      }
    }
    if (eocd === -1) throw new Error('no End of Central Directory record in the archive tail');

    let directoryOffset = tail.readUInt32LE(eocd + 16);
    let directorySize = tail.readUInt32LE(eocd + 12);
    let count = tail.readUInt16LE(eocd + 10);

    /*
     * ZIP64, which these archives need: a 627 MB member is fine in 32 bits but a 3.2 GB archive
     * is not, so the real offsets live in a ZIP64 record and the classic fields are 0xFFFFFFFF.
     */
    if (directoryOffset === 0xffffffff || directorySize === 0xffffffff || count === 0xffff) {
      let locator = -1;
      for (let at = eocd - 20; at >= 0; at -= 1) {
        if (tail.readUInt32LE(at) === EOCD64_LOCATOR) {
          locator = at;
          break;
        }
      }
      if (locator === -1) throw new Error('the archive needs ZIP64 but has no locator');

      const zip64At = Number(tail.readBigUInt64LE(locator + 8));
      const zip64 = await this.read(zip64At, 56);
      if (zip64.readUInt32LE(0) !== EOCD64_SIGNATURE) throw new Error('bad ZIP64 end record');

      count = Number(zip64.readBigUInt64LE(32));
      directorySize = Number(zip64.readBigUInt64LE(40));
      directoryOffset = Number(zip64.readBigUInt64LE(48));
    }

    const directory = await this.read(directoryOffset, directorySize);
    let at = 0;
    for (let index = 0; index < count; index += 1) {
      if (directory.readUInt32LE(at) !== CENTRAL_SIGNATURE) break;

      const method = directory.readUInt16LE(at + 10);
      let compressedSize = directory.readUInt32LE(at + 20);
      let size = directory.readUInt32LE(at + 24);
      const nameLength = directory.readUInt16LE(at + 28);
      const extraLength = directory.readUInt16LE(at + 30);
      const commentLength = directory.readUInt16LE(at + 32);
      let offset = directory.readUInt32LE(at + 42);
      const name = directory.subarray(at + 46, at + 46 + nameLength).toString('utf8');

      // ZIP64 extended information, when any of the classic fields overflowed.
      if (size === 0xffffffff || compressedSize === 0xffffffff || offset === 0xffffffff) {
        const extra = directory.subarray(at + 46 + nameLength, at + 46 + nameLength + extraLength);
        let scan = 0;
        while (scan + 4 <= extra.length) {
          const tag = extra.readUInt16LE(scan);
          const length = extra.readUInt16LE(scan + 2);
          if (tag === 0x0001) {
            let field = scan + 4;
            if (size === 0xffffffff) {
              size = Number(extra.readBigUInt64LE(field));
              field += 8;
            }
            if (compressedSize === 0xffffffff) {
              compressedSize = Number(extra.readBigUInt64LE(field));
              field += 8;
            }
            if (offset === 0xffffffff) offset = Number(extra.readBigUInt64LE(field));
            break;
          }
          scan += 4 + length;
        }
      }

      this.entries.set(name, { offset, compressedSize, size, method });
      at += 46 + nameLength + extraLength + commentLength;
    }

    return this.entries;
  }

  /** One entry's bytes. Two requests: its local header, then its data. */
  async extract(name) {
    const entry = this.entries.get(name);
    if (entry === undefined) throw new Error(`no such entry: ${name}`);

    // The local header repeats the name and may carry different extra fields, so its true length
    // has to be read rather than assumed from the central directory.
    const header = await this.read(entry.offset, 30);
    const nameLength = header.readUInt16LE(26);
    const extraLength = header.readUInt16LE(28);

    const data = await this.read(entry.offset + 30 + nameLength + extraLength, entry.compressedSize);

    if (entry.method === 0) return data;
    if (entry.method === 8) return inflateRawSync(data);
    throw new Error(`${name}: unsupported compression method ${String(entry.method)}`);
  }
}

/** One ranged GET, following GitHub's redirect to its asset host. */
async function fetchRange(url, from, to) {
  const response = await fetch(url, { headers: { Range: `bytes=${String(from)}-${String(to)}` } });
  if (response.status !== 206) {
    throw new Error(
      `expected 206 for ${url} bytes ${String(from)}-${String(to)}, got ${String(response.status)}`,
    );
  }
  return Buffer.from(await response.arrayBuffer());
}

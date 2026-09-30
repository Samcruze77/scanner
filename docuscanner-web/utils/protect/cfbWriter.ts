// A minimal writer for the OLE / Compound File Binary container ([MS-CFB], version 3,
// 512-byte sectors) that Office wraps around an encrypted document. It writes only what
// an encrypted Office file needs: storages and streams, no timestamps or CLSIDs.
//
// Written by hand (rather than with a general library) so the file contains exactly the
// streams Word's own encrypted files contain and nothing else; the output is checked by
// reading it back with an independent reader (the `cfb` package) and by other Office
// decryptors in the tests.

const SECTOR = 512;
const MINI = 64;
const MINI_CUTOFF = 4096;
const FAT_PER_SECTOR = SECTOR / 4; // 128
const ENDOFCHAIN = 0xfffffffe;
const FATSECT = 0xfffffffd;
const DIFSECT = 0xfffffffc;
const FREESECT = 0xffffffff;
const NOSTREAM = 0xffffffff;

export interface CfbNode {
  name: string;
  // Present for a stream; absent for a storage.
  data?: Uint8Array;
  children?: CfbNode[];
}

interface Entry {
  name: string;
  type: 1 | 2 | 5;
  data?: Uint8Array;
  children: Entry[];
  left: number;
  right: number;
  child: number;
  color: 0 | 1; // 0 red, 1 black
  start: number;
  size: number;
}

// [MS-CFB] 2.6.4: shorter names sort first, then by upper-cased UTF-16 code units.
function compareNames(a: string, b: string): number {
  if (a.length !== b.length) return a.length - b.length;
  const ua = a.toUpperCase();
  const ub = b.toUpperCase();
  return ua < ub ? -1 : ua > ub ? 1 : 0;
}

export function writeCfb(root: CfbNode): Uint8Array {
  // 1. Flatten into directory entries, root first.
  const entries: Entry[] = [];
  const make = (node: CfbNode, type: 1 | 2 | 5): Entry => {
    const entry: Entry = { name: node.name, type, data: node.data, children: [], left: NOSTREAM, right: NOSTREAM, child: NOSTREAM, color: 1, start: ENDOFCHAIN, size: node.data?.length ?? 0 };
    entries.push(entry);
    return entry;
  };
  const rootEntry = make(root, 5);
  const walk = (node: CfbNode, entry: Entry) => {
    for (const c of node.children ?? []) {
      const e = make(c, c.data ? 2 : 1);
      entry.children.push(e);
      walk(c, e);
    }
  };
  walk(root, rootEntry);
  const index = new Map(entries.map((e, i) => [e, i]));

  // 2. Each storage's children form a binary search tree; a size-balanced tree whose
  //    incomplete bottom level is red is a valid red-black tree.
  const link = (list: Entry[]): number => {
    if (list.length === 0) return NOSTREAM;
    const sorted = [...list].sort((x, y) => compareNames(x.name, y.name));
    const bottomStart = 2 ** Math.floor(Math.log2(sorted.length)) - 1; // nodes in the full levels
    const build = (lo: number, hi: number, depth: number): number => {
      if (lo > hi) return NOSTREAM;
      const mid = (lo + hi + 1) >> 1;
      const e = sorted[mid];
      e.left = build(lo, mid - 1, depth + 1);
      e.right = build(mid + 1, hi, depth + 1);
      return index.get(e)!;
    };
    const rootId = build(0, sorted.length - 1, 0);
    // Colour: depth of each node, then the last level red only when it is incomplete.
    const depthOf = new Map<Entry, number>();
    const measure = (id: number, d: number) => {
      if (id === NOSTREAM) return;
      const e = entries[id];
      depthOf.set(e, d);
      measure(e.left, d + 1);
      measure(e.right, d + 1);
    };
    measure(rootId, 0);
    const maxDepth = Math.max(...depthOf.values());
    const full = sorted.length === 2 ** (maxDepth + 1) - 1;
    void bottomStart;
    for (const [e, d] of depthOf) e.color = !full && d === maxDepth ? 0 : 1;
    return rootId;
  };
  for (const e of entries) if (e.type !== 2) e.child = link(e.children);

  // 3. Lay out data: small streams in the mini stream, the rest in regular sectors.
  const sectorsFor = (bytes: number, size: number) => Math.ceil(bytes / size);
  const small = entries.filter((e) => e.type === 2 && e.size > 0 && e.size < MINI_CUTOFF);
  const big = entries.filter((e) => e.type === 2 && e.size >= MINI_CUTOFF);

  const miniFat: number[] = [];
  let miniCount = 0;
  for (const e of small) {
    const n = sectorsFor(e.size, MINI);
    e.start = miniCount;
    for (let i = 0; i < n; i++) miniFat.push(i === n - 1 ? ENDOFCHAIN : miniCount + i + 1);
    miniCount += n;
  }
  const miniStream = new Uint8Array(miniCount * MINI);
  for (const e of small) miniStream.set(e.data!, e.start * MINI);

  const miniStreamSectors = sectorsFor(miniStream.length, SECTOR);
  const miniFatSectors = sectorsFor(miniFat.length * 4, SECTOR);
  const dirSectors = sectorsFor(entries.length, 4);
  const bigSectors = big.map((e) => sectorsFor(e.size, SECTOR));
  const dataSectors = miniStreamSectors + miniFatSectors + dirSectors + bigSectors.reduce((a, b) => a + b, 0);

  // FAT and DIFAT sectors are themselves sectors: solve for how many are needed.
  let fatSectors = 0;
  let difSectors = 0;
  for (;;) {
    const total = dataSectors + fatSectors + difSectors;
    const needFat = sectorsFor(total, FAT_PER_SECTOR);
    const needDif = needFat > 109 ? sectorsFor(needFat - 109, FAT_PER_SECTOR - 1) : 0;
    if (needFat === fatSectors && needDif === difSectors) break;
    fatSectors = needFat;
    difSectors = needDif;
  }
  const totalSectors = dataSectors + fatSectors + difSectors;

  // Sector numbers: mini stream, mini FAT, directory, big streams, FAT, DIFAT.
  let next = 0;
  const take = (n: number) => {
    const first = next;
    next += n;
    return first;
  };
  const miniStreamStart = miniStreamSectors ? take(miniStreamSectors) : ENDOFCHAIN;
  const miniFatStart = miniFatSectors ? take(miniFatSectors) : ENDOFCHAIN;
  const dirStart = take(dirSectors);
  big.forEach((e, i) => {
    e.start = take(bigSectors[i]);
  });
  const fatStart = take(fatSectors);
  const difStart = difSectors ? take(difSectors) : ENDOFCHAIN;

  rootEntry.start = miniStreamStart;
  rootEntry.size = miniStream.length;

  const fat = new Uint32Array(fatSectors * FAT_PER_SECTOR).fill(FREESECT);
  const chain = (start: number, count: number) => {
    for (let i = 0; i < count; i++) fat[start + i] = i === count - 1 ? ENDOFCHAIN : start + i + 1;
  };
  if (miniStreamSectors) chain(miniStreamStart, miniStreamSectors);
  if (miniFatSectors) chain(miniFatStart, miniFatSectors);
  chain(dirStart, dirSectors);
  big.forEach((e, i) => chain(e.start, bigSectors[i]));
  for (let i = 0; i < fatSectors; i++) fat[fatStart + i] = FATSECT;
  for (let i = 0; i < difSectors; i++) fat[difStart + i] = DIFSECT;

  // 4. Write the file.
  const out = new Uint8Array(SECTOR + totalSectors * SECTOR);
  const view = new DataView(out.buffer);
  const at = (sector: number) => SECTOR + sector * SECTOR;

  // Header ([MS-CFB] 2.2).
  out.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], 0);
  view.setUint16(24, 0x003e, true); // minor version
  view.setUint16(26, 3, true); // major version
  view.setUint16(28, 0xfffe, true); // little-endian
  view.setUint16(30, 9, true); // sector shift (512)
  view.setUint16(32, 6, true); // mini sector shift (64)
  view.setUint32(44, fatSectors, true);
  view.setUint32(48, dirStart, true);
  view.setUint32(56, MINI_CUTOFF, true);
  view.setUint32(60, miniFatStart, true);
  view.setUint32(64, miniFatSectors, true);
  view.setUint32(68, difStart, true);
  view.setUint32(72, difSectors, true);
  for (let i = 0; i < 109; i++) view.setUint32(76 + i * 4, i < fatSectors ? fatStart + i : FREESECT, true);

  // DIFAT sectors hold the FAT sector numbers beyond the first 109, then a link to the next.
  for (let d = 0; d < difSectors; d++) {
    const base = at(difStart + d);
    for (let i = 0; i < FAT_PER_SECTOR - 1; i++) {
      const fatIndex = 109 + d * (FAT_PER_SECTOR - 1) + i;
      view.setUint32(base + i * 4, fatIndex < fatSectors ? fatStart + fatIndex : FREESECT, true);
    }
    view.setUint32(base + (FAT_PER_SECTOR - 1) * 4, d === difSectors - 1 ? ENDOFCHAIN : difStart + d + 1, true);
  }

  for (let i = 0; i < fat.length; i++) view.setUint32(at(fatStart) + i * 4, fat[i], true);
  if (miniStreamSectors) out.set(miniStream, at(miniStreamStart));
  for (let i = 0; i < miniFatSectors * FAT_PER_SECTOR; i++) view.setUint32(at(miniFatStart) + i * 4, i < miniFat.length ? miniFat[i] : FREESECT, true);
  for (const e of big) out.set(e.data!, at(e.start));

  // Directory: 128 bytes per entry; unused slots are marked NOSTREAM.
  for (let i = 0; i < dirSectors * 4; i++) {
    const base = at(dirStart) + i * 128;
    const e = entries[i];
    if (!e) {
      view.setUint32(base + 68, NOSTREAM, true);
      view.setUint32(base + 72, NOSTREAM, true);
      view.setUint32(base + 76, NOSTREAM, true);
      continue;
    }
    for (let c = 0; c < e.name.length; c++) view.setUint16(base + c * 2, e.name.charCodeAt(c), true);
    view.setUint16(base + 64, (e.name.length + 1) * 2, true);
    out[base + 66] = e.type;
    out[base + 67] = e.color;
    view.setUint32(base + 68, e.left, true);
    view.setUint32(base + 72, e.right, true);
    view.setUint32(base + 76, e.child, true);
    view.setUint32(base + 116, e.size === 0 && e.type !== 5 ? 0 : e.start, true);
    view.setUint32(base + 120, e.size, true);
  }
  return out;
}

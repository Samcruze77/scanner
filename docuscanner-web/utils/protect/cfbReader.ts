// A small, strict reader for the OLE / Compound File Binary container ([MS-CFB]) that an
// encrypted Office file is. It returns each stream as a VIEW into the input whenever the
// stream is stored contiguously (which is how encrypted Office files are written), so a
// 50 MB encrypted package is never copied or turned into a JavaScript array.
//
// (The general-purpose `cfb` package was used for this before, but in browsers it rebuilds
// every stream as a plain number array, about eight times the size of the data. It is still
// used in the tests, as an independent reader to check this one and the writer against.)
//
// Reads what Word writes and what ./cfbWriter.ts writes: version 3 (512-byte sectors) and
// version 4 (4096-byte sectors) containers. Anything malformed throws.

const ENDOFCHAIN = 0xfffffffe;
const FREESECT = 0xffffffff;
const NOSTREAM = 0xffffffff;
const MAX_SECTORS = 1 << 24;

export function readCfb(file: Uint8Array): Map<string, Uint8Array> {
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  const bad = (): never => {
    throw new Error("bad container");
  };
  if (file.length < 512) bad();
  [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1].forEach((b, i) => file[i] === b || bad());
  if (view.getUint16(28, true) !== 0xfffe) bad();
  const major = view.getUint16(26, true);
  const sectorShift = view.getUint16(30, true);
  if ((major !== 3 || sectorShift !== 9) && (major !== 4 || sectorShift !== 12)) bad();
  if (view.getUint16(32, true) !== 6) bad();
  const sectorSize = 1 << sectorShift;
  const perSector = sectorSize / 4;
  // Sector n starts after the header, which occupies one sector's worth of space.
  const at = (sector: number) => {
    if (sector >= MAX_SECTORS || (sector + 2) * sectorSize > file.length) bad();
    return (sector + 1) * sectorSize;
  };

  const fatSectors = view.getUint32(44, true);
  const firstDir = view.getUint32(48, true);
  const cutoff = view.getUint32(56, true);
  const firstMiniFat = view.getUint32(60, true);
  const miniFatSectors = view.getUint32(64, true);
  let difSector = view.getUint32(68, true);
  const difSectors = view.getUint32(72, true);
  if (fatSectors === 0 || fatSectors > MAX_SECTORS) bad();

  // The list of FAT sectors: 109 in the header, the rest in DIFAT sectors.
  const fatList: number[] = [];
  for (let i = 0; i < 109 && fatList.length < fatSectors; i++) fatList.push(view.getUint32(76 + i * 4, true));
  for (let d = 0; d < difSectors && fatList.length < fatSectors; d++) {
    if (difSector === ENDOFCHAIN || difSector === FREESECT) bad();
    const base = at(difSector);
    for (let i = 0; i < perSector - 1 && fatList.length < fatSectors; i++) fatList.push(view.getUint32(base + i * 4, true));
    difSector = view.getUint32(base + (perSector - 1) * 4, true);
  }
  if (fatList.length !== fatSectors) bad();
  const fat = new Uint32Array(fatSectors * perSector);
  fatList.forEach((sector, n) => {
    const base = at(sector);
    for (let i = 0; i < perSector; i++) fat[n * perSector + i] = view.getUint32(base + i * 4, true);
  });

  // Follows a chain, returning its sectors in order (and refusing loops).
  const chain = (start: number, table: Uint32Array): number[] => {
    const out: number[] = [];
    let s = start;
    while (s !== ENDOFCHAIN) {
      if (s >= table.length || out.length > table.length) bad();
      out.push(s);
      s = table[s];
    }
    return out;
  };
  // The bytes of a chain of regular sectors: a view when they are consecutive, else a copy.
  const read = (sectors: number[], length: number): Uint8Array => {
    if (sectors.length === 0) return new Uint8Array(0);
    if (length > sectors.length * sectorSize) bad();
    const consecutive = sectors.every((s, i) => i === 0 || s === sectors[i - 1] + 1);
    if (consecutive) {
      const start = at(sectors[0]);
      if (start + length > file.length) bad();
      return file.subarray(start, start + length);
    }
    const out = new Uint8Array(length);
    sectors.forEach((s, i) => {
      const from = at(s);
      out.set(file.subarray(from, from + Math.min(sectorSize, length - i * sectorSize)), i * sectorSize);
    });
    return out;
  };

  // Directory.
  const dirSectors = chain(firstDir, fat);
  const dir = read(dirSectors, dirSectors.length * sectorSize);
  const dirView = new DataView(dir.buffer, dir.byteOffset, dir.byteLength);
  interface Node {
    name: string;
    type: number;
    left: number;
    right: number;
    child: number;
    start: number;
    size: number;
  }
  const nodes: Node[] = [];
  for (let i = 0; i < dir.length / 128; i++) {
    const base = i * 128;
    const nameLength = dirView.getUint16(base + 64, true);
    if (nameLength > 64) bad();
    let name = "";
    for (let c = 0; c < Math.max(0, nameLength / 2 - 1); c++) name += String.fromCharCode(dirView.getUint16(base + c * 2, true));
    const low = dirView.getUint32(base + 120, true);
    const high = dirView.getUint32(base + 124, true);
    if (major === 3 && high !== 0) bad();
    nodes.push({ name, type: dir[base + 66], left: dirView.getUint32(base + 68, true), right: dirView.getUint32(base + 72, true), child: dirView.getUint32(base + 76, true), start: dirView.getUint32(base + 116, true), size: low + high * 2 ** 32 });
  }
  if (nodes[0]?.type !== 5) bad();

  // Mini stream (small streams live inside it).
  let miniFat = new Uint32Array(0);
  if (miniFatSectors > 0) {
    const bytes = read(chain(firstMiniFat, fat), miniFatSectors * sectorSize);
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    miniFat = new Uint32Array(bytes.length / 4);
    for (let i = 0; i < miniFat.length; i++) miniFat[i] = v.getUint32(i * 4, true);
  }
  const root = nodes[0];
  const miniStream = root.size > 0 ? read(chain(root.start, fat), root.size) : new Uint8Array(0);
  const readMini = (n: Node): Uint8Array => {
    const sectors = chain(n.start, miniFat);
    if (n.size > sectors.length * 64) bad();
    const consecutive = sectors.every((s, i) => i === 0 || s === sectors[i - 1] + 1);
    if (consecutive) return miniStream.subarray(sectors[0] * 64, sectors[0] * 64 + n.size);
    const out = new Uint8Array(n.size);
    sectors.forEach((s, i) => out.set(miniStream.subarray(s * 64, s * 64 + Math.min(64, n.size - i * 64)), i * 64));
    return out;
  };

  // Walk the tree of storages and collect every stream by path.
  const streams = new Map<string, Uint8Array>();
  const seen = new Set<number>();
  const visit = (id: number, prefix: string) => {
    if (id === NOSTREAM) return;
    if (id >= nodes.length || seen.has(id)) bad();
    seen.add(id);
    const n = nodes[id];
    visit(n.left, prefix);
    visit(n.right, prefix);
    const path = prefix ? `${prefix}/${n.name}` : n.name;
    if (n.type === 2) streams.set(path, n.size === 0 ? new Uint8Array(0) : n.size < cutoff ? readMini(n) : read(chain(n.start, fat), n.size));
    else if (n.type === 1) visit(n.child, path);
    else bad();
  };
  visit(root.child, "");
  return streams;
}

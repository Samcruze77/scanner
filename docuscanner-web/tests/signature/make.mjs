// Fixtures for the signature-upload test: a coloured page (so transparency is
// visible), a transparent PNG signature and a JPG signature on white.
import fs from "node:fs";
import sharp from "sharp";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
const dir = new URL(".", import.meta.url).pathname.replace(/^\//, "");
const pdf = await PDFDocument.create();
const page = pdf.addPage([595, 842]);
page.drawRectangle({ x: 0, y: 0, width: 595, height: 842, color: rgb(1, 0.91, 0.66) });
const font = await pdf.embedFont(StandardFonts.Helvetica);
page.drawText("Agreement - please sign below", { x: 60, y: 760, size: 20, font });
fs.writeFileSync(dir + "yellow.pdf", await pdf.save());
const stroke = (color) => `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="200"><path d="M20 140 C 70 20, 120 20, 150 110 S 230 190, 260 90 S 330 20, 380 120 S 470 170, 580 60" fill="none" stroke="${color}" stroke-width="9" stroke-linecap="round"/></svg>`;
await sharp(Buffer.from(stroke("#0b2a8a"))).png().toFile(dir + "sig-transparent.png");
await sharp({ create: { width: 600, height: 200, channels: 3, background: "#ffffff" } }).composite([{ input: Buffer.from(stroke("#111111")) }]).jpeg({ quality: 90 }).toFile(dir + "sig-white.jpg");
console.log("ok", fs.readdirSync(dir));

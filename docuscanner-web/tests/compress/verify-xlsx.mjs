import fs from "node:fs";
import ExcelJS from "exceljs";
import JSZip from "jszip";
const [origPath, compPath] = process.argv.slice(2);
const o = new ExcelJS.Workbook(); await o.xlsx.readFile(origPath);
const c = new ExcelJS.Workbook(); await c.xlsx.readFile(compPath);
let cells = 0, diff = 0;
for (const ws of o.worksheets) {
  const w2 = c.getWorksheet(ws.name);
  ws.eachRow({ includeEmpty: false }, (row, r) => row.eachCell({ includeEmpty: false }, (cell, col) => {
    cells++;
    const x = w2.getCell(r, col);
    if (JSON.stringify(x.value) !== JSON.stringify(cell.value) || JSON.stringify(x.style) !== JSON.stringify(cell.style)) { diff++; console.log("  differs", ws.name, cell.address); }
  }));
}
console.log(`sheets ${o.worksheets.map((w) => w.name)} -> ${c.worksheets.map((w) => w.name)}; cells compared ${cells}, different ${diff}; images ${o.getWorksheet("Sales").getImages().length} -> ${c.getWorksheet("Sales").getImages().length}; formula D3=${JSON.stringify(c.getWorksheet("Sales").getCell("D3").value)}`);
const za = await JSZip.loadAsync(fs.readFileSync(origPath)), zb = await JSZip.loadAsync(fs.readFileSync(compPath));
let same = true;
for (const n of Object.keys(za.files)) { if (za.files[n].dir || /\.(png|jpe?g)$/i.test(n)) continue; if ((await za.file(n).async("string")) !== (await zb.file(n).async("string"))) { same = false; console.log("  xml changed:", n); } }
console.log("entries same:", JSON.stringify(Object.keys(za.files)) === JSON.stringify(Object.keys(zb.files)), "| all XML parts identical:", same);

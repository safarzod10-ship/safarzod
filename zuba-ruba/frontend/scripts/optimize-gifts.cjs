const fs = require("fs");
const path = require("path");

const dir = path.resolve(__dirname, "..", "public", "gifts");

function round(value) {
  if (typeof value === "number") {
    if (Number.isInteger(value)) return value;
    const abs = Math.abs(value);
    const digits = abs >= 100 ? 1 : abs >= 1 ? 2 : 3;
    return Number(value.toFixed(digits));
  }
  if (Array.isArray(value)) return value.map(round);
  if (value && typeof value === "object") {
    const result = {};
    for (const [key, item] of Object.entries(value)) {
      if (key === "nm" || key === "mn" || key === "cl" || key === "ln") continue;
      result[key] = round(item);
    }
    return result;
  }
  return value;
}

let before = 0;
let after = 0;
for (const file of fs.readdirSync(dir).filter((name) => name.endsWith(".json"))) {
  const full = path.join(dir, file);
  const source = fs.readFileSync(full, "utf8");
  const output = JSON.stringify(round(JSON.parse(source)));
  before += source.length;
  after += output.length;
  fs.writeFileSync(full, output);
}
console.log(`gifts: ${(before / 1024).toFixed(0)} KB -> ${(after / 1024).toFixed(0)} KB`);

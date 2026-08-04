/** Copy the static parts of the demo next to the bundle esbuild produced. */
import { copyFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";

await mkdir("public", { recursive: true });

const pages = [
  "index.html",
  "app.css",
  "deck.html",
  "deck.css",
  "demo.html",
  "demo.css",
  "video.html",
  "video.css",
];

for (const file of pages) {
  await copyFile(`web/${file}`, `public/${file}`);
  console.log(`copied web/${file} -> public/${file}`);
}

/*
 * The rendered video and its poster live in media/ rather than being produced
 * at build time: rendering needs live chain access, and a deploy that depends
 * on a public RPC being reachable is a deploy that fails at the worst moment.
 */
const assets = [
  ["media/arc-units-demo.mp4", "public/arc-units-demo.mp4"],
  ["media/poster.png", "public/poster.png"],
];

for (const [from, to] of assets) {
  if (!existsSync(from)) {
    console.warn(`missing ${from} — run \`npm run video\` to regenerate it`);
    continue;
  }
  await copyFile(from, to);
  console.log(`copied ${from} -> ${to}`);
}

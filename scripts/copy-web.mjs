/** Copy the static parts of the demo next to the bundle esbuild produced. */
import { copyFile, mkdir } from "node:fs/promises";

await mkdir("public", { recursive: true });
for (const file of ["index.html", "app.css", "deck.html", "deck.css", "demo.html", "demo.css"]) {
  await copyFile(`web/${file}`, `public/${file}`);
  console.log(`copied web/${file} -> public/${file}`);
}

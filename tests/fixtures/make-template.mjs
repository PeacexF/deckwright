// A small university-style template built from scratch (the real ones can't go in a public repo):
// a master with a logo block, a rule, a title placeholder and a large slide number in the corner.
import pptxgen from "pptxgenjs";
import sharp from "sharp";

export async function makeTemplate(out) {
  const p = new pptxgen();
  p.layout = "LAYOUT_WIDE";
  const logo = await sharp({ create: { width: 400, height: 160, channels: 3, background: "#B0122B" } })
    .png()
    .toBuffer();
  p.defineSlideMaster({
    title: "Только заголовок",
    background: { color: "FFFFFF" },
    objects: [
      { image: { x: 11.2, y: 0.3, w: 1.6, h: 0.64, data: `data:image/png;base64,${logo.toString("base64")}` } },
      { line: { x: 0, y: 6.9, w: 10.5, h: 0, line: { color: "111111", width: 2 } } },
      {
        placeholder: {
          options: { name: "title", type: "title", x: 0.9, y: 0.6, w: 9.7, h: 1.2, fontFace: "Arial", fontSize: 30 },
          text: "",
        },
      },
    ],
    slideNumber: { x: 11.0, y: 6.3, w: 1.9, h: 1.0, fontFace: "Arial", fontSize: 54, color: "BBBBBB" },
  });
  p.addSlide({ masterName: "Только заголовок" }).addText("Пример", { placeholder: "title" });
  await p.writeFile({ fileName: out });
  return out;
}

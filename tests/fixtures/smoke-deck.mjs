// Minimal deck exercising every feature the pipeline must round-trip:
// Cyrillic text, bullets, image, shapes, native chart, table, hyperlink, speaker notes.
import pptxgen from "pptxgenjs";
import sharp from "sharp";

export const SLIDES = 4;

export async function buildSmokeDeck(out) {
  const pptx = new pptxgen();
  pptx.layout = "LAYOUT_WIDE"; // 13.333 x 7.5 in
  const ink = "1A2433",
    accent = "C4272F",
    pale = "EDF0F4";

  const s1 = pptx.addSlide();
  s1.background = { color: "0F3D73" };
  s1.addText("Монголия: тестовая презентация", {
    x: 0.75,
    y: 2.6,
    w: 11.8,
    h: 1.2,
    fontFace: "Arial",
    fontSize: 40,
    bold: true,
    color: "FFFFFF",
  });
  s1.addText("Проверка кириллицы, фигур, диаграмм и заметок", {
    x: 0.75,
    y: 3.8,
    w: 11.8,
    h: 0.6,
    fontFace: "Arial",
    fontSize: 20,
    color: "B9C8DC",
  });
  s1.addNotes("Заметки докладчика: титульный слайд.");

  const s2 = pptx.addSlide();
  s2.addText("Текст, маркеры и изображение", {
    x: 0.75,
    y: 0.5,
    w: 11.8,
    h: 0.8,
    fontFace: "Arial",
    fontSize: 30,
    color: ink,
  });
  s2.addText(
    [
      { text: "Площадь — 1,56 млн км² (18-е место в мире)", options: { bullet: true } },
      { text: "Население — 3,59 млн человек (2025)", options: { bullet: true } },
      {
        text: "Источник: Национальный статистический комитет",
        options: { bullet: true, hyperlink: { url: "https://www.1212.mn" } },
      },
    ],
    { x: 0.75, y: 1.6, w: 6, h: 2.5, fontFace: "Arial", fontSize: 18, color: ink, paraSpaceAfter: 8 },
  );
  const img = await sharp({ create: { width: 800, height: 500, channels: 3, background: "#5677A3" } })
    .jpeg()
    .toBuffer();
  s2.addImage({ data: `data:image/jpeg;base64,${img.toString("base64")}`, x: 7.3, y: 1.6, w: 5.3, h: 3.3 });
  s2.addShape(pptx.ShapeType.rect, { x: 0.75, y: 5.3, w: 11.8, h: 1.2, fill: { color: pale }, line: { color: pale } });
  s2.addShape(pptx.ShapeType.ellipse, {
    x: 1.0,
    y: 5.5,
    w: 0.8,
    h: 0.8,
    fill: { color: accent },
    line: { color: accent },
  });
  s2.addText("1", {
    x: 1.0,
    y: 5.5,
    w: 0.8,
    h: 0.8,
    align: "center",
    valign: "middle",
    fontFace: "Arial",
    fontSize: 22,
    bold: true,
    color: "FFFFFF",
  });
  s2.addNotes("Заметки: список, картинка, фигуры.");

  const s3 = pptx.addSlide();
  s3.addText("Нативная диаграмма", { x: 0.75, y: 0.5, w: 11.8, h: 0.8, fontFace: "Arial", fontSize: 30, color: ink });
  s3.addChart(
    pptx.ChartType.bar,
    [
      {
        name: "Поголовье, млн",
        labels: ["Овцы", "Козы", "КРС", "Лошади", "Верблюды"],
        values: [23.9, 23.2, 5.5, 5.1, 0.5],
      },
    ],
    {
      x: 0.75,
      y: 1.5,
      w: 11.8,
      h: 5.2,
      barDir: "bar",
      chartColors: ["0F3D73"],
      showValue: true,
      dataLabelFontSize: 12,
      catAxisLabelFontSize: 14,
      valAxisHidden: true,
      valGridLine: { style: "none" },
      catAxisLabelFontFace: "Arial",
    },
  );
  s3.addNotes("Заметки: диаграмма.");

  const s4 = pptx.addSlide();
  s4.addText("Таблица", { x: 0.75, y: 0.5, w: 11.8, h: 0.8, fontFace: "Arial", fontSize: 30, color: ink });
  const head = { bold: true, color: "FFFFFF", fill: { color: "0F3D73" } };
  s4.addTable(
    [
      [
        { text: "Показатель", options: head },
        { text: "Значение", options: head },
        { text: "Год", options: head },
      ],
      ["ВВП", "25,4 млрд $", "2025"],
      ["Инфляция", "8,6 %", "2025"],
      ["Госдолг, % ВВП", "44,5 %", "2024"],
    ],
    {
      x: 0.75,
      y: 1.6,
      w: 11.8,
      colW: [5.8, 3.5, 2.5],
      fontFace: "Arial",
      fontSize: 16,
      color: ink,
      border: { type: "solid", color: "D3DAE3", pt: 1 },
    },
  );
  s4.addNotes("Заметки: таблица.");

  await pptx.writeFile({ fileName: out });
  return out;
}

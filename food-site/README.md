# 禾序食品 · 官网前端

A single-page website for a future food company, built in the style of apple.com:
full-bleed product tiles with large headlines and pill buttons, a swipeable
highlights gallery, a product comparison table, and a footnoted footer.

"禾序" is a placeholder brand name. Every product, price, nutrition figure and batch
record on the page is example data.

Sections:

- **产品**: tiles for oat milk, NFC cold-pressed juice, whole-wheat toast and daily nuts.
  The packaging is drawn in SVG, so no image files are needed.
- **配料**: compares the oat milk's 3 ingredients with a typical oat drink's 10.
- **亮点**: swipeable cards (origin, process, sterilisation, packaging, traceability).
- **对比**: the 原味, 咖啡师 and 零糖 variants side by side.
- **营养成分**: a nutrition facts table laid out per GB 28050. The tabs switch between
  variants.
- **溯源**: enter a batch code such as `HX20261020A` (HX + production date + line
  A–D) to see a sample timeline from harvest to best-before date.
- **上市**: a launch notice with an email form. The form is not connected to a backend.

Open `index.html` in a browser. To rebrand, replace "禾序" in the page text and in the
SVG labels.

// Builds a small, valid PDF, so tests exercise real parsing. Pass no lines for a page with no text.
export function buildPdf(pages: string[][]) {
  const objects: string[] = [];
  const add = (body: string) => objects.push(body) - 1 + 1;

  const catalog = add("<< /Type /Catalog /Pages 2 0 R >>");
  const pagesId = add("");
  const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");

  const kids = pages.map((lines) => {
    const body = lines
      .map((line, index) => `BT /F1 12 Tf 72 ${720 - index * 16} Td (${line.replace(/[()\\]/g, "\\$&")}) Tj ET`)
      .join("\n");
    const content = add(`<< /Length ${body.length} >>\nstream\n${body}\nendstream`);
    return add(
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`,
    );
  });
  objects[pagesId - 1] = `<< /Type /Pages /Kids [${kids.map((id) => `${id} 0 R`).join(" ")}] /Count ${kids.length} >>`;

  let output = "%PDF-1.4\n";
  const offsets = objects.map((body, index) => {
    const offset = output.length;
    output += `${index + 1} 0 obj\n${body}\nendobj\n`;
    return offset;
  });

  const xref = output.length;
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  output += offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  output += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

  return Buffer.from(output, "latin1");
}

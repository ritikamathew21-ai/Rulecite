import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { contrastRatio } from "@/lib/analysis/contrast";
import { runDeterministicChecks } from "@/lib/analysis/deterministic";
import { applyFixes } from "@/lib/documents/apply-fixes";
import { IntakeError, MAX_UPLOAD_BYTES, parseDocx, parsePdf, parseText, readDocumentXml } from "@/lib/analysis/intake";
import { countSyllables, findTerm, normaliseText, readingGrade, splitSentences } from "@/lib/analysis/text";
import type { ApprovedRule, ParsedDocument } from "@/lib/analysis/types";
import { buildPdf } from "./fixtures/pdf";

const rule = (overrides: Partial<ApprovedRule>): ApprovedRule => ({
  id: "rule-id",
  code: "TST-01",
  version: 3,
  type: "tone",
  severity: "medium",
  title: "Test rule",
  instruction: "Follow this.",
  source_excerpt: "Fictional excerpt.",
  source_name: "Fictional guide",
  config: {},
  ...overrides,
});

const terminology = rule({
  code: "TERM-12",
  type: "terminology",
  config: { preferred: "Zentra Wallet", variants: ["e-wallet", "wallet"] },
});
const banned = rule({ code: "BAN-03", type: "banned_phrase", severity: "high", config: { phrases: ["risk-free"] } });
const plain = (text: string): ParsedDocument => ({ text, images: [], colours: [] });

describe("text helpers", () => {
  it("normalises line endings and spaces", () => {
    expect(normaliseText("  one\r\ntwo three \n")).toBe("one\ntwo three");
  });

  it("matches whole terms only, in any case, with exact offsets", () => {
    const text = "An E-Wallet, not ewallets or re-e-wallets.";
    expect(findTerm(text, "e-wallet")).toEqual([{ quote: "E-Wallet", start: 3, end: 11 }]);
  });

  it("treats special characters literally", () => {
    expect(findTerm("It is 100% safe.", "100% safe")).toHaveLength(1);
    expect(findTerm("abc", "a.c")).toEqual([]);
  });

  it("splits sentences with offsets that match the text", () => {
    const text = "First one. Second one!\nThird";
    for (const { quote, start, end } of splitSentences(text)) expect(text.slice(start, end)).toBe(quote);
    expect(splitSentences(text).map(({ quote }) => quote)).toEqual(["First one.", "Second one!", "Third"]);
  });

  it("estimates syllables", () => {
    expect(countSyllables("cat")).toBe(1);
    expect(countSyllables("table")).toBe(2);
    expect(countSyllables("wallet")).toBe(2);
  });

  it("gives harder text a higher grade", () => {
    const easy = "The cat sat. The dog ran. We had fun.";
    const hard = "Institutional stakeholders systematically underestimate organisational complexity.";
    expect(readingGrade(hard)).toBeGreaterThan(readingGrade(easy));
  });
});

describe("contrastRatio", () => {
  it("matches known WCAG values", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 1);
    expect(contrastRatio("#FFFFFF", "#FFFFFF")).toBeCloseTo(1, 5);
    expect(contrastRatio("#777777", "#FFFFFF")).toBeCloseTo(4.48, 1);
  });
});

describe("runDeterministicChecks", () => {
  it("flags a term with exact offsets, a fix and a full citation", () => {
    const text = "Try the new e-wallet today.";
    const [found, ...rest] = runDeterministicChecks(plain(text), [terminology], []);
    expect(rest).toEqual([]);
    expect(found).toMatchObject({
      origin: "rule",
      category: "terminology",
      severity: "medium",
      quote: "e-wallet",
      suggestion: 'Replace it with "Zentra Wallet".',
      replacement: "Zentra Wallet",
      citation: { code: "TERM-12", version: 3, source_excerpt: "Fictional excerpt.", source_name: "Fictional guide" },
    });
    expect(text.slice(found.start!, found.end!)).toBe("e-wallet");
  });

  it("does not flag a variant inside the approved term", () => {
    expect(runDeterministicChecks(plain("Open your Zentra Wallet."), [terminology], [])).toEqual([]);
  });

  it("flags every occurrence of a banned phrase, with no automatic fix", () => {
    const found = runDeterministicChecks(plain("Risk-free now. Still risk-free."), [banned], []);
    expect(found.map(({ quote }) => quote)).toEqual(["Risk-free", "risk-free"]);
    expect(found.every(({ replacement }) => replacement === null)).toBe(true);
  });

  it("returns nothing for clean text", () => {
    expect(runDeterministicChecks(plain("Pay your bills with Zentra Wallet."), [terminology, banned], [])).toEqual([]);
  });

  it("leaves tone, messaging and claims to AI checks", () => {
    const rules = [rule({ type: "tone" }), rule({ type: "messaging" }), rule({ type: "claim" })];
    expect(runDeterministicChecks(plain("The best e-wallet."), rules, [])).toEqual([]);
  });

  it("flags long sentences and a high reading grade, but not short text", () => {
    const readability = rule({ code: "READ-01", type: "readability" });
    const hard = Array.from({ length: 8 }, () => "Institutional stakeholders systematically underestimate organisational complexity considerably.").join(" ");
    const found = runDeterministicChecks(plain(hard), [readability], []);
    expect(found[0]).toMatchObject({ quote: null, category: "readability" });
    expect(found[0].explanation).toContain("approximate");
    expect(runDeterministicChecks(plain("Institutional complexity."), [readability], [])).toEqual([]);

    const long = `${"word ".repeat(31).trim()}.`;
    expect(runDeterministicChecks(plain(long), [readability], [])[0].quote).toBe(long);
  });

  it("honours a rule's own grade target", () => {
    const text = Array.from({ length: 8 }, () => "We help people pay their bills on time every month.").join(" ");
    const strict = rule({ type: "readability", config: { maxGrade: 1 } });
    const relaxed = rule({ type: "readability", config: { maxGrade: 20 } });
    expect(runDeterministicChecks(plain(text), [strict], [])).toHaveLength(1);
    expect(runDeterministicChecks(plain(text), [relaxed], [])).toEqual([]);
  });

  it("flags images without alt text", () => {
    const document = { ...plain("Text"), images: [{ name: "Hero", alt: " " }, { name: "Logo", alt: "Zentra logo" }] };
    const found = runDeterministicChecks(document, [rule({ code: "ACC-01", type: "accessibility" })], []);
    expect(found).toHaveLength(1);
    expect(found[0].explanation).toContain("Hero");
  });

  it("flags low contrast, using white when no background is set", () => {
    const document = {
      ...plain("Pale words and dark words"),
      colours: [
        { text: "Pale words", colour: "#CCCCCC", background: null },
        { text: "dark words", colour: "#111111", background: null },
        { text: "Pale words", colour: "#FFFFFF", background: "#000000" },
      ],
    };
    const found = runDeterministicChecks(document, [rule({ type: "contrast" })], []);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ quote: "Pale words", start: 0, end: 10 });
    expect(found[0].explanation).toContain("1.6:1");
  });

  it("flags colours outside the palette, and skips the check with no palette", () => {
    const document = { ...plain("Off brand"), colours: [{ text: "Off brand", colour: "#FF00FF", background: null }] };
    const visual = rule({ code: "VIS-02", type: "visual" });
    expect(runDeterministicChecks(document, [visual], ["#2B2D8C"])[0].explanation).toContain("#FF00FF");
    expect(runDeterministicChecks(document, [visual], ["#FF00FF"])).toEqual([]);
    expect(runDeterministicChecks(document, [visual], [])).toEqual([]);
  });

  it("keeps a copy of the rule, so later edits cannot change the finding", () => {
    const original = rule({ type: "banned_phrase", config: { phrases: ["risk-free"] } });
    const [found] = runDeterministicChecks(plain("risk-free"), [original], []);
    original.title = "Changed later";
    expect(found.citation.title).toBe("Test rule");
  });
});

describe("applyFixes", () => {
  const text = "Our e-wallet is risk-free.";
  const walletFix = { start: 4, end: 12, quote: "e-wallet", replacement: "Zentra Wallet" };
  const riskFix = { start: 16, end: 25, quote: "risk-free", replacement: "low-risk" };

  it("applies several fixes in any order, keeping offsets correct", () => {
    const expected = { text: "Our Zentra Wallet is low-risk.", applied: 2 };
    expect(applyFixes(text, [walletFix, riskFix])).toEqual(expected);
    expect(applyFixes(text, [riskFix, walletFix])).toEqual(expected);
  });

  it("skips a fix whose quote no longer matches", () => {
    expect(applyFixes(text, [{ ...walletFix, quote: "wallet" }])).toEqual({ text, applied: 0 });
  });

  it("skips an overlapping fix", () => {
    const overlapping = { start: 8, end: 12, quote: "llet", replacement: "X" };
    expect(applyFixes(text, [walletFix, overlapping]).applied).toBe(1);
  });

  it("does nothing with no fixes", () => {
    expect(applyFixes(text, [])).toEqual({ text, applied: 0 });
  });
});

describe("parseText", () => {
  it("normalises valid text", () => {
    expect(parseText(" Hello\r\nworld ").text).toBe("Hello\nworld");
  });

  it.each([
    ["empty text", "   ", "Enter some text"],
    ["oversized text", "x".repeat(50_001), "too long"],
  ])("rejects %s", (_name, value, message) => {
    expect(() => parseText(value)).toThrow(IntakeError);
    expect(() => parseText(value)).toThrow(message);
  });
});

const documentXml = (body: string) =>
  `<?xml version="1.0"?><w:document xmlns:w="w" xmlns:wp="wp"><w:body>${body}</w:body></w:document>`;

const docx = async (body: string) => {
  const zip = new JSZip();
  zip.file("word/document.xml", documentXml(body));
  return zip.generateAsync({ type: "arraybuffer" });
};

describe("readDocumentXml", () => {
  it("joins runs, separates paragraphs and decodes entities", () => {
    const xml = documentXml(
      '<w:p><w:r><w:t>Fees &amp; </w:t></w:r><w:r><w:t xml:space="preserve">limits</w:t></w:r></w:p><w:p><w:r><w:t>Second &#8377;5</w:t></w:r></w:p>',
    );
    expect(readDocumentXml(xml).text).toBe("Fees & limits\nSecond ₹5");
  });

  it("does not read deleted tracked text", () => {
    const xml = documentXml("<w:p><w:r><w:t>Kept</w:t></w:r><w:del><w:r><w:delText>Removed</w:delText></w:r></w:del></w:p>");
    expect(readDocumentXml(xml).text).toBe("Kept");
  });

  it("reads images with and without alt text", () => {
    const xml = documentXml(
      '<w:p><w:r><w:t>Text</w:t></w:r></w:p><wp:docPr id="1" name="Hero"/><wp:docPr id="2" name="Logo" descr="Zentra &amp; logo"/>',
    );
    expect(readDocumentXml(xml).images).toEqual([
      { name: "Hero", alt: "" },
      { name: "Logo", alt: "Zentra & logo" },
    ]);
  });

  it("reads text and background colours, ignoring automatic colour", () => {
    const xml = documentXml(
      '<w:p><w:r><w:rPr><w:color w:val="ff00ff"/><w:shd w:val="clear" w:fill="000000"/></w:rPr><w:t>Bright</w:t></w:r>' +
        '<w:r><w:rPr><w:color w:val="auto"/></w:rPr><w:t>Auto</w:t></w:r><w:r><w:t>Plain</w:t></w:r></w:p>',
    );
    expect(readDocumentXml(xml).colours).toEqual([{ text: "Bright", colour: "#FF00FF", background: "#000000" }]);
  });
});

describe("parseDocx", () => {
  it("reads a valid file", async () => {
    const parsed = await parseDocx(await docx("<w:p><w:r><w:t>Hello</w:t></w:r></w:p>"));
    expect(parsed.text).toBe("Hello");
  });

  it("rejects an empty file", async () => {
    await expect(parseDocx(new ArrayBuffer(0))).rejects.toThrow("empty");
  });

  it("rejects an oversized file", async () => {
    await expect(parseDocx(new ArrayBuffer(MAX_UPLOAD_BYTES + 1))).rejects.toThrow("too large");
  });

  it("rejects a file that is not a zip", async () => {
    await expect(parseDocx(new TextEncoder().encode("not a zip").buffer as ArrayBuffer)).rejects.toThrow(IntakeError);
  });

  it("rejects a zip that is not a Word document", async () => {
    const zip = new JSZip();
    zip.file("notes.txt", "hello");
    await expect(parseDocx(await zip.generateAsync({ type: "arraybuffer" }))).rejects.toThrow("not a Word document");
  });

  it("rejects a document with no text", async () => {
    await expect(parseDocx(await docx("<w:p></w:p>"))).rejects.toThrow("no text");
  });

  it("stops reading a compressed bomb", async () => {
    const zip = new JSZip();
    zip.file("word/document.xml", "x".repeat(21 * 1024 * 1024));
    const file = await zip.generateAsync({ type: "arraybuffer", compression: "DEFLATE" });
    expect(file.byteLength).toBeLessThan(MAX_UPLOAD_BYTES);
    await expect(parseDocx(file)).rejects.toThrow("too large to read");
  });
});

const pdfBytes = (pages: string[][]) => {
  const buffer = buildPdf(pages);
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
};

describe("parsePdf", () => {
  it("reads text from a real PDF, across pages", async () => {
    const parsed = await parsePdf(pdfBytes([["Try the new e-wallet."], ["It is risk-free."]]));
    expect(parsed.text).toContain("Try the new e-wallet.");
    expect(parsed.text).toContain("It is risk-free.");
    expect(parsed.images).toEqual([]);
    expect(parsed.colours).toEqual([]);
  });

  it("feeds the same checks as other formats", async () => {
    const parsed = await parsePdf(pdfBytes([["Try the new e-wallet."]]));
    const [found] = runDeterministicChecks(parsed, [terminology], []);
    expect(parsed.text.slice(found.start!, found.end!)).toBe("e-wallet");
  });

  it("rejects a scanned PDF with no text", async () => {
    await expect(parsePdf(pdfBytes([[]]))).rejects.toThrow("no readable text");
  });

  it("rejects too many pages", async () => {
    const pages = Array.from({ length: 101 }, () => ["Page"]);
    await expect(parsePdf(pdfBytes(pages))).rejects.toThrow("too many pages");
  });

  it("rejects a file that is not a PDF", async () => {
    await expect(parsePdf(new TextEncoder().encode("hello world").buffer as ArrayBuffer)).rejects.toThrow("not a PDF");
  });

  it("rejects a damaged PDF", async () => {
    await expect(parsePdf(new TextEncoder().encode("%PDF-1.4 damaged").buffer as ArrayBuffer)).rejects.toThrow(IntakeError);
  });

  it("rejects empty and oversized files", async () => {
    await expect(parsePdf(new ArrayBuffer(0))).rejects.toThrow("empty");
    await expect(parsePdf(new ArrayBuffer(MAX_UPLOAD_BYTES + 1))).rejects.toThrow("too large");
  });
});

describe("code checks stay independent of AI", () => {
  it("never import an AI module", () => {
    const dir = "src/lib/analysis/deterministic";
    for (const file of readdirSync(dir)) {
      expect(readFileSync(join(dir, file), "utf8")).not.toMatch(/@google\/genai|@\/lib\/ai|gemini/i);
    }
  });
});

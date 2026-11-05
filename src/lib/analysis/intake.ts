import JSZip from "jszip";
import { MAX_TEXT_LENGTH, normaliseText } from "@/lib/analysis/text";
import type { DocumentImage, ParsedDocument, TextColour } from "@/lib/analysis/types";

// Vercel rejects request bodies over 4.5 MB.
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
const MAX_DOCUMENT_XML_BYTES = 20 * 1024 * 1024;

export class IntakeError extends Error {}

const TOO_LONG = `This document is too long. The limit is ${MAX_TEXT_LENGTH.toLocaleString("en-IN")} characters.`;

export function parseText(input: string): ParsedDocument {
  const text = normaliseText(input);
  if (!text) throw new IntakeError("Enter some text to check.");
  if (text.length > MAX_TEXT_LENGTH) throw new IntakeError(TOO_LONG);
  return { text, images: [], colours: [] };
}

const decodeXml = (value: string) =>
  value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");

const attribute = (tag: string, name: string) => {
  const match = new RegExp(`\\b${name}="([^"]*)"`).exec(tag);
  return match ? decodeXml(match[1]) : "";
};

const runText = (run: string) =>
  [...run.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\/>|<w:br\/>/g)]
    .map((match) => (match[1] !== undefined ? decodeXml(match[1]) : match[0] === "<w:tab/>" ? "\t" : "\n"))
    .join("");

const hexColour = (value: string) => (/^[0-9a-f]{6}$/i.test(value) ? `#${value.toUpperCase()}` : null);

function readRun(run: string): TextColour | null {
  const properties = /<w:rPr>([\s\S]*?)<\/w:rPr>/.exec(run)?.[1] ?? "";
  const colourTag = /<w:color\s[^>]*\/>/.exec(properties)?.[0];
  const colour = colourTag ? hexColour(attribute(colourTag, "w:val")) : null;
  if (!colour) return null;
  const text = runText(run).trim();
  if (!text) return null;
  const shadingTag = /<w:shd\s[^>]*\/>/.exec(properties)?.[0];
  return { text, colour, background: shadingTag ? hexColour(attribute(shadingTag, "w:fill")) : null };
}

// shortcut: reads the main body only, not headers, footers, footnotes or text boxes. Add them if users need them.
export function readDocumentXml(xml: string): ParsedDocument {
  const paragraphs = xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) ?? [];
  const runs = paragraphs.flatMap((paragraph) => paragraph.match(/<w:r[ >][\s\S]*?<\/w:r>/g) ?? []);

  const text = normaliseText(
    paragraphs.map((paragraph) => (paragraph.match(/<w:r[ >][\s\S]*?<\/w:r>/g) ?? []).map(runText).join("")).join("\n"),
  );
  const images: DocumentImage[] = (xml.match(/<wp:docPr\s[^>]*\/?>/g) ?? []).map((tag) => ({
    name: attribute(tag, "name") || "Unnamed image",
    alt: attribute(tag, "descr"),
  }));
  const colours = runs.map(readRun).filter((run) => run !== null);

  return { text, images, colours };
}

export async function parseDocx(file: ArrayBuffer): Promise<ParsedDocument> {
  if (file.byteLength === 0) throw new IntakeError("This file is empty.");
  if (file.byteLength > MAX_UPLOAD_BYTES) throw new IntakeError("This file is too large. The limit is 4 MB.");

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(file);
  } catch {
    throw new IntakeError("This file could not be read. Upload a .docx file that is not password protected.");
  }

  const entry = zip.file("word/document.xml");
  if (!entry) throw new IntakeError("This file is not a Word document. Upload a .docx file.");

  // Stops reading as soon as the limit is passed, so a compressed bomb cannot fill memory.
  const chunks: Buffer[] = [];
  let size = 0;
  const xml = await new Promise<string>((resolve, reject) => {
    const stream = entry.nodeStream();
    stream.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_DOCUMENT_XML_BYTES) {
        stream.pause();
        reject(new IntakeError("This document is too large to read."));
        return;
      }
      chunks.push(chunk);
    });
    stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    stream.on("error", () => reject(new IntakeError("This file could not be read.")));
  });

  const parsed = readDocumentXml(xml);
  if (!parsed.text) throw new IntakeError("This document has no text to check.");
  if (parsed.text.length > MAX_TEXT_LENGTH) throw new IntakeError(TOO_LONG);
  return parsed;
}

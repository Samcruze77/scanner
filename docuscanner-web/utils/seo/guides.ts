// How-to guides. Each answers a question people genuinely search for, gives advice that
// helps whether or not they use PDFScanner, and ends at the tool that does the job.
// There are deliberately few: a guide is only added when there is a real workflow
// question to answer, never to catch another keyword.
//
// Product facts (limits, options) match the tools themselves; see utils/seo/landing.ts.

import type { RelatedLink } from "./landing";

export interface GuideSection {
  h2: string;
  paragraphs?: string[];
  steps?: string[];
  bullets?: string[];
}

export interface Guide {
  slug: string;
  title: string; // before the site-name template
  description: string;
  h1: string;
  intro: string;
  // ISO dates; only change `updated` when the guide's content really changes.
  published: string;
  updated: string;
  sections: GuideSection[];
  tool: { href: string; label: string; blurb: string };
  related: RelatedLink[];
}

export const GUIDES: Guide[] = [
  {
    slug: "how-to-scan-a-document-to-pdf",
    title: "How to Scan a Document to PDF (Phone or Computer)",
    description:
      "Scan a paper document to a clean PDF with your phone camera or by uploading photos. Step-by-step instructions plus lighting, framing and cleanup tips.",
    h1: "How to scan a document to PDF",
    intro:
      "You do not need a flatbed scanner or an app to turn paper into a PDF. A phone camera and a browser are enough, and a few small habits make the result look like it came from a real scanner.",
    published: "2026-09-21",
    updated: "2026-09-21",
    sections: [
      {
        h2: "What you need",
        paragraphs: [
          "A phone or computer with a camera (or photos you have already taken), a flat surface, and decent light. That is all. PDFScanner runs in your browser, so there is nothing to install.",
        ],
      },
      {
        h2: "Scan a document to PDF, step by step",
        steps: [
          "Open the PDFScanner scanner in your browser and choose Use camera. Allow camera access when your browser asks. If you already have photos, choose Upload document instead.",
          "Photograph the first page, then the next. Each photo becomes one page. PDFScanner finds the edges of the paper and straightens it for you.",
          "Check each page. If an edge is wrong, open the page and use Adjust crop to drag the corners. Rotate the page if it is sideways.",
          "Pick a look for text pages: Auto for most documents, Black & White for high-contrast text, Grayscale to keep some tone. Adjust brightness and contrast if the page looks dull.",
          "Reorder or remove pages with the arrow and bin buttons, then choose Create PDF and download it.",
        ],
      },
      {
        h2: "Get a clearer scan",
        bullets: [
          "Use even light. Daylight from a window works well; avoid a shadow from your hand or phone falling across the page.",
          "Put the page on a plain surface that contrasts with the paper, such as white paper on a dark table. Edge detection depends on that contrast.",
          "Hold the phone directly above the page, parallel to it, and fill the frame without cutting off the edges.",
          "Keep the camera steady and let it focus before you capture. A sharp photo reads better than a large one.",
          "Photograph pages one at a time rather than a stack or a book spread, unless you plan to crop each half separately.",
        ],
      },
      {
        h2: "Scanning several pages into one PDF",
        paragraphs: [
          "Keep adding pages before you create the PDF. They appear in the strip under the preview in the order you added them. Select a page to move it earlier or later, or to remove it. When you create the PDF, all pages are combined into a single file.",
        ],
      },
      {
        h2: "Make the PDF easier to use",
        paragraphs: [
          "A PDF made from photos is a set of page images, so the words are not selectable and the file can be large. Two follow-ups help. If you need to copy the words, run text recognition (OCR) on the pages. If the file is too big to email, use the PDF compressor and check the size estimate before you commit.",
        ],
      },
      {
        h2: "Common problems",
        bullets: [
          "The camera will not open: check that your browser has camera permission for the site, that no other app is using the camera, and that the page is loaded over https.",
          "The page is cropped wrongly: use Adjust crop and drag the four corners to the paper's corners, or choose Whole page.",
          "The scan is too dark or has a shadow: retake it in brighter, more even light, or raise brightness and contrast.",
          "You only have a photo of one half of a page: crop it to the part you need and add the other half as another page.",
        ],
      },
    ],
    tool: {
      href: "/scan",
      label: "Scan a document to PDF now",
      blurb: "Free, no account, and your pages stay in your browser.",
    },
    related: [
      { href: "/tools/ocr", label: "Extract text with OCR", note: "Copy the words from your scan." },
      { href: "/tools/compress-pdf", label: "Compress a PDF", note: "Make the finished file smaller." },
      { href: "/tools/sign-pdf", label: "Sign a PDF online", note: "Add your signature to a scanned form." },
    ],
  },
  {
    slug: "how-to-reduce-pdf-file-size",
    title: "How to Reduce PDF File Size Without Ruining Quality",
    description:
      "Why PDFs get big, what actually makes them smaller, and how to compress a PDF for email or upload while keeping it readable.",
    h1: "How to reduce a PDF's file size",
    intro:
      "A PDF that is too big to email is almost always full of pictures. Shrinking those pictures is what makes the file smaller, and doing it carefully keeps the document readable.",
    published: "2026-09-21",
    updated: "2026-09-21",
    sections: [
      {
        h2: "Why some PDFs are so large",
        paragraphs: [
          "Text is tiny. Pictures are not. A PDF made from scans or photos stores every page as an image, so a ten-page scan can be many megabytes while a fifty-page text report can be a few hundred kilobytes. That is why the amount you can save depends mostly on what is inside the file.",
          "A PDF that is mostly text is already compact, and no honest tool will shrink it much. A PDF that is mostly pictures can shrink a lot.",
        ],
      },
      {
        h2: "Compress a PDF step by step",
        steps: [
          "Open the PDF compressor and choose your file (up to 100 MB).",
          "Move the slider between higher quality and a smaller file. The estimated size updates as you move it, so you can see the trade-off before you compress.",
          "Choose Compress PDF, then compare the result. Download it if the pages still look good.",
          "If it is not small enough, go back and pick a stronger level. Your original file is never changed.",
        ],
      },
      {
        h2: "Aim for a specific size",
        paragraphs: [
          "Some forms and email systems have a hard limit, such as 2 MB. Under More options you can enter a target size. PDFScanner picks the lightest level that fits, and says so if it cannot reach the target without ruining the pages.",
        ],
      },
      {
        h2: "Keeping the text selectable",
        paragraphs: [
          "The normal levels recompress the pictures and leave the text alone, so you can still select and search it. The optional stronger compression redraws every page as a picture at a lower resolution. The file gets much smaller, but the text can no longer be selected or searched, so use it only when you must.",
        ],
      },
      {
        h2: "Make smaller PDFs from the start",
        bullets: [
          "When you scan, choose Auto or Black & White for text pages. A high-contrast page compresses far better than a full-colour photo of it.",
          "Crop away the table and background around a scanned page.",
          "Avoid putting many full-resolution photos into a document when small ones will do.",
          "If a scan has been through several rounds of editing, going back to the original photos usually gives a smaller, cleaner result.",
        ],
      },
      {
        h2: "Check before you send",
        paragraphs: [
          "Zoom in on the smallest text and on any signature or stamp. If you can read it comfortably, the quality is fine. If not, choose a lighter level and accept a slightly larger file.",
        ],
      },
    ],
    tool: {
      href: "/tools/compress-pdf",
      label: "Compress a PDF now",
      blurb: "See the estimated size first. Free, and your file is not uploaded.",
    },
    related: [
      { href: "/tools/compress-image", label: "Compress an image", note: "Shrink a single photo." },
      { href: "/scan", label: "Scan a document to PDF", note: "Start with a cleaner, smaller scan." },
      { href: "/convert/image-to-pdf", label: "Convert images to PDF", note: "Combine photos into one PDF." },
    ],
  },
  {
    slug: "how-to-extract-text-from-a-scanned-pdf",
    title: "How to Extract Text From a Scanned PDF or Image",
    description:
      "A scanned PDF is a picture of text. Here is how OCR turns it into words you can copy, what affects accuracy, and how to check the result.",
    h1: "How to extract text from a scanned PDF or image",
    intro:
      "If you cannot select the words in a PDF, it is a picture of a page, not text. Optical character recognition (OCR) reads that picture and gives you the words back.",
    published: "2026-09-21",
    updated: "2026-09-21",
    sections: [
      {
        h2: "Why you cannot copy text from a scan",
        paragraphs: [
          "A scanner or camera records what the page looks like, not what it says. The result is an image, so there are no characters to select or search. OCR software looks at the shapes in the image and works out which letters they are.",
        ],
      },
      {
        h2: "Extract the text, step by step",
        steps: [
          "Open the OCR tool and upload your scanned PDF or a photo of the page.",
          "If the page is crooked or has a border, open it and use Adjust crop and Rotate first. Straight, tight pages read better.",
          "Under More options, choose Extract text. The first time, the text engine has to load, so give it a moment.",
          "Read the result in the Extracted text panel. It is editable: fix any mistakes, and use the search box to find a word.",
          "Choose Copy text and paste it wherever you need it.",
        ],
      },
      {
        h2: "What makes OCR more accurate",
        bullets: [
          "A sharp, well-lit photo. Blur and shadows cause most errors.",
          "A straight page. Text on a tilt or a curve, such as a book spine, reads poorly.",
          "High contrast. Try Black & White or Auto enhancement in the page editor before you extract.",
          "Standard printed fonts. Handwriting, very small print and decorative fonts are much less reliable.",
        ],
      },
      {
        h2: "Limits to know about",
        bullets: [
          "PDFScanner's free OCR reads English only, and up to 30 pages in one run.",
          "It runs in your browser, so a large batch on an older phone can be slow. Extract fewer pages at a time if it struggles.",
          "The text is shown for you to copy. It is not added to the PDF as a hidden layer, so the PDF itself is not made searchable.",
        ],
      },
      {
        h2: "Always check the important parts",
        paragraphs: [
          "OCR makes small mistakes: a zero read as the letter O, a one read as a lowercase L. Check names, amounts, dates and reference numbers against the original before you rely on them.",
        ],
      },
      {
        h2: "If you want an editable document instead",
        paragraphs: [
          "If you need the whole document in Word rather than just its text, convert the PDF to Word. Scanned pages are read with the same English text recognition.",
        ],
      },
    ],
    tool: {
      href: "/tools/ocr",
      label: "Extract text from a PDF or image",
      blurb: "Free OCR that runs in your browser. Nothing is uploaded.",
    },
    related: [
      { href: "/convert/pdf-to-word", label: "Convert PDF to Word", note: "Get an editable .docx." },
      { href: "/scan", label: "Scan a document to PDF", note: "Make a cleaner scan first." },
      { href: "/convert/pdf-to-excel", label: "Convert PDF to Excel", note: "Pull tables out of a PDF." },
    ],
  },
  {
    slug: "how-to-sign-a-pdf-online",
    title: "How to Sign a PDF Online Without Printing It",
    description:
      "Add your signature to a PDF from your phone or computer: draw, type or upload it, place it on the line, and download the signed file.",
    h1: "How to sign a PDF online",
    intro:
      "Printing, signing and scanning a form again is a lot of effort for one signature. You can place a signature straight onto the PDF instead.",
    published: "2026-09-21",
    updated: "2026-09-21",
    sections: [
      {
        h2: "Sign a PDF, step by step",
        steps: [
          "Open the PDF signer and choose your PDF. A photo of a paper document works too.",
          "Open the page that needs your signature.",
          "Choose the signature tool, then draw your signature with your finger, mouse or pen, type your name, or upload a picture of your signature.",
          "Drag the signature onto the signature line and drag its corner dot to resize it. Zoom in if you want to line it up precisely.",
          "Tap Done, then create and download the signed PDF.",
        ],
      },
      {
        h2: "Three ways to make a signature",
        bullets: [
          "Draw it. Quick, and it looks like your real signature. A finger on a phone works, but a stylus or mouse is usually neater.",
          "Type it. Useful when you only need your name in a signature style.",
          "Upload it. Sign a white sheet of paper, photograph it in good light, and upload the picture. A PNG with a transparent background places cleanly over the page.",
        ],
      },
      {
        h2: "Reuse your signature",
        paragraphs: [
          "If you tick the option to save your signature on this device, it is kept in this browser only, never uploaded, so you do not have to draw it again next time. You can remove it whenever you like.",
        ],
      },
      {
        h2: "Is this signature legally valid?",
        paragraphs: [
          "That depends on the document and where you are. What you add here is an image of your signature placed on the page, the same as signing on paper. It is not a certificate-based digital signature, and PDFScanner cannot give legal advice. If the person or organisation asking for your signature requires a specific e-signature service or a certified signature, check with them first.",
        ],
      },
      {
        h2: "Tips for a good result",
        bullets: [
          "Sign on the line, not over the printed text.",
          "Keep the signature about the size of your handwriting on paper.",
          "Sign every page that needs it; your last signature is offered again so you do not need to redraw it.",
          "Open the finished PDF and check every signature before you send it.",
        ],
      },
    ],
    tool: {
      href: "/tools/sign-pdf",
      label: "Sign a PDF now",
      blurb: "Free, no account, and your file stays in your browser.",
    },
    related: [
      { href: "/tools/annotate", label: "Annotate a PDF", note: "Add text, dates and check marks too." },
      { href: "/tools/pdf-editor", label: "Edit a PDF online", note: "Crop, rotate and reorder pages." },
      { href: "/tools/compress-pdf", label: "Compress a PDF", note: "Shrink the signed file before you send it." },
    ],
  },
  {
    slug: "how-to-convert-images-to-pdf",
    title: "How to Convert Images to PDF (JPG, PNG and More)",
    description:
      "Combine photos, screenshots and pictures into one PDF: add them, put them in order, crop or enhance, and download. Free and private.",
    h1: "How to convert images to PDF",
    intro:
      "Turning JPG, PNG and other pictures into a single PDF is the easiest way to send several photos as one tidy file.",
    published: "2026-09-21",
    updated: "2026-09-21",
    sections: [
      {
        h2: "Convert images to PDF, step by step",
        steps: [
          "Open the image to PDF converter and choose Upload document. You can select several images at once.",
          "Each image appears as a page. Use the arrows to put the pages in the right order.",
          "Open any page to crop it, rotate it, or change the look. Auto or Black & White suits photographed documents.",
          "Choose Create PDF and download it.",
        ],
      },
      {
        h2: "How the pages are laid out",
        paragraphs: [
          "Each image becomes one A4 page. The picture is fitted inside the page and centred without being cropped or stretched, so a portrait photo and a landscape photo both fit. Pages are kept at roughly 170 DPI for A4, which is good for reading and printing ordinary documents.",
        ],
      },
      {
        h2: "Tips",
        bullets: [
          "Crop first. Trimming empty space around a photographed page makes the text larger on the PDF page.",
          "Check the order before you create the PDF; changing it afterwards means making the file again.",
          "Screenshots and pictures with flat colours convert cleanly; photographs of paper look best with Auto enhancement.",
          "If the PDF is too big to send, compress it afterwards and check the size estimate first.",
        ],
      },
      {
        h2: "Good to know",
        bullets: [
          "Images can be up to 25 MB each.",
          "The PDF is made of images, so its text is not selectable. Use OCR if you need the words as text.",
          "Everything happens in your browser, so your pictures are not uploaded.",
          "Very large batches depend on your device's memory. If your browser slows down, convert fewer images at a time.",
        ],
      },
    ],
    tool: {
      href: "/convert/image-to-pdf",
      label: "Convert images to PDF now",
      blurb: "Free and private. Your pictures never leave your browser.",
    },
    related: [
      { href: "/scan", label: "Scan a document to PDF", note: "Use your camera instead of files." },
      { href: "/tools/compress-pdf", label: "Compress a PDF", note: "Make the combined PDF smaller." },
      { href: "/tools/ocr", label: "Extract text with OCR", note: "Copy words from the pictures." },
    ],
  },
];

export function getGuide(slug: string): Guide | undefined {
  return GUIDES.find((g) => g.slug === slug);
}

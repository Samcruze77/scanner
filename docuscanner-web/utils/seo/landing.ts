// The public landing pages and what each one says.
//
// Every entry is a page that really does the thing it is about (or is the hub that
// leads to it), and each has its own explanation: what it does, how it works, what
// files it takes, its honest limits, and what happens to the person's document.
// Nothing here is templated by swapping a keyword, and nothing is hidden: it is all
// rendered as ordinary visible text under the tool (components/seo/SeoContent.tsx).
//
// Facts come from the product itself (see the limits in utils/*): file-size and page
// limits, English-only OCR, image-based exported PDFs. If a limit changes there, change
// it here too.

export interface RelatedLink {
  href: string;
  // The link text: describes where it goes, in plain words.
  label: string;
  // One short line on why someone would go there next.
  note: string;
}

export interface FaqItem {
  q: string;
  a: string;
}

export interface Crumb {
  name: string;
  path: string;
}

export interface LandingPage {
  path: string;
  // <title> without the site name (added by the title template).
  title: string;
  description: string;
  h1: string;
  intro: string;
  crumbs: Crumb[];
  // Structured data: what the app is called and what it can really do.
  appName: string;
  features: string[];
  how: string[];
  // Who and what it is good for.
  goodFor: string;
  formats: string;
  limits: string[];
  privacy: string;
  faq: FaqItem[];
  related: RelatedLink[];
}

// Shared wording so the privacy promise is identical, and true, everywhere.
const PRIVATE =
  "Your file is processed in your browser, on your own device. It is not uploaded to PDFScanner's servers. PDFScanner counts basic usage, such as which tool was opened, but never sees what is inside your document.";

const LINKS = {
  scan: { href: "/scan", label: "Scan a document to PDF", note: "Photograph or upload pages and export one PDF." },
  editor: { href: "/tools/pdf-editor", label: "Edit a PDF online", note: "Crop, rotate, reorder pages and add text or a signature." },
  sign: { href: "/tools/sign-pdf", label: "Sign a PDF online", note: "Draw, type or upload your signature." },
  annotate: { href: "/tools/annotate", label: "Annotate a PDF", note: "Text, highlights, drawings and check marks." },
  ocr: { href: "/tools/ocr", label: "Extract text with OCR", note: "Read text from scans and photos." },
  compressPdf: { href: "/tools/compress-pdf", label: "Compress a PDF", note: "Make a PDF smaller to email or upload." },
  compressWord: { href: "/tools/compress-word", label: "Compress a Word document", note: "Shrink the pictures inside a .docx." },
  compressExcel: { href: "/tools/compress-excel", label: "Compress an Excel file", note: "Shrink the pictures inside an .xlsx." },
  compressImage: { href: "/tools/compress-image", label: "Compress an image", note: "Reduce a photo's file size." },
  imageToPdf: { href: "/convert/image-to-pdf", label: "Convert images to PDF", note: "Turn photos and pictures into one PDF." },
  wordToPdf: { href: "/convert/word-to-pdf", label: "Convert Word to PDF", note: "Turn a .docx file into a PDF." },
  pdfToWord: { href: "/convert/pdf-to-word", label: "Convert PDF to Word", note: "Get an editable .docx from a PDF." },
  excelToPdf: { href: "/convert/excel-to-pdf", label: "Convert Excel to PDF", note: "Turn a spreadsheet into a tidy PDF." },
  pdfToExcel: { href: "/convert/pdf-to-excel", label: "Convert PDF to Excel", note: "Pull tables out of a PDF." },
  convert: { href: "/convert", label: "All file converters", note: "Word, Excel, CSV, images and PDF." },
  tools: { href: "/tools", label: "All PDF tools", note: "Edit, sign, compress and extract text." },
} satisfies Record<string, RelatedLink>;

export const HOME_CRUMB: Crumb = { name: "Home", path: "/" };
const TOOLS_CRUMB: Crumb = { name: "Tools", path: "/tools" };
const CONVERT_CRUMB: Crumb = { name: "Convert", path: "/convert" };

export const LANDING_PAGES: LandingPage[] = [
  {
    path: "/scan",
    title: "Scan to PDF Online: Free Document Scanner",
    description:
      "Scan documents to PDF with your camera or upload photos, crop and enhance each page, add a signature, then download one PDF. Free, private, in your browser.",
    h1: "Scan documents to PDF online",
    intro:
      "Use your camera or upload a file, tidy up the pages, and export one clean PDF. It is free, needs no account, and your pages stay in your browser.",
    crumbs: [{ name: "Scan", path: "/scan" }],
    appName: "PDFScanner document scanner",
    features: [
      "Scan pages with your camera or upload photos",
      "Automatic edge detection, crop and rotate",
      "Enhance, grayscale and black and white modes",
      "Add text, highlights, drawings and a signature",
      "Reorder pages and export one PDF",
      "Print, download or save to your account",
    ],
    how: [
      "Add pages. Tap Use camera to photograph each page, or upload photos, a PDF, or a Word or Excel file.",
      "Tidy each page. Edges are found and the page is straightened for you. Crop by hand, rotate, pick Auto, Grayscale or Black & White, and adjust brightness and contrast.",
      "Add what you need. Type text, highlight, draw or place your signature, and reorder or remove pages.",
      "Create the PDF. Download it, print it, or save it to your account if you are signed in.",
    ],
    goodFor:
      "Receipts, contracts, forms, ID copies, homework and notes: anything on paper that needs to become one PDF. It works in a phone or desktop browser, so there is no app to install.",
    formats:
      "Photos (JPG, PNG and other image types, up to 25 MB each), PDFs (the first 50 pages), Word (.docx), Excel (.xlsx) and CSV. Word, Excel and CSV files are converted to PDF first.",
    limits: [
      "The PDF is made from page images, so its text is not selectable. Use text recognition (OCR) if you need to copy the words.",
      "Automatic edge detection works best on a page lying on a plain, contrasting surface in good light. You can always adjust the crop by hand.",
      "The camera needs your browser's permission and a secure (https) connection.",
      "Guest scans are not kept. Download the PDF before you leave, or sign in to save it to your account.",
    ],
    privacy: `${PRIVATE} Only if you choose Save to account is the finished PDF stored for you.`,
    faq: [
      { q: "Is this scanner really free?", a: "Yes. Scanning, editing, signing, printing and downloading are free and need no account. PDFScanner is supported by ads." },
      { q: "Can I scan with my phone?", a: "Yes. Open PDFScanner in your phone's browser, tap Use camera and allow camera access. You can also upload photos you have already taken." },
      { q: "Does it add a watermark?", a: "No. The PDF you download has no PDFScanner watermark." },
      { q: "Can I put several pages into one PDF?", a: "Yes. Add more pages, reorder them, then create a single PDF from all of them." },
    ],
    related: [LINKS.ocr, LINKS.compressPdf, LINKS.sign, LINKS.editor, LINKS.imageToPdf],
  },
  {
    path: "/tools/pdf-editor",
    title: "Free PDF Editor: Add Text, Sign & Reorder Pages",
    description:
      "Open a PDF or photos, crop, rotate and reorder pages, add text, marks and your signature, then save one PDF. Free, in your browser. Existing text is not rewritten.",
    h1: "Edit a PDF online",
    intro:
      "Crop, rotate and reorder pages, then add text, marks and your signature on top. Everything happens in your browser and needs no account.",
    crumbs: [TOOLS_CRUMB, { name: "PDF editor", path: "/tools/pdf-editor" }],
    appName: "PDFScanner PDF editor",
    features: [
      "Crop, rotate and straighten pages",
      "Reorder and remove pages",
      "Enhance, grayscale and black and white modes",
      "Add text, highlights, drawings, check marks, dates and signatures",
      "Save the result as one PDF",
    ],
    how: [
      "Upload a PDF or images. Each page opens as a picture you can work on.",
      "Choose a page to open the page editor. Crop, rotate, and change brightness or contrast.",
      "Select Add text, signature & marks to type, highlight, draw or sign on the page.",
      "Reorder or remove pages, then create and download the PDF.",
    ],
    goodFor:
      "Filling in and marking up forms, signing a contract, tidying a scan, removing a page or putting pages in a new order, without installing anything.",
    formats: "PDF files (the first 50 pages) and images (JPG, PNG and more, up to 25 MB each). Word and Excel files are converted to PDF first.",
    limits: [
      "This is a page-level editor. It adds text and marks on top of pages; it does not rewrite the text that is already in a PDF.",
      "Each page is re-drawn as an image when the PDF is created (about 170 DPI for an A4 page), so the text in the saved PDF is not selectable and the file can be larger. Use the compressor to shrink it.",
      "Password-protected PDFs cannot be opened. Remove the password first.",
    ],
    privacy: PRIVATE,
    faq: [
      { q: "Can I change the existing text in a PDF?", a: "No. You can cover, mark up and add to a page, but the existing text is part of the page image and is not editable here." },
      { q: "Will my editing be saved in the same PDF?", a: "You save the result as a new PDF; your original file is never changed." },
      { q: "Do I need an account?", a: "No. Editing, signing and downloading work without one. An account is only for saving documents to your History." },
    ],
    related: [LINKS.sign, LINKS.annotate, LINKS.compressPdf, LINKS.ocr, LINKS.scan],
  },
  {
    path: "/tools/sign-pdf",
    title: "Sign PDF Online Free: No Account Needed",
    description:
      "Sign a PDF online by drawing, typing or uploading your signature, then place and resize it. Free, no account, and your file stays in your browser.",
    h1: "Sign a PDF online",
    intro:
      "Add your signature to a PDF without printing it. Draw, type or upload your signature, place it where it belongs, then download the signed PDF.",
    crumbs: [TOOLS_CRUMB, { name: "Sign PDF", path: "/tools/sign-pdf" }],
    appName: "PDFScanner PDF signer",
    features: [
      "Draw, type or upload a signature",
      "Choose ink colour",
      "Drag to place, drag the corner to resize",
      "Reuse the signature on other pages",
      "Download the signed PDF",
    ],
    how: [
      "Upload the PDF you want to sign (or a photo of the document).",
      "Open the page that needs your signature and choose the signature tool.",
      "Draw your signature, type your name, or upload a picture of your signature. A PNG with a transparent background looks best.",
      "Drag it into place, resize it, then create and download the signed PDF.",
    ],
    goodFor:
      "Contracts, permission slips, rental and job paperwork, and forms that ask for a signature on a page, without printing, signing and scanning them again.",
    formats: "PDF files and images for the document, and a picture of your signature if you upload one. A PNG with a transparent background looks best.",
    limits: [
      "This places an image of your signature on the page, like signing on paper. It is not a certificate-based digital signature, and whether a signature is accepted is up to the person or organisation asking for it.",
      "The signed PDF is created from page images, so its text is not selectable.",
      "A signature can be remembered on this device if you tick the option; it is never uploaded.",
    ],
    privacy: `${PRIVATE} A saved signature stays in this browser only and you can remove it at any time.`,
    faq: [
      { q: "Do I need an account to sign a PDF?", a: "No. Signing works for guests, with no sign-up." },
      { q: "Is a signature made here legally binding?", a: "That depends on where you are and what the document is. PDFScanner places your signature image on the page; it does not provide a certified digital signature or legal advice." },
      { q: "Can I sign more than one page?", a: "Yes. Open each page in turn; your last signature is offered again so you do not need to redraw it." },
    ],
    related: [LINKS.editor, LINKS.annotate, LINKS.scan, LINKS.compressPdf],
  },
  {
    path: "/tools/annotate",
    title: "Annotate PDF: Add Text, Highlight & Draw",
    description:
      "Annotate a PDF online: add text, highlights, freehand drawings, check marks, X marks, dates and signatures, then save one PDF. Free, in your browser.",
    h1: "Annotate a PDF online",
    intro:
      "Mark up a document with text, highlights, drawings, check marks, X marks, dates and signatures, all in one editor and all in your browser.",
    crumbs: [TOOLS_CRUMB, { name: "Annotate", path: "/tools/annotate" }],
    appName: "PDFScanner PDF annotator",
    features: [
      "Add text with size, colour and style",
      "Highlight areas",
      "Draw freehand",
      "Place check marks, X marks and dates",
      "Add a signature",
      "Undo, redo and zoom",
    ],
    how: [
      "Upload a PDF or images and open the page you want to mark up.",
      "Choose a tool: Text, Draw, Highlight, Check, X, Date or Signature.",
      "Tap or drag on the page. Move a mark by dragging it and resize it by dragging its corner dot.",
      "Tap Done, repeat on other pages, then create and download the PDF.",
    ],
    goodFor:
      "Reviewing and commenting on documents, ticking boxes on a form, highlighting key lines, circling a detail, or dating and initialling a page.",
    formats: "PDF files (the first 50 pages) and images (up to 25 MB each).",
    limits: [
      "Marks are drawn on top of the page. The existing text in a PDF is not editable.",
      "The saved PDF is created from page images, so its text is not selectable.",
    ],
    privacy: PRIVATE,
    faq: [
      { q: "How do I add text to a PDF?", a: "Choose the Text tool, tap where the text should go and type. You can change its size, colour, bold and italic afterwards." },
      { q: "How do I highlight in a PDF?", a: "Choose Highlight and drag across the area. You can pick a highlight colour and delete a highlight you no longer want." },
      { q: "Can I undo a mistake?", a: "Yes. Undo and Redo step through your changes on the page, and Delete removes the selected mark." },
    ],
    related: [LINKS.sign, LINKS.editor, LINKS.scan, LINKS.ocr],
  },
  {
    path: "/tools/ocr",
    title: "Free OCR Online: Extract Text from PDF or Image",
    description:
      "Extract text from scanned PDFs and photos with free OCR that runs in your browser. English text, up to 30 pages at a time. Nothing is uploaded.",
    h1: "Extract text from a PDF or image (OCR)",
    intro:
      "Turn a scanned PDF or a photo of a document into text you can search, edit and copy. The text recognition runs in your browser, so your document stays on your device.",
    crumbs: [TOOLS_CRUMB, { name: "OCR", path: "/tools/ocr" }],
    appName: "PDFScanner OCR",
    features: [
      "Read text from scanned PDFs and photos",
      "Runs in the browser",
      "Edit and search the recognised text",
      "Copy the text to the clipboard",
    ],
    how: [
      "Upload a scanned PDF or a photo of a page. Straighten and crop it first if it is crooked.",
      "Under the page controls, open More options and choose Extract text.",
      "Wait while each page is read. The first run downloads the text engine, so it takes a little longer.",
      "Review the text in the Extracted text panel, correct anything that is wrong, then use Copy text.",
    ],
    goodFor:
      "Pulling the words out of a scanned letter, a photographed page, a receipt or a screenshot so you can paste, search or reuse them.",
    formats: "Scanned PDFs (the first 50 pages) and photos or screenshots (JPG, PNG and more, up to 25 MB each).",
    limits: [
      "English only for now.",
      "Up to 30 pages are read in one run.",
      "Accuracy depends on the scan. A sharp, well-lit, straight page reads best; handwriting and unusual fonts read poorly. Check the result before you rely on it.",
      "The text is shown and copied. It is not added to the PDF as a hidden text layer, and it is not saved as a file.",
    ],
    privacy: `${PRIVATE} The text engine is served from PDFScanner itself, not a third-party service.`,
    faq: [
      { q: "Is the OCR free?", a: "Yes. Basic text recognition is free and needs no account." },
      { q: "Is my document sent to a server?", a: "No. Recognition runs in your browser, so the pages never leave your device." },
      { q: "Does it support other languages?", a: "Not yet. It reads English text only." },
      { q: "Will it make my PDF searchable?", a: "No. It gives you the text to copy, but the PDF you export is still made of page images." },
    ],
    related: [LINKS.scan, LINKS.pdfToWord, LINKS.editor, LINKS.compressPdf],
  },
  {
    path: "/tools/compress-pdf",
    title: "Compress PDF Online: Reduce PDF File Size",
    description:
      "Shrink a PDF with a quality-to-size slider and a live size estimate. Free and in your browser, so your file is not uploaded.",
    h1: "Compress PDF online",
    intro:
      "Make a PDF small enough to email or upload. Slide from higher quality to a smaller file, see the estimated size first, and keep your original untouched.",
    crumbs: [TOOLS_CRUMB, { name: "Compress PDF", path: "/tools/compress-pdf" }],
    appName: "PDFScanner PDF compressor",
    features: [
      "Five quality-to-size levels",
      "Size estimate before you compress",
      "Optional target file size",
      "Text stays selectable unless you choose stronger compression",
      "Original file is never changed",
    ],
    how: [
      "Choose a PDF (up to 100 MB).",
      "Move the slider to pick a level and check the estimated size. Open More options to aim for a specific size instead.",
      "Choose Compress PDF.",
      "Download the smaller file, or try another level.",
    ],
    goodFor:
      "PDFs full of photos or scans that are too big to email, upload to a form, or keep on your phone.",
    formats: "PDF files up to 100 MB.",
    limits: [
      "PDFs that are mostly text are already compact and shrink very little. Their text and layout are never touched.",
      "If a result would not be smaller, you get your original back rather than a bigger file.",
      "Try stronger compression redraws each page as a picture: the file gets much smaller, but the text can no longer be selected or searched.",
      "Password-protected PDFs are not supported.",
    ],
    privacy: PRIVATE,
    faq: [
      { q: "How do I compress a PDF without losing quality?", a: "Start at the lighter levels. They recompress the pictures inside the PDF and leave the text alone, and the estimate shows the size you can expect before you commit." },
      { q: "Can I compress a PDF to a specific size?", a: "Yes. Under More options, enter a target size and PDFScanner picks the lightest level that fits. If it cannot fit without wrecking quality, it tells you." },
      { q: "Is there a file size limit?", a: "PDFs up to 100 MB. There is no daily limit and no account is needed." },
    ],
    related: [LINKS.compressImage, LINKS.scan, LINKS.editor, LINKS.imageToPdf],
  },
  {
    path: "/tools/compress-image",
    title: "Compress Image Online: Reduce JPG & PNG Size",
    description:
      "Reduce a photo's file size with a quality slider, free in your browser. JPG, PNG and WebP up to 60 MB. Your pictures are never uploaded.",
    h1: "Compress images online",
    intro:
      "Make a photo smaller with a quality-to-size slider and see the estimated size first. Your original is never changed.",
    crumbs: [TOOLS_CRUMB, { name: "Compress image", path: "/tools/compress-image" }],
    appName: "PDFScanner image compressor",
    features: ["Quality-to-size slider", "Size estimate", "Optional target size and image dimensions", "Original is never changed"],
    how: [
      "Choose a JPG, PNG or WebP picture (up to 60 MB).",
      "Move the slider and watch the estimated size. Open More options to choose a target size or a smaller image size.",
      "Choose Compress image, check the preview, then download the smaller copy.",
    ],
    goodFor: "Photos that are too big to email, attach to a form or upload to a website.",
    formats: "JPG, PNG and WebP images up to 60 MB.",
    limits: [
      "Smaller files mean lower quality: check the preview before you use the result.",
      "If compressing would not make the file smaller, you get the original back.",
    ],
    privacy: PRIVATE,
    faq: [
      { q: "Does compressing change my original photo?", a: "No. You download a separate, smaller copy." },
      { q: "Can I turn several images into one PDF?", a: "Yes. Use the image to PDF converter, then compress the PDF if it is still too big." },
    ],
    related: [LINKS.compressPdf, LINKS.imageToPdf, LINKS.scan],
  },
  {
    path: "/tools/compress-word",
    title: "Compress Word Document: Reduce DOCX File Size",
    description:
      "Shrink the pictures inside a Word (.docx) document to reduce its file size. Text, layout and formatting are not changed. Free, in your browser.",
    h1: "Compress a Word document",
    intro:
      "Most of a Word file's size is the pictures inside it. This shrinks those pictures and leaves your text, layout and formatting exactly as they are.",
    crumbs: [TOOLS_CRUMB, { name: "Compress Word", path: "/tools/compress-word" }],
    appName: "PDFScanner Word compressor",
    features: ["Shrinks pictures inside a .docx", "Text and layout untouched", "Size estimate", "Original is never changed"],
    how: [
      "Choose a Word document (.docx, up to 100 MB).",
      "Pick a level with the slider and check the estimated size.",
      "Choose Compress Word and download the smaller .docx.",
    ],
    goodFor: "Reports and documents with photos or screenshots that are too big to email.",
    formats: ".docx files up to 100 MB. The older .doc format is not supported.",
    limits: [
      "Only the pictures are compressed. A document with few pictures will barely change.",
      "Turning the document into a PDF is a separate step: use Word to PDF.",
    ],
    privacy: PRIVATE,
    faq: [
      { q: "Will my formatting change?", a: "No. Only the pictures inside the file are recompressed. Text, tables, fonts and layout are left alone." },
      { q: "Can I compress an older .doc file?", a: "Not directly. Open it in Word, save it as .docx, then compress it here." },
    ],
    related: [LINKS.wordToPdf, LINKS.compressPdf, LINKS.compressImage],
  },
  {
    path: "/tools/compress-excel",
    title: "Compress Excel File: Reduce XLSX File Size",
    description:
      "Shrink the pictures inside an Excel (.xlsx) workbook to reduce its size. Formulas, sheets and formatting stay exactly as they are. Free, in your browser.",
    h1: "Compress an Excel file",
    intro:
      "If an Excel workbook is big, it is usually because of pictures. This shrinks them and leaves your formulas, sheets and formatting exactly as they are.",
    crumbs: [TOOLS_CRUMB, { name: "Compress Excel", path: "/tools/compress-excel" }],
    appName: "PDFScanner Excel compressor",
    features: ["Shrinks pictures inside an .xlsx", "Formulas, sheets and formatting untouched", "Size estimate", "Original is never changed"],
    how: [
      "Choose an Excel workbook (.xlsx, up to 100 MB).",
      "Pick a level with the slider and check the estimated size.",
      "Choose Compress Excel and download the smaller workbook.",
    ],
    goodFor: "Workbooks with logos, screenshots or photos that are too large to email.",
    formats: ".xlsx files up to 100 MB. The older .xls format is not supported.",
    limits: [
      "Only pictures are compressed. A workbook made of data alone will barely change.",
      "To turn a workbook into a PDF instead, use Excel to PDF.",
    ],
    privacy: PRIVATE,
    faq: [
      { q: "Will my formulas still work?", a: "Yes. Formulas, sheets and formatting are not touched; only embedded pictures are recompressed." },
      { q: "Does it work on .xls files?", a: "No, only .xlsx. Save older workbooks as .xlsx in Excel first." },
    ],
    related: [LINKS.excelToPdf, LINKS.compressPdf, LINKS.compressImage],
  },
  {
    path: "/convert/image-to-pdf",
    title: "JPG to PDF: Convert Images to PDF Online",
    description:
      "Turn JPG, PNG and other photos into one PDF for free. Crop, enhance and reorder the pages first. Your pictures never leave your browser.",
    h1: "Convert images to PDF",
    intro:
      "Combine photos and pictures into a single PDF. Crop, straighten and reorder them first, then download. It is free and needs no account.",
    crumbs: [CONVERT_CRUMB, { name: "Image to PDF", path: "/convert/image-to-pdf" }],
    appName: "PDFScanner image to PDF converter",
    features: ["Convert JPG, PNG and other images to PDF", "Combine several images into one PDF", "Crop, rotate and enhance each page", "Reorder pages"],
    how: [
      "Add your images with Upload document (you can choose several at once).",
      "Crop, rotate or enhance any page, and use the arrows to put the pages in order.",
      "Choose Create PDF, then download it.",
    ],
    goodFor: "Photos of paperwork, screenshots, receipts and artwork that need to be one PDF for a form, an email or a print job.",
    formats: "JPG, PNG and other image types, up to 25 MB each. Each image becomes one A4 page, fitted without cropping.",
    limits: [
      "The PDF is made from images, so its text is not selectable. Use OCR if you need the words as text.",
      "Very large batches depend on your device's memory. If a browser struggles, convert fewer images at a time.",
    ],
    privacy: PRIVATE,
    faq: [
      { q: "Can I combine several images into one PDF?", a: "Yes. Add them all, put them in order and create one PDF." },
      { q: "Will it change my image quality?", a: "Pages are kept at about 170 DPI for A4. Use the compressor afterwards if you need the file smaller." },
      { q: "Does it work for PNG?", a: "Yes. JPG, PNG and other common image types are accepted." },
    ],
    related: [LINKS.scan, LINKS.compressPdf, LINKS.ocr, LINKS.editor],
  },
  {
    path: "/convert/word-to-pdf",
    title: "Word to PDF: Convert DOCX to PDF Free",
    description:
      "Convert Word (.docx) documents to PDF for free, in your browser. Fonts, tables, pictures, headers and footers are kept. Your file is never uploaded.",
    h1: "Convert Word to PDF",
    intro:
      "Turn a Word document into a PDF that keeps your fonts, spacing, margins, tables, pictures, headers and footers. It runs in your browser and needs no account.",
    crumbs: [CONVERT_CRUMB, { name: "Word to PDF", path: "/convert/word-to-pdf" }],
    appName: "PDFScanner Word to PDF converter",
    features: ["Convert .docx to PDF", "Keeps fonts, tables, pictures, headers and footers", "Preview the first page", "Edit and sign the result"],
    how: [
      "Choose your Word document (.docx).",
      "Wait a moment while it is converted. You will see the page count and a preview of the first page.",
      "Download the PDF, print it, or open it in the editor to sign it.",
    ],
    goodFor: "CVs, letters, reports and forms that must look the same on every device.",
    formats: ".docx files up to 15 MB. The older .doc format is not supported.",
    limits: [
      "Common fonts (Calibri, Arial, Times New Roman, Courier New, Cambria) are matched with look-alike fonts of the same widths so lines break where they do in Word. Rare fonts may be substituted.",
      "Very complex layouts may not match Word exactly. Check the preview before you share the PDF.",
      "The PDF is made from the document's layout, not by Microsoft Word.",
    ],
    privacy: PRIVATE,
    faq: [
      { q: "Do I need Microsoft Word?", a: "No. The conversion happens in your browser." },
      { q: "Can I convert .doc files?", a: "Not directly. Open the file in Word, save it as .docx, then convert it here." },
      { q: "Can I sign the PDF afterwards?", a: "Yes. Choose Edit & sign this PDF after converting." },
    ],
    related: [LINKS.pdfToWord, LINKS.sign, LINKS.compressWord, LINKS.compressPdf],
  },
  {
    path: "/convert/pdf-to-word",
    title: "PDF to Word: Convert PDF to Editable DOCX",
    description:
      "Convert a PDF to an editable Word document (.docx) for free. Scanned pages are read with English text recognition. Nothing is uploaded.",
    h1: "Convert PDF to Word",
    intro:
      "Get an editable Word document from a PDF. Text PDFs convert directly, and scanned pages are read with text recognition. It runs in your browser.",
    crumbs: [CONVERT_CRUMB, { name: "PDF to Word", path: "/convert/pdf-to-word" }],
    appName: "PDFScanner PDF to Word converter",
    features: ["Convert PDF to .docx", "Reads scanned pages with OCR", "Runs in the browser"],
    how: [
      "Choose your PDF (up to 100 pages).",
      "Wait while the text and layout are read. Scanned pages take longer because they are recognised page by page.",
      "Download the .docx and open it in Word or another word processor.",
    ],
    goodFor: "Reusing the text of a PDF you received, or fixing a document you no longer have the original file for.",
    formats: "PDF files up to 100 pages. Scanned pages are read in English.",
    limits: [
      "PDFs do not store paragraphs the way Word does, so complex layouts, columns and tables may need tidying after conversion.",
      "Scanned pages depend on scan quality and are read as English text only.",
      "Password-protected PDFs are not supported.",
    ],
    privacy: PRIVATE,
    faq: [
      { q: "Does it work on scanned PDFs?", a: "Yes, using English text recognition. Sharp, straight scans read best." },
      { q: "Will the formatting be perfect?", a: "Simple documents convert well. Complicated layouts usually need some tidying in Word." },
    ],
    related: [LINKS.ocr, LINKS.wordToPdf, LINKS.pdfToExcel, LINKS.editor],
  },
  {
    path: "/convert/excel-to-pdf",
    title: "Excel to PDF: Convert XLSX & CSV to PDF",
    description:
      "Turn Excel (.xlsx) and CSV files into a tidy, paginated PDF for free, in your browser. Values, fonts, colours, borders and merged cells are kept.",
    h1: "Convert Excel to PDF",
    intro:
      "Turn a spreadsheet into a paginated PDF that is ready to share or print. Choose which sheets to include and how they are laid out.",
    crumbs: [CONVERT_CRUMB, { name: "Excel to PDF", path: "/convert/excel-to-pdf" }],
    appName: "PDFScanner Excel to PDF converter",
    features: ["Convert .xlsx and CSV to PDF", "Choose sheets", "Keeps values, fonts, colours, borders and merged cells", "Optional gridlines"],
    how: [
      "Choose an Excel workbook (.xlsx) or a CSV file.",
      "Pick the sheets to include, the page orientation, and whether to show gridlines.",
      "Choose Convert to PDF, then download or print the result.",
    ],
    goodFor: "Sharing a report, invoice or price list that should look the same for everyone.",
    formats: ".xlsx and CSV files up to 15 MB and 20,000 rows. The older .xls format is not supported.",
    limits: [
      "It is a table renderer, not a spreadsheet engine: charts, images, shapes and conditional formatting are not carried over.",
      "Text outside the Latin alphabet is not carried over.",
      "Wide sheets are split across pages; check the preview before you share.",
    ],
    privacy: PRIVATE,
    faq: [
      { q: "Do I need Excel installed?", a: "No. The conversion happens in your browser." },
      { q: "Does it keep my formatting?", a: "Values (with their Excel number and date formats), column widths, fonts, colours, fills, borders and merged cells are kept. Charts, images, shapes and conditional formatting are not." },
    ],
    related: [LINKS.pdfToExcel, LINKS.compressExcel, LINKS.wordToPdf, LINKS.compressPdf],
  },
  {
    path: "/convert/pdf-to-excel",
    title: "PDF to Excel: Extract PDF Tables to XLSX",
    description:
      "Pull tables out of a PDF into an Excel spreadsheet you can calculate with, free in your browser. Scanned pages are read with English text recognition.",
    h1: "Convert PDF to Excel",
    intro:
      "Extract the tables from a PDF into a real spreadsheet with numbers you can add up. It runs in your browser.",
    crumbs: [CONVERT_CRUMB, { name: "PDF to Excel", path: "/convert/pdf-to-excel" }],
    appName: "PDFScanner PDF to Excel converter",
    features: ["Extract PDF tables to .xlsx", "Numbers become real numbers", "Reads scanned pages with OCR (one line per row)"],
    how: [
      "Choose a PDF (up to 100 pages).",
      "Wait while the tables are found. Pages that are scans are recognised one at a time.",
      "Download the .xlsx and open it in Excel or another spreadsheet app.",
    ],
    goodFor: "Getting statements, price lists and reports out of a PDF so you can sort, filter and calculate.",
    formats: "PDF files up to 100 pages.",
    limits: [
      "Digital PDFs with real columns convert best. Scanned pages come out one line per row, with no column detection.",
      "Tables without clear column gaps may need tidying in the spreadsheet.",
      "Scanned pages are read in English.",
    ],
    privacy: PRIVATE,
    faq: [
      { q: "Will my numbers work in formulas?", a: "Numbers are written as numbers, so you can add them up and use them in formulas." },
      { q: "Can it read scanned tables?", a: "It reads scanned pages with text recognition, one line per row. Column detection for scans is not available yet." },
    ],
    related: [LINKS.ocr, LINKS.excelToPdf, LINKS.pdfToWord, LINKS.scan],
  },
];

export function getLanding(path: string): LandingPage | undefined {
  return LANDING_PAGES.find((p) => p.path === path);
}

export const LANDING_PATHS = LANDING_PAGES.map((p) => p.path);

// Exposed so the footer and hub pages link to the same, correctly described places.
export { LINKS as RELATED };

// What the FreePDFScanner help assistant knows, in one place.
//
// Everything the assistant says about the product comes from here: the list of
// tools is read from the real registries (utils/tools/registry.ts and
// components/convert/tools.ts), and each how-to names a route and, where there
// is one, the id of a control on the page (the data-assistant-id attribute).
// tests/assistant/knowledge.mjs checks that every route exists, that every
// control id is really present in the source, and that nothing is described that
// the app does not do -- so this file cannot quietly drift from the product.
//
// The same entries ground the AI model on the server and drive the built-in
// guide used when the model is unavailable.

import { CONVERT_TOOLS } from "../../components/convert/tools.ts";
import { FEATURES } from "../features/plans.ts";
import { TOOLS } from "../tools/registry.ts";

export interface HelpStep {
  text: string;
  // data-assistant-id of the control this step is about, if it has one.
  target?: string;
}

export type HelpKind = "howto" | "faq" | "limit" | "troubleshoot" | "privacy";

export interface HelpVariant {
  // Routes where these steps replace the default ones: the visitor is already
  // there, so they are not told to open it. A trailing "/*" matches below it.
  pages: string[];
  steps: HelpStep[];
}

export interface HelpEntry {
  id: string;
  kind: HelpKind;
  title: string;
  // Words and phrases a person might use, lower case.
  keywords: string[];
  summary: string;
  steps?: HelpStep[];
  // Where to do it (an internal route) and the link text.
  route?: string;
  routeLabel?: string;
  variants?: HelpVariant[];
  // Short honest caveats shown under the steps.
  notes?: string[];
}

// Pages that are not tools.
export const STATIC_ROUTES: { href: string; label: string }[] = [
  { href: "/", label: "Home" },
  { href: "/scan", label: "Scan to PDF" },
  { href: "/tools", label: "All tools" },
  { href: "/convert", label: "All converters" },
  { href: "/history", label: "History" },
  { href: "/account", label: "Account" },
  { href: "/privacy", label: "Privacy Policy" },
  { href: "/guides", label: "Guides" },
];

export const OFFICE_PROTECTION = FEATURES["protect.docx"].implemented;

const EDITOR_PAGES = [
  "/scan",
  "/edit-pdf",
  "/scan-to-pdf",
  "/jpg-to-pdf",
  "/png-to-pdf",
  "/convert/image-to-pdf",
  ...TOOLS.filter((t) => t.kind === "editor").map((t) => `/tools/${t.slug}`),
];

const ENTRIES: HelpEntry[] = [
  {
    id: "use-scanner",
    kind: "howto",
    title: "Scan a document with the camera",
    keywords: ["scanner", "scan", "camera", "take a photo", "photograph a document", "scan a page", "use the scanner", "scan to pdf", "scan document"],
    summary: "Scan with your camera or upload a file, tidy each page, then create one PDF.",
    route: "/scan",
    routeLabel: "Open Scan",
    steps: [
      { text: "Open the Scan page.", target: "nav-scan" },
      { text: "Choose Use camera and allow camera access when your browser asks. Each camera session takes one photo, so tap Scan another page for more pages.", target: "scan-use-camera" },
      { text: "Line the document up inside the frame and take the photo. The page is straightened and cleaned up automatically." },
      { text: "Choose Edit page to crop, rotate, brighten or add text, a signature or a picture. This step is optional.", target: "scan-edit-page" },
      { text: "Choose Create PDF, then Download PDF.", target: "scan-create-pdf" },
    ],
    notes: ["If the camera will not start, choose Upload document and pick a photo you already took."],
  },
  {
    id: "convert-word-to-pdf",
    kind: "howto",
    title: "Convert a Word document to PDF",
    keywords: ["word to pdf", "docx to pdf", "convert word", "word document to pdf", "doc to pdf", "word pdf", "make a pdf from word"],
    summary: "Turn a Word (.docx) document into a PDF in your browser.",
    route: "/convert/word-to-pdf",
    routeLabel: "Open Word to PDF",
    steps: [
      { text: "Open the Word to PDF converter.", target: "nav-convert" },
      { text: "Choose your Word document (.docx), or drop it on the box.", target: "file-dropzone" },
      { text: "Wait while it converts. This happens on your device." },
      { text: "Choose Download PDF.", target: "convert-download" },
    ],
    variants: [
      {
        pages: ["/convert/word-to-pdf", "/word-to-pdf"],
        steps: [
          { text: "Choose your Word document (.docx), or drop it on the box.", target: "file-dropzone" },
          { text: "Wait while it converts. This happens on your device." },
          { text: "Choose Download PDF.", target: "convert-download" },
        ],
      },
    ],
    notes: ["Only .docx files work. For an older .doc file, open it in Word and use Save As to save it as .docx first."],
  },
  {
    id: "convert-pdf-to-word",
    kind: "howto",
    title: "Convert a PDF to Word",
    keywords: ["pdf to word", "pdf to docx", "edit pdf in word", "convert pdf to word", "pdf into word", "editable word"],
    summary: "Get an editable Word document from a PDF. Scanned pages are read with text recognition.",
    route: "/convert/pdf-to-word",
    routeLabel: "Open PDF to Word",
    steps: [
      { text: "Open the PDF to Word converter.", target: "nav-convert" },
      { text: "Choose your PDF, or drop it on the box.", target: "file-dropzone" },
      { text: "Wait while it converts." },
      { text: "Choose Download Word file.", target: "convert-download" },
    ],
    notes: ["Complex layouts may need tidying in Word. Text recognition is English only."],
  },
  {
    id: "convert-excel-to-pdf",
    kind: "howto",
    title: "Convert an Excel spreadsheet to PDF",
    keywords: ["excel to pdf", "xlsx to pdf", "spreadsheet to pdf", "convert excel", "csv to pdf"],
    summary: "Turn a spreadsheet into a tidy, paginated PDF.",
    route: "/convert/excel-to-pdf",
    routeLabel: "Open Excel to PDF",
    steps: [
      { text: "Open the Excel to PDF converter.", target: "nav-convert" },
      { text: "Choose your spreadsheet (.xlsx, .xlsm or .csv), or drop it on the box.", target: "file-dropzone" },
      { text: "Tick the sheets you want in the PDF, then choose the convert button." },
      { text: "Choose Download PDF.", target: "convert-download" },
    ],
    notes: ["Older .xls files are not supported; save them as .xlsx in Excel first."],
  },
  {
    id: "convert-pdf-to-excel",
    kind: "howto",
    title: "Convert a PDF to Excel",
    keywords: ["pdf to excel", "pdf to xlsx", "pdf table to excel", "extract table", "pdf to spreadsheet", "pdf to csv"],
    summary: "Pull tables out of a PDF into a spreadsheet you can add up.",
    route: "/convert/pdf-to-excel",
    routeLabel: "Open PDF to Excel",
    steps: [
      { text: "Open the PDF to Excel converter.", target: "nav-convert" },
      { text: "Choose your PDF, or drop it on the box.", target: "file-dropzone" },
      { text: "Choose how the pages should be laid out (one sheet per page, or all pages on one sheet), then choose the convert button." },
      { text: "Choose Download Excel file.", target: "convert-download" },
    ],
    notes: ["Results depend on how clearly the tables are laid out."],
  },
  {
    id: "image-to-pdf",
    kind: "howto",
    title: "Turn photos or images into a PDF",
    keywords: ["image to pdf", "jpg to pdf", "png to pdf", "photo to pdf", "picture to pdf", "images into one pdf", "jpeg to pdf"],
    summary: "Turn photos and pictures into one PDF. Crop, enhance and reorder the pages first.",
    route: "/convert/image-to-pdf",
    routeLabel: "Open Image to PDF",
    steps: [
      { text: "Open Image to PDF.", target: "nav-convert" },
      { text: "Choose Upload document and pick your pictures. You can select several at once.", target: "scan-upload" },
      { text: "Reorder or edit the pages if you want to.", target: "scan-page-list" },
      { text: "Choose Create PDF, then Download PDF.", target: "scan-create-pdf" },
    ],
  },
  {
    id: "insert-image",
    kind: "howto",
    title: "Insert a passport photograph or other picture into a document",
    keywords: ["insert image", "insert picture", "add image", "add picture", "passport photo", "passport photograph", "photo on form", "put a photo", "logo", "stamp", "add photo to pdf", "insert photo", "id photo", "picture into pdf", "image in pdf"],
    summary: "Place a picture on a page, drag and resize it, then download the PDF with the picture in it.",
    route: "/tools/add-image",
    routeLabel: "Open Add Image",
    steps: [
      { text: "Open the Add Image tool.", target: "nav-tools" },
      { text: "Upload your document (PDF, Word, Excel or a photo of a form).", target: "scan-upload" },
      { text: "Choose Edit page on the page that needs the picture.", target: "scan-edit-page" },
      { text: "Choose Add image, then pick a JPG, PNG or WebP picture from your device.", target: "annotation-tool-image" },
      { text: "Rotate or crop it if needed. For a passport photo, pick the size your application asks for under Size on the page.", target: "image-dialog" },
      { text: "Choose Place on page, then drag the picture into position and drag its corner dot to resize it. Choose Done." },
      { text: "Choose Create PDF, then Download PDF. Add image again for more pictures.", target: "scan-create-pdf" },
    ],
    variants: [
      {
        pages: EDITOR_PAGES,
        steps: [
          { text: "Upload your document if you have not already.", target: "scan-upload" },
          { text: "Choose Edit page on the page that needs the picture.", target: "scan-edit-page" },
          { text: "Choose Add image, then pick a JPG, PNG or WebP picture from your device.", target: "annotation-tool-image" },
          { text: "Rotate or crop it if needed. For a passport photo, pick the size your application asks for under Size on the page.", target: "image-dialog" },
          { text: "Choose Place on page, then drag the picture into position and drag its corner dot to resize it. Choose Done." },
          { text: "Choose Create PDF, then Download PDF.", target: "scan-create-pdf" },
        ],
      },
    ],
    notes: [
      "Passport and ID photo sizes differ by country and application, so check the size you need. The sizes offered are exact in the downloaded PDF printed at Actual size (100%) with Fit to page turned off. The Print button fits the page to the paper, so a photo prints slightly smaller.",
      "Word and Excel files are converted to PDF first, so the picture is added to the PDF. Your original .docx or .xlsx is not changed.",
      "Pictures sit on top of the page; the existing text in a document is not rewritten.",
    ],
  },
  {
    id: "combine-pdfs",
    kind: "howto",
    title: "Combine several PDFs into one",
    keywords: ["merge", "combine", "combine pdf", "merge pdf", "join pdf", "combine multiple pdfs", "merge pdfs", "put pdfs together", "one pdf from several", "append pdf"],
    summary: "Open all the files together on the Scan page, put the pages in order, and create one PDF.",
    route: "/scan",
    routeLabel: "Open Scan",
    steps: [
      { text: "Open the Scan page.", target: "nav-scan" },
      { text: "Choose Upload document and select all the PDFs (or images) you want in one go, or choose it again to add more. Their pages are added one after another.", target: "scan-upload" },
      { text: "Select a page and use the Move earlier / Move later buttons to put the pages in order. Remove any you do not want.", target: "scan-move-earlier" },
      { text: "Choose Create PDF, then Download PDF.", target: "scan-create-pdf" },
    ],
    notes: ["Only the first 50 pages of each PDF are opened. The combined PDF is made from page images, so its text is not selectable."],
  },
  {
    id: "protect-pdf",
    kind: "howto",
    title: "Protect a PDF with a password",
    keywords: ["password protect", "protect pdf", "lock pdf", "encrypt pdf", "add password", "secure pdf", "password to open", "protect a pdf with a password"],
    summary: "Lock a PDF so it asks for a password to open. This happens on your device and the file is not uploaded.",
    route: "/tools/protect-pdf",
    routeLabel: "Open Protect PDF",
    steps: [
      { text: "Open the Protect PDF tool.", target: "nav-tools" },
      { text: "Choose your PDF, or drop it on the box.", target: "file-dropzone" },
      { text: "Type a password and confirm it. Optionally change what others may do with it: print, copy text and images, or edit." },
      { text: "Choose Protect PDF.", target: "protect-submit" },
      { text: "Choose Download protected PDF.", target: "protect-download" },
    ],
    variants: [
      {
        pages: ["/tools/protect-pdf", "/protect-pdf", "/lock-pdf", "/password-protect-pdf"],
        steps: [
          { text: "Choose your PDF, or drop it on the box.", target: "file-dropzone" },
          { text: "Type a password and confirm it. Optionally change what others may do with it: print, copy text and images, or edit." },
          { text: "Choose Protect PDF.", target: "protect-submit" },
          { text: "Choose Download protected PDF.", target: "protect-download" },
        ],
      },
    ],
    notes: [
      "There is no way to recover a forgotten password, so keep it somewhere safe.",
      OFFICE_PROTECTION
        ? "Word, Excel and PowerPoint files can be protected too, from the Protect tools."
        : "Only PDFs can be protected here at the moment.",
    ],
  },
  {
    id: "find-download",
    kind: "faq",
    title: "Where is my download?",
    keywords: ["where is my download", "find my download", "downloaded file", "where did my pdf go", "downloads folder", "can't find my file", "where is my pdf", "where is my file", "download not working"],
    summary: "Downloads go to your browser's usual downloads location. Documents saved to an account are under History.",
    steps: [
      { text: "Look at your browser's downloads list (usually a download icon near the address bar, or Ctrl+J / Cmd+Shift+J) and open the file from there." },
      { text: "On a phone, check the Files or Downloads app. Some browsers ask where to save the file." },
      { text: "If you saved the document to your account, find it under History.", target: "nav-history" },
    ],
    route: "/history",
    routeLabel: "Open History",
    notes: ["FreePDFScanner never uploads your document, so if you closed the page before downloading, the file cannot be recovered from the website; start again and download it."],
  },
  {
    id: "edit-pdf",
    kind: "howto",
    title: "Edit a PDF: crop, rotate, reorder, add text",
    keywords: ["edit pdf", "edit a pdf", "pdf editor", "crop", "rotate", "reorder pages", "add text", "type on pdf", "fill in a form", "remove a page", "delete page"],
    summary: "Open a PDF as pages, then crop, rotate, reorder or remove pages and add text, drawings, highlights or a signature.",
    route: "/tools/pdf-editor",
    routeLabel: "Open PDF Editor",
    steps: [
      { text: "Open the PDF Editor.", target: "nav-tools" },
      { text: "Upload your PDF.", target: "scan-upload" },
      { text: "Select a page, then choose Edit page to crop or rotate it, or to add text, marks, a signature or a picture.", target: "scan-edit-page" },
      { text: "Use Move earlier / Move later to reorder pages, and the bin button to remove one.", target: "scan-move-earlier" },
      { text: "Choose Create PDF, then Download PDF.", target: "scan-create-pdf" },
    ],
    variants: [
      {
        pages: EDITOR_PAGES,
        steps: [
          { text: "Upload your PDF if you have not already.", target: "scan-upload" },
          { text: "Select a page, then choose Edit page to crop or rotate it, or to add text, marks, a signature or a picture.", target: "scan-edit-page" },
          { text: "Use Move earlier / Move later to reorder pages, and the bin button to remove one.", target: "scan-move-earlier" },
          { text: "Choose Create PDF, then Download PDF.", target: "scan-create-pdf" },
        ],
      },
    ],
    notes: ["Existing text in a PDF is part of the page image and cannot be rewritten. You can cover it, mark it up and add to it."],
  },
  {
    id: "sign-pdf",
    kind: "howto",
    title: "Sign a PDF",
    keywords: ["sign pdf", "sign a pdf", "signature", "add signature", "sign document", "esign", "e-sign", "upload signature", "draw signature"],
    summary: "Draw, type or upload your signature and place it on the page. Free, no account needed.",
    route: "/tools/sign-pdf",
    routeLabel: "Open Sign PDF",
    steps: [
      { text: "Open Sign PDF.", target: "nav-tools" },
      { text: "Upload your document.", target: "scan-upload" },
      { text: "Choose Edit page on the page to sign, then choose Signature.", target: "scan-edit-page" },
      { text: "Draw, type or upload your signature, then apply it. Drag it onto the line and drag the corner dot to resize it." },
      { text: "Choose Done, then Create PDF and Download PDF.", target: "scan-create-pdf" },
    ],
    variants: [
      {
        pages: EDITOR_PAGES,
        steps: [
          { text: "Upload your document if you have not already.", target: "scan-upload" },
          { text: "Choose Edit page on the page to sign, then choose Signature.", target: "scan-edit-page" },
          { text: "Draw, type or upload your signature, then apply it. Drag it onto the line and drag the corner dot to resize it." },
          { text: "Choose Done, then Create PDF and Download PDF.", target: "scan-create-pdf" },
        ],
      },
    ],
    notes: ["This places an image of your signature on the page. It is not a certificate-based digital signature, and I can't give legal advice about whether it will be accepted."],
  },
  {
    id: "compress-pdf",
    kind: "howto",
    title: "Make a PDF or image smaller",
    keywords: ["compress", "compress pdf", "reduce size", "make pdf smaller", "file too big", "shrink pdf", "reduce file size", "email size", "compress image", "compress word", "compress excel", "too large to upload"],
    summary: "Shrink a PDF, image, Word or Excel file with a quality-to-size slider. Text stays readable.",
    route: "/tools/compress-pdf",
    routeLabel: "Open Compress PDF",
    steps: [
      { text: "Open Compress PDF (there are also Compress Image, Word and Excel).", target: "nav-tools" },
      { text: "Choose your file, or drop it on the box.", target: "file-dropzone" },
      { text: "Move the slider to trade quality for size, and watch the estimate." },
      { text: "Choose the compress button, then Download compressed file.", target: "compress-start" },
    ],
    notes: ["If a file cannot be made smaller, you are offered the original instead."],
  },
  {
    id: "ocr",
    kind: "howto",
    title: "Extract text from a scan or photo (OCR)",
    keywords: ["ocr", "extract text", "read text", "text from image", "text from pdf", "copy text from scan", "scanned pdf to text", "pdf to text", "recognise text", "recognize text"],
    summary: "Read the words from scanned PDFs and photos. It runs in your browser and handles English text.",
    route: "/tools/ocr",
    routeLabel: "Open OCR",
    steps: [
      { text: "Open the OCR tool.", target: "nav-tools" },
      { text: "Upload a scanned PDF or a photo.", target: "scan-upload" },
      { text: "Open More options and choose Extract text.", target: "scan-more-options" },
      { text: "Check the text, copy it, or export it as Word, Excel, TXT or CSV." },
    ],
    notes: ["English only, up to 30 pages per run. Handwriting and low-quality photos may not be read accurately."],
  },
  {
    id: "print",
    kind: "howto",
    title: "Print a document",
    keywords: ["print", "print pdf", "print my document", "print a page"],
    summary: "Use the Print button next to your pages or the finished PDF. It opens your browser's print dialog.",
    route: "/scan",
    routeLabel: "Open Scan",
    steps: [
      { text: "Open your document on the Scan page (or an editor tool) so its pages are showing.", target: "scan-upload" },
      { text: "Choose Print (in the Export section), or Print this page inside Edit page." },
      { text: "Choose your printer in your browser's print dialog." },
    ],
  },
  {
    id: "account-history",
    kind: "faq",
    title: "Accounts, saving and History",
    keywords: ["account", "sign up", "log in", "login", "sign in", "history", "save document", "saved documents", "register", "do i need an account"],
    summary: "You do not need an account to scan, edit, sign, convert or download. An account lets you save finished documents to History.",
    route: "/history",
    routeLabel: "Open History",
    steps: [
      { text: "To sign up or log in, use the buttons at the top right of any page.", target: "account-signup" },
      { text: "After creating a PDF, choose Save to account to keep a copy.", target: "scan-save-account" },
      { text: "Find saved documents under History.", target: "nav-history" },
    ],
  },
  {
    id: "themes",
    kind: "howto",
    title: "Change the theme (light, warm beige, dark)",
    keywords: ["theme", "dark mode", "light mode", "dark", "change colours", "change colors", "night mode", "beige"],
    summary: "Choose Light, Warm Beige or Dark from the theme button in the header.",
    steps: [
      { text: "Choose the theme button in the header (the sun, paper or moon icon).", target: "theme-menu" },
      { text: "Pick Light, Warm Beige or Dark. Your choice is remembered on this device." },
    ],
  },
  {
    id: "privacy",
    kind: "privacy",
    title: "Privacy: is my document uploaded?",
    keywords: ["privacy", "is it safe", "safe", "secure", "uploaded", "do you store my files", "private", "my data", "who can see my document", "cookies", "tracking"],
    summary: "Scanning, editing, converting, compressing and protecting happen in your browser, on your own device. Your documents are not uploaded to FreePDFScanner's servers.",
    route: "/privacy",
    routeLabel: "Read the Privacy Policy",
    steps: [
      { text: "Read the full Privacy Policy for details.", target: undefined },
      { text: "Change your cookie and analytics choices from Cookie settings in the page footer." },
    ],
    notes: [
      "FreePDFScanner counts basic usage, such as which tool was opened, but never sees what is inside your document. A document is only stored if you choose Save to account.",
      "This chat assistant never receives your documents. It only sees what you type here and which page you are on.",
    ],
  },
  {
    id: "free",
    kind: "faq",
    title: "Is it free?",
    keywords: ["free", "cost", "price", "pricing", "pay", "premium", "subscription", "watermark"],
    summary: "Every tool listed on the site is free to use, with no account needed. The PDFs you download have no FreePDFScanner watermark.",
  },
  {
    id: "limit-edit-existing-text",
    kind: "limit",
    title: "Can I change the existing text in a PDF?",
    keywords: ["change text in pdf", "edit existing text", "edit the words", "rewrite text", "change the text", "edit text in a pdf", "edit scanned text"],
    summary: "No. The existing text is part of the page image. You can cover, mark up and add to a page, or use PDF to Word to get editable text.",
    route: "/convert/pdf-to-word",
    routeLabel: "Open PDF to Word",
  },
  {
    id: "limit-unlock",
    kind: "limit",
    title: "Can I remove a password from a PDF?",
    keywords: ["unlock pdf", "remove password", "remove pdf password", "decrypt pdf", "password protected pdf won't open", "forgot password pdf"],
    summary: "No. FreePDFScanner can add a password but cannot open or unlock a PDF that already has one. If a locked PDF is uploaded you are told it is password-protected.",
  },
  {
    id: "limit-split",
    kind: "limit",
    title: "Can I split a PDF?",
    keywords: ["split pdf", "extract pages", "separate pdf", "take pages out", "pull pages", "delete pages from pdf"],
    summary: "There is no dedicated split tool. You can open the PDF on the Scan page, remove the pages you do not want, and create a new PDF from the rest.",
    route: "/scan",
    routeLabel: "Open Scan",
    steps: [
      { text: "Upload the PDF on the Scan page.", target: "scan-upload" },
      { text: "Select each page you do not want and choose its bin (Remove page) button." },
      { text: "Choose Create PDF, then Download PDF.", target: "scan-create-pdf" },
    ],
  },
  {
    id: "limit-word-excel-output",
    kind: "limit",
    title: "Can I add things to a Word or Excel file and keep it as Word or Excel?",
    keywords: ["edit word document", "edit docx", "edit excel file", "keep as word", "keep as excel", "word file with picture", "docx image", "insert image in word", "insert picture in word", "insert image in excel"],
    summary: "Not directly. Word, Excel and CSV files are converted to PDF first, so anything you add goes onto the PDF and the result is a PDF. Your original file is not changed. To get an editable Word file, use PDF to Word.",
    route: "/scan",
    routeLabel: "Open Scan",
  },
  {
    id: "troubleshoot-upload",
    kind: "troubleshoot",
    title: "My file will not open or upload",
    keywords: ["won't open", "will not open", "can't upload", "cannot upload", "file not supported", "unsupported", "error", "doesn't work", "not working", "failed", "file too large", "too many pages", "invalid file"],
    summary: "Most problems come from the file type, its size or a password.",
    steps: [
      { text: "Check the type: PDF, Word (.docx), Excel (.xlsx), CSV or an image. Older .doc and .xls files must be saved as .docx or .xlsx first." },
      { text: "Check the size: images and PDFs up to 25 MB; the first 50 pages of a PDF are opened." },
      { text: "A PDF with a password cannot be opened; remove the password in the program that made it." },
      { text: "Try again in an up-to-date browser such as Chrome, Edge, Firefox or Safari." },
    ],
    route: "/scan",
    routeLabel: "Open Scan",
  },
  {
    id: "troubleshoot-camera",
    kind: "troubleshoot",
    title: "The camera does not work",
    keywords: ["camera not working", "camera denied", "camera permission", "allow camera", "no camera", "camera won't start", "black screen camera"],
    summary: "The browser needs your permission, and no other app can be using the camera.",
    steps: [
      { text: "When the browser asks, choose Allow. If you chose Block, click the camera or lock icon in the address bar and allow the camera for this site, then reload." },
      { text: "Close other apps or tabs that may be using the camera." },
      { text: "Or choose Upload document and pick a photo you already took.", target: "scan-upload" },
    ],
    route: "/scan",
    routeLabel: "Open Scan",
  },
  {
    id: "troubleshoot-quality",
    kind: "troubleshoot",
    title: "My scan looks blurry or too dark",
    keywords: ["blurry", "dark scan", "poor quality", "too dark", "bad quality", "unreadable", "faded", "shadow"],
    summary: "Good light and a steady hand matter most, and each page can be enhanced afterwards.",
    steps: [
      { text: "Retake the photo in bright, even light, with the page flat and filling the frame." },
      { text: "Choose Edit page, then try a different enhancement and adjust Brightness and Contrast.", target: "scan-edit-page" },
    ],
  },
];

// ---- derived entries --------------------------------------------------------------

// The list of tools is read from the registries, never typed twice.
function toolCatalogEntry(): HelpEntry {
  const tools = TOOLS.map((t) => `${t.title} (/tools/${t.slug})`);
  const converters = CONVERT_TOOLS.map((t) => `${t.title} (${t.href})`);
  return {
    id: "all-tools",
    kind: "faq",
    title: "What can FreePDFScanner do?",
    keywords: ["what can you do", "what tools", "list of tools", "features", "all tools", "what is this", "help", "what does this site do", "tools"],
    summary:
      "Scan with a camera or upload files; edit, sign and add pictures to pages; convert between Word, Excel, images and PDF; extract text with OCR; compress files; and password-protect a PDF.",
    route: "/tools",
    routeLabel: "See all tools",
    notes: [`Tools: ${tools.join("; ")}.`, `Converters: ${converters.join("; ")}.`],
  };
}

export const ENTRY_LIST: readonly HelpEntry[] = [...ENTRIES, toolCatalogEntry()];

export function getEntry(id: string): HelpEntry | undefined {
  return ENTRY_LIST.find((e) => e.id === id);
}

// ---- pages ---------------------------------------------------------------------------

export function allRoutes(): { href: string; label: string }[] {
  return [
    ...STATIC_ROUTES,
    ...TOOLS.map((t) => ({ href: `/tools/${t.slug}`, label: t.title })),
    ...CONVERT_TOOLS.map((t) => ({ href: t.href, label: t.title })),
  ];
}

export function isKnownRoute(href: string): boolean {
  return allRoutes().some((r) => r.href === href);
}

export interface PageContext {
  path: string;
  label: string;
  // What kind of place it is, so answers can say "on this page".
  area: "scan" | "tool" | "convert" | "home" | "history" | "guide" | "other";
}

export function describePage(pathname: string): PageContext {
  const path = (pathname || "/").split("?")[0].split("#")[0].replace(/\/+$/, "") || "/";
  const route = allRoutes().find((r) => r.href === path);
  if (path === "/") return { path, label: "the home page", area: "home" };
  if (path === "/scan" || path === "/scan-to-pdf" || path === "/edit-pdf" || path === "/jpg-to-pdf" || path === "/png-to-pdf") {
    return { path, label: route?.label ?? "the scanner", area: "scan" };
  }
  if (path === "/history") return { path, label: "History", area: "history" };
  if (path.startsWith("/tools/")) return { path, label: route?.label ?? "a tool", area: "tool" };
  if (path.startsWith("/convert/")) return { path, label: route?.label ?? "a converter", area: "convert" };
  if (path === "/tools" || path === "/convert") return { path, label: route?.label ?? "the tools list", area: path === "/tools" ? "tool" : "convert" };
  if (path.startsWith("/guides")) return { path, label: "the guides", area: "guide" };
  return { path, label: route?.label ?? "this page", area: "other" };
}

function pageMatches(pages: string[], path: string): boolean {
  return pages.some((p) => (p.endsWith("/*") ? path === p.slice(0, -2) || path.startsWith(p.slice(0, -1)) : p === path));
}

// The steps that fit where the visitor is: the tailored variant if there is one
// for this page, otherwise the general steps.
export function stepsFor(entry: HelpEntry, pathname: string): { steps: HelpStep[]; onThisPage: boolean } {
  const path = describePage(pathname).path;
  const variant = entry.variants?.find((v) => pageMatches(v.pages, path));
  if (variant) return { steps: variant.steps, onThisPage: true };
  return { steps: entry.steps ?? [], onThisPage: false };
}

// ---- suggestions -----------------------------------------------------------------------

// Every suggestion points at an entry above, so nothing is offered that the
// product cannot do (tests/assistant/knowledge.mjs enforces this).
export interface Suggestion {
  text: string;
  entryId: string;
}

const BASE_SUGGESTIONS: Suggestion[] = [
  { text: "How do I convert a Word document to PDF?", entryId: "convert-word-to-pdf" },
  { text: "How do I insert my passport photograph?", entryId: "insert-image" },
  { text: "How do I combine multiple PDFs?", entryId: "combine-pdfs" },
  { text: "How do I protect a PDF with a password?", entryId: "protect-pdf" },
  { text: "Where can I find my download?", entryId: "find-download" },
  { text: "How do I use the scanner?", entryId: "use-scanner" },
];

export function suggestionsFor(pathname: string): Suggestion[] {
  const ctx = describePage(pathname);
  if (ctx.area === "convert" && ctx.path.startsWith("/convert/")) {
    const own = ENTRIES.find((e) => e.route === ctx.path);
    if (own) {
      return [{ text: `How do I use ${ctx.label}?`, entryId: own.id }, ...BASE_SUGGESTIONS.filter((s) => s.entryId !== own.id)].slice(0, 5);
    }
  }
  if (ctx.area === "tool" && ctx.path.startsWith("/tools/")) {
    const own = ENTRIES.find((e) => e.route === ctx.path) ?? (ctx.path === "/tools/add-image" ? getEntry("insert-image") : undefined);
    if (own) {
      return [{ text: `How do I use ${ctx.label}?`, entryId: own.id }, ...BASE_SUGGESTIONS.filter((s) => s.entryId !== own.id)].slice(0, 5);
    }
    if (EDITOR_PAGES.includes(ctx.path)) {
      return [
        { text: "How do I edit this PDF?", entryId: "edit-pdf" },
        { text: "How do I insert my passport photograph?", entryId: "insert-image" },
        { text: "How do I sign this document?", entryId: "sign-pdf" },
        { text: "Where can I find my download?", entryId: "find-download" },
      ];
    }
  }
  if (ctx.area === "scan") {
    return [
      { text: "How do I use the scanner?", entryId: "use-scanner" },
      { text: "How do I insert my passport photograph?", entryId: "insert-image" },
      { text: "How do I combine multiple PDFs?", entryId: "combine-pdfs" },
      { text: "Where can I find my download?", entryId: "find-download" },
    ];
  }
  return BASE_SUGGESTIONS;
}

// The text the AI is given to answer from (never the visitor's documents).
export function entriesToPrompt(entries: readonly HelpEntry[], pathname: string): string {
  return entries
    .map((e) => {
      const { steps } = stepsFor(e, pathname);
      const lines = [`## ${e.title} [${e.id}]`, e.summary];
      if (e.route) lines.push(`Page: ${e.route} (${e.routeLabel ?? e.title})`);
      if (steps.length) lines.push("Steps:", ...steps.map((s, i) => `${i + 1}. ${s.text}`));
      if (e.notes?.length) lines.push("Notes:", ...e.notes.map((n) => `- ${n}`));
      return lines.join("\n");
    })
    .join("\n\n");
}

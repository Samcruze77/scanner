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
  // Extra phrases that count only while the visitor is on this entry's own page, where "insert a picture" can only mean
  // this page's picture button (elsewhere the same words belong to another tool).
  pageKeywords?: string[];
  summary: string;
  steps?: HelpStep[];
  // Where to do it (an internal route) and the link text.
  route?: string;
  routeLabel?: string;
  variants?: HelpVariant[];
  // Short honest caveats shown under the steps.
  notes?: string[];
  // Other entries a person asking this may really want (their pages are offered as links too).
  related?: string[];
}

// Pages that are not tools.
export const STATIC_ROUTES: { href: string; label: string }[] = [
  { href: "/", label: "Home" },
  { href: "/scan", label: "Scan to PDF" },
  { href: "/tools", label: "All tools" },
  { href: "/convert", label: "All converters" },
  { href: "/create-word-document", label: "Create Word Document" },
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
    notes: ["Complex layouts may need tidying in Word. Text recognition is English only.", "This converts a PDF you already have. To write a new document from a blank page, use Create Word Document."],
    related: ["create-word-document"],
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
      { text: "Choose Place on page, then drag the picture into position, or use the arrow buttons under the page. Select the picture and choose Edit image to crop it, turn it or set a print size, and Restore original to undo your picture changes. Choose Done editing.", target: "image-edit" },
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
          { text: "Choose Place on page, then drag the picture into position, or use the arrow buttons under the page. Select the picture and choose Edit image to crop it, turn it or set a print size, and Restore original to undo your picture changes. Choose Done editing.", target: "image-edit" },
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
    id: "move-zoom-editor",
    kind: "howto",
    title: "Move around and zoom the page while editing",
    keywords: ["zoom", "zoom in", "zoom out", "pinch", "move page", "move around the page", "pan", "drag the page", "scroll the page", "two fingers", "fit width", "fit page", "page is too small", "make the page bigger", "reset zoom", "hide tools"],
    summary: "In the page editor you can drag the page with one finger, pinch to zoom, or use the zoom buttons.",
    route: "/scan",
    routeLabel: "Open Scan",
    steps: [
      { text: "Choose Edit page, then Add text, signature & marks.", target: "page-annotate" },
      { text: "Choose Move page, then drag the page with one finger or the mouse. Nothing on the page moves while this is on.", target: "annotation-tool-pan" },
      { text: "Pinch to zoom on a touch screen, or use the - and + buttons under the page. Fit page shows the whole page; Fit width fills the screen width.", target: "zoom-fit-width" },
      { text: "Choose Select to move and edit marks again.", target: "annotation-tool-select" },
      { text: "If the toolbars take too much room, choose the arrow at the top to hide the tools, and again to bring them back.", target: "annotation-toggle-tools" },
    ],
    notes: [
      "In Select mode, dragging empty page with a finger also moves around the page; dragging a mark moves that mark.",
      "On a computer, hold Ctrl and scroll to zoom, or press + and - on the keyboard (0 returns to normal size).",
    ],
  },
  {
    id: "position-with-arrows",
    kind: "howto",
    title: "Place text, a signature or a picture exactly with the arrow buttons",
    keywords: ["arrow", "arrows", "nudge", "move text", "move my signature", "move signature", "move the picture", "position exactly", "precise", "line up", "slightly", "keyboard arrow", "arrow keys", "fine adjustment"],
    summary: "Select an item and use the arrow buttons under the page (or the keyboard arrow keys) to move it a small step at a time.",
    route: "/scan",
    routeLabel: "Open Scan",
    steps: [
      { text: "In the page editor, tap the text, signature or picture to select it.", target: "annotation-tool-select" },
      { text: "Use the four arrow buttons under the page to move it. Each press moves it a small, fixed distance, whatever the zoom.", target: "annotation-move-pad" },
      { text: "Switch between Fine (small steps) and Coarse (bigger steps) with the button beside the arrows.", target: "annotation-move-pad" },
      { text: "On a keyboard, the arrow keys move the selected item and Shift + an arrow moves it further. Escape lets go of the item. Undo reverses a move." },
    ],
    notes: ["The arrows are greyed out until something is selected. They never change an item's size or shape, and they keep it on the page."],
  },
  {
    id: "crop-restore-image",
    kind: "howto",
    title: "Crop, resize or restore a picture you placed on a page",
    keywords: ["crop image in pdf", "crop a picture on the page", "crop the picture i added", "restore original image", "restore original", "undo crop", "reset image", "reset size", "reset crop", "edit image in pdf", "edit the picture on my pdf", "picture too big", "picture too small", "image quality in pdf"],
    summary: "Select a placed picture and choose Edit image to crop it, turn it or set a print size; Restore original brings back the picture as you first added it.",
    route: "/tools/add-image",
    routeLabel: "Open Add Image",
    steps: [
      { text: "In the page editor, tap the picture to select it.", target: "annotation-tool-select" },
      { text: "Choose Edit image. Drag the crop box or its handles, or pick a shape such as 1:1 or Passport 35:45. You see what is kept before you apply.", target: "image-edit" },
      { text: "Choose Apply. Reset crop shows the whole picture again, Reset size puts it back to the size it was placed at, and Restore original does both and undoes any turn.", target: "image-edit-apply" },
      { text: "To make it bigger or smaller without cropping, drag its corner dot or use Smaller and Larger." },
      { text: "After a picture has been changed, Restore original also appears in the toolbar for one-tap return.", target: "image-restore" },
    ],
    notes: [
      "Your original picture is kept untouched; each crop is made from it again, so repeated edits do not wear the picture down.",
      "A print size sets how big the picture is on paper. It does not add detail: a small picture printed large will look soft, and the editor warns you when the picture is low resolution at its size.",
      "Undo reverses each change. For flipping, brightness or saving as another file type, use the Edit Image tool.",
    ],
  },
  {
    id: "finish-and-download",
    kind: "howto",
    title: "Finish editing and download the finished PDF",
    keywords: ["finish editing", "done editing", "finished editing", "i am done", "what next", "next step", "create pdf", "export pdf", "save my pdf", "get my pdf", "how do i download", "download my edited", "download the pdf", "how do i save"],
    summary: "Choose Done editing, then Create PDF, then Download PDF.",
    route: "/scan",
    routeLabel: "Open Scan",
    steps: [
      { text: "When your text, signature or pictures are in place, choose Done editing in the page editor.", target: "annotation-done" },
      { text: "Choose Done editing again to leave the page screen. Your changes stay on the page.", target: "page-done" },
      { text: "Choose Create PDF to build the finished file. This happens on your device.", target: "scan-create-pdf" },
      { text: "Choose Download PDF to save it. The page tells you when the download has started.", target: "scan-download-pdf" },
    ],
    notes: [
      "If you change a page after creating the PDF, choose Create PDF again so the new file includes the change.",
      "FreePDFScanner does not keep your document, so download it before you close the page.",
    ],
  },
  {
    id: "help-tips",
    kind: "faq",
    title: "Turn the help tips on or off",
    keywords: ["tips", "help tips", "turn off tips", "turn on tips", "stop showing tips", "hints", "stop the pop ups", "show me tips"],
    summary: "Small tips can appear while you edit. You can turn them off or on again from the footer at the bottom of any page.",
    steps: [{ text: "Scroll to the bottom of the page and choose Turn help tips off (or on).", target: "tips-toggle" }],
    notes: ["The Ask me button stays available either way. Your choice is stored only in this browser."],
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
    id: "edit-image",
    kind: "howto",
    title: "Crop, rotate, resize or adjust a photo and download it as an image",
    keywords: ["edit image", "edit photo", "edit a picture", "crop a photo", "crop an image", "crop a picture", "rotate a photo", "rotate an image", "flip an image", "flip a photo", "resize an image", "resize a photo", "resize a picture", "change image size", "change image dimensions", "image brightness", "change image format", "convert png to jpg", "convert jpg to png", "convert to webp", "save as png", "save as jpeg", "photo editor"],
    summary: "Open one picture, crop, rotate, flip, resize and adjust it, then download it as a JPEG, PNG or WebP file.",
    route: "/tools/edit-image",
    routeLabel: "Open Edit Image",
    steps: [
      { text: "Open the Edit Image tool.", target: "nav-tools" },
      { text: "Choose a picture, or drop one on the page.", target: "file-dropzone" },
      { text: "Choose Crop to cut the picture to a shape, then Apply crop. Use Rotate and Flip to turn it, Resize to change its size in pixels, and the sliders for brightness and contrast.", target: "image-edit-crop" },
      { text: "Pick a format (JPEG, PNG or WebP), then choose Download image.", target: "image-edit-download" },
    ],
    variants: [
      {
        pages: ["/tools/edit-image"],
        steps: [
          { text: "Choose a picture, or drop one on the page.", target: "file-dropzone" },
          { text: "Choose Crop to cut the picture to a shape, then Apply crop. Use Rotate and Flip to turn it, Resize to change its size in pixels, and the sliders for brightness and contrast.", target: "image-edit-crop" },
          { text: "Pick a format (JPEG, PNG or WebP), then choose Download image.", target: "image-edit-download" },
        ],
      },
    ],
    notes: [
      "This tool downloads a picture file, not a PDF. To put a picture on a PDF page, use Add Image.",
      "Your picture stays on your device. The original is never changed, and Undo, Reset edits and Restore original are there if you change your mind.",
      "The download keeps the picture's full size unless you crop or resize it. JPEG cannot keep transparency, so transparent areas are filled with a colour you choose, white by default.",
      "JPEG and lossy WebP discard a little detail when saved; PNG does not. Making a picture larger cannot add detail that was not there.",
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
      { text: "Choose Done editing, then Create PDF and Download PDF.", target: "scan-create-pdf" },
    ],
    variants: [
      {
        pages: EDITOR_PAGES,
        steps: [
          { text: "Upload your document if you have not already.", target: "scan-upload" },
          { text: "Choose Edit page on the page to sign, then choose Signature.", target: "scan-edit-page" },
          { text: "Draw, type or upload your signature, then apply it. Drag it onto the line and drag the corner dot to resize it." },
          { text: "Choose Done editing, then Create PDF and Download PDF.", target: "scan-create-pdf" },
        ],
      },
    ],
    notes: ["This places an image of your signature on the page. It is not a certificate-based digital signature, and I can't give legal advice about whether it will be accepted."],
  },
  {
    id: "add-signature",
    kind: "howto",
    title: "Add a signature to a PDF or a document",
    keywords: [
      "add a signature to a pdf or document",
      "add signature to a pdf or document",
      "signature to a pdf or document",
      "sign a pdf or document",
      "sign a pdf or a document",
      "sign a pdf or word document",
      "sign a document or pdf",
      "add a signature to a document",
      "signature on a pdf or word document",
      "difference between a pdf signature and a word signature",
      "pdf signature or word signature",
    ],
    summary:
      "You can sign two ways. To sign a PDF, a scan, a photo or a Word (.docx) file you already have, use Sign PDF: it puts your signature on a page and gives you a PDF. To put a signature in a Word document you are writing, use Add signature in Create Word Document: it gives you an editable .docx.",
    route: "/tools/sign-pdf",
    routeLabel: "Open Sign PDF",
    related: ["word-doc-pictures", "sign-pdf"],
    steps: [
      { text: "To sign a PDF or a document you already have: open Sign PDF.", target: "nav-tools" },
      { text: "Upload your PDF, photo, scan or Word (.docx) file. A Word file is converted to PDF pages first.", target: "scan-upload" },
      { text: "Select the page to sign and choose Edit page, then Signature. Draw, type or upload your signature and apply it. Drag it onto the line and drag the corner dot to resize it.", target: "scan-edit-page" },
      { text: "Choose Done editing, then Create PDF and Download PDF.", target: "scan-create-pdf" },
      { text: "To put your signature in a Word document you are writing: open Create Word Document, click where it should go, choose Add signature, draw, type or upload it, and apply it. Download it with Download Word (.docx).", target: "wc-signature" },
    ],
    notes: [
      "In a PDF, the signature is placed on a page of the PDF you download, and you finish by choosing Create PDF. In Create Word Document the signature is a picture inside a document you can still keep editing: you can click it to resize, align or delete it.",
      "Create Word Document starts from a blank page and does not open an existing file. To sign a Word file you already have, upload it to Sign PDF; you will get a PDF, not a Word file.",
      "Either way it is a picture of your handwriting or typed name. It is not a certificate-based digital signature, and I can't give legal advice about whether it will be accepted.",
    ],
  },
  {
    id: "edit-document",
    kind: "howto",
    title: "Edit a PDF or a document",
    keywords: [
      "edit a pdf or document",
      "edit a pdf or a document",
      "edit a pdf or word document",
      "edit a document or pdf",
      "edit a document",
      "edit my document",
      "edit a word document",
      "edit word document",
      "edit a pdf or word file",
      "change a pdf or document",
    ],
    summary:
      "What you can do depends on the file. For a PDF, a scan, a photo or a Word (.docx) file, the PDF Editor lets you crop, rotate, reorder and remove pages and add text, marks, a signature or a picture, and gives you a PDF. To change the words already in a file, convert the PDF to Word and edit it there. To write a new Word document, use Create Word Document.",
    route: "/tools/pdf-editor",
    routeLabel: "Open PDF Editor",
    related: ["convert-pdf-to-word", "create-word-document", "limit-edit-existing-text", "edit-image"],
    steps: [
      { text: "To mark up or rearrange a PDF, scan, photo or Word (.docx) file: open the PDF Editor.", target: "nav-tools" },
      { text: "Upload the file. A Word file is converted to PDF pages first.", target: "scan-upload" },
      { text: "Select a page and choose Edit page to crop or rotate it, or to add text, marks, a signature or a picture. Use Move earlier / Move later to reorder pages and the bin button to remove one.", target: "scan-edit-page" },
      { text: "Choose Create PDF, then Download PDF.", target: "scan-create-pdf" },
      { text: "To change the existing words in a PDF, use PDF to Word to get an editable .docx. To write a new Word document from nothing, use Create Word Document." },
    ],
    notes: [
      "The PDF Editor cannot rewrite text that is already in a PDF: it is part of the page image. You can cover it, mark it up and add to it.",
      "Create Word Document starts from a blank page. It does not open or change a file you already have.",
      "For a single photo, Edit Image can crop, rotate, resize and adjust it and download it as a picture file.",
    ],
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
    notes: ["English only, up to 30 pages per run. Handwriting and low-quality photos may not be read accurately.", "This reads text that is already on a scan or photo. To write a new Word document from a blank page, use Create Word Document."],
    related: ["create-word-document"],
  },
  {
    id: "create-word-document",
    kind: "howto",
    title: "Create a Word document from scratch",
    keywords: [
      "create word document",
      "create a word document",
      "create a new word document",
      "new word document",
      "blank word document",
      "blank document",
      "word document from scratch",
      "word doc from scratch",
      "make a word document",
      "write a word document",
      "create docx",
      "create a docx",
      "start a new document",
      "write a document",
      "type a document",
      "compose a document",
      "create a document",
      "create document",
      "where is create word document",
      "find create word document",
    ],
    summary:
      "Create Word Document opens a blank white page where you write a brand-new document, then download it as a Word (.docx) file you can keep editing in Word. You do not upload anything, and no account is needed.",
    route: "/create-word-document",
    routeLabel: "Open Create Word Document",
    steps: [
      { text: "Open Create Word Document: choose Tools in the top menu, then Create Word Document in the Create section at the top. It is also on the home page.", target: "nav-tools" },
      { text: "Type a name in the Document name box at the top. It starts as Untitled Document.", target: "wc-title" },
      { text: "Click the white page and start typing. Press Enter for a new paragraph." },
      { text: "Use the toolbar to format it: choose Heading 1, 2 or 3 from the paragraph style list for headings, then set the font, size, colour, and use Paragraph for spacing, indents, lists and alignment. Margins and Add page are on the toolbar too.", target: "wc-style" },
      { text: "Add pictures with Insert image, or your signature with Add signature.", target: "wc-insert-image" },
      { text: "Your draft saves in this browser as you type. Choose Save now to save straight away.", target: "wc-save" },
      { text: "When you are done, choose Download Word (.docx).", target: "wc-download" },
    ],
    variants: [
      {
        pages: ["/create-word-document"],
        steps: [
          { text: "Type a name in the Document name box at the top. It starts as Untitled Document.", target: "wc-title" },
          { text: "Click the white page and start typing. Press Enter for a new paragraph." },
          { text: "Use the toolbar to format it: choose Heading 1, 2 or 3 from the paragraph style list for headings, then set the font, size, colour, and use Paragraph for spacing, indents, lists and alignment. Margins and Add page are on the toolbar too.", target: "wc-style" },
          { text: "Add pictures with Insert image, or your signature with Add signature.", target: "wc-insert-image" },
          { text: "Your draft saves in this browser as you type. Choose Save now to save straight away.", target: "wc-save" },
          { text: "When you are done, choose Download Word (.docx).", target: "wc-download" },
        ],
      },
    ],
    related: ["convert-pdf-to-word", "ocr"],
    notes: [
      "This starts a new document. To turn an existing PDF into an editable Word file, use PDF to Word. To read the words in a scan or photo, use OCR.",
      "Drafts stay in this browser on this device. They are not saved to an account, so download the .docx to keep or share a copy.",
    ],
  },
  {
    id: "word-doc-formatting",
    kind: "howto",
    title: "Format text in a Word document you are creating",
    keywords: [
      "add a heading",
      "heading and body text",
      "heading and body",
      "change the font",
      "change font",
      "font size",
      "text size",
      "text colour",
      "text color",
      "change the colour",
      "change the color",
      "line spacing",
      "paragraph spacing",
      "spacing in my document",
      "format my document",
      "format text in my word document",
      "align text in my document",
      "bulleted list in my document",
      "numbered list in my document",
    ],
    pageKeywords: ["heading", "headings", "font", "colour", "color", "spacing", "bold", "italic", "underline", "highlight", "format", "align"],
    summary: "In Create Word Document, select your text and use the toolbar above the page. Everything on the toolbar works on the text or paragraph you have selected.",
    route: "/create-word-document",
    routeLabel: "Open Create Word Document",
    steps: [
      { text: "Open Create Word Document and click in the page.", target: "nav-tools" },
      { text: "Select the text you want to change: drag over it, or double-click a word. For a whole paragraph, click inside it." },
      { text: "For a heading, open the paragraph style list and choose Title, Subtitle, Heading 1, Heading 2 or Heading 3. Choose Normal text to go back to body text.", target: "wc-style" },
      { text: "Open the Font list to choose Arial, Times New Roman, Calibri, Georgia or Verdana. For the size, use the Font size group: pick a size from its list, press Increase font size or Decrease font size, or type a number.", target: "wc-font" },
      { text: "Use the Bold, Italic, Underline and Strikethrough buttons, and the Text colour and Highlight colour buttons (pick a swatch or a custom colour)." },
      { text: "For line spacing, spacing before and after a paragraph, and indents, choose Paragraph and use its Line spacing, Before, After and Indentation boxes.", target: "wc-paragraph" },
      { text: "Use the alignment, indent, bulleted list and numbered list buttons (also in the Paragraph menu) for the layout." },
    ],
    notes: ["Tables, headers, footers and page numbers are not available yet."],
  },
  {
    id: "word-doc-font-size",
    kind: "howto",
    title: "Change the font size in a Word document you are creating",
    keywords: [
      "font size without typing",
      "change the font size without typing a number",
      "pick a font size",
      "choose a font size",
      "font size list",
      "font size dropdown",
      "increase font size",
      "decrease font size",
      "increase or decrease font size",
      "make the text bigger",
      "make the text smaller",
      "bigger text",
      "smaller text",
      "mixed font sizes",
    ],
    pageKeywords: ["font size", "text size", "size", "bigger", "smaller", "increase", "decrease"],
    summary: "In Create Word Document the Font size group on the toolbar has a list of standard sizes, so you can pick a size without typing a number, and buttons that make text one step bigger or smaller.",
    route: "/create-word-document",
    routeLabel: "Open Create Word Document",
    steps: [
      { text: "Open Create Word Document.", target: "nav-tools" },
      { text: "Select the text you want to change, or click where you are about to type. For all of it, press Ctrl+A." },
      { text: "Find the group labelled Font size on the toolbar (on a phone it is on the second row). Choose the small arrow next to the size box, then pick a size from the list: 8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48 or 72. Scroll the list for the rest." },
      { text: "Or use Decrease font size (A−) and Increase font size (A+): each press moves to the next standard size." },
      { text: "You can also type any size from 1 to 400 in the box and press Enter." },
    ],
    notes: [
      "The box shows the size at the caret. If your selection has several sizes it shows Mixed, and the buttons then move each piece of text one step, so the sizes stay different from each other.",
      "Choosing a size never moves your selection or caret.",
    ],
  },
  {
    id: "word-doc-margins",
    kind: "howto",
    title: "Change the page margins of a Word document you are creating",
    keywords: [
      "page margins",
      "change the margins",
      "change the page margins",
      "set the margins",
      "narrow margins",
      "wide margins",
      "custom margins",
      "margins in my word document",
      "margins in word document",
      "document margins",
    ],
    pageKeywords: ["margins", "margin", "narrow", "wide", "moderate"],
    summary: "Page margins are set for the whole document: choose Normal, Narrow, Moderate or Wide, or enter your own top, bottom, left and right margins in inches.",
    route: "/create-word-document",
    routeLabel: "Open Create Word Document",
    steps: [
      { text: "Open Create Word Document.", target: "nav-tools" },
      { text: "Choose Margins on the toolbar. On a phone, choose the three dots (More), then Page margins.", target: "wc-more" },
      { text: "Pick Normal, Narrow, Moderate or Wide. The page changes straight away." },
      { text: "For your own margins, type the top, bottom, left and right values in inches (each from 0.25 to 4) and choose Apply custom margins." },
    ],
    notes: [
      "The same margins are used in the downloaded .docx, and they are saved with your draft. Your text is never changed.",
      "Values that are negative, too small or too large, or that leave too little room for text, are refused with a message.",
      "On a phone the page is drawn narrower so the text stays readable, but the margins in the file are the ones you chose.",
    ],
  },
  {
    id: "word-doc-paragraph",
    kind: "howto",
    title: "Change paragraph alignment, line spacing and indents",
    keywords: [
      "paragraph alignment",
      "paragraph formatting",
      "change the paragraph alignment",
      "line spacing",
      "change line spacing",
      "double spacing",
      "single spacing",
      "paragraph spacing",
      "space before and after",
      "space between paragraphs",
      "first line indent",
      "indent a paragraph",
      "left indent",
      "right indent",
      "hanging indent",
      "justify text",
      "centre text",
      "center text",
      "align text",
    ],
    pageKeywords: ["paragraph", "alignment", "align", "justify", "spacing", "indent", "indentation", "centre", "center"],
    summary: "The Paragraph menu in Create Word Document sets alignment, line spacing, space before and after, indents and lists for the paragraphs you have selected.",
    route: "/create-word-document",
    routeLabel: "Open Create Word Document",
    steps: [
      { text: "Open Create Word Document.", target: "nav-tools" },
      { text: "Click in the paragraph, or select several paragraphs." },
      { text: "Choose Paragraph on the toolbar (on a phone it is in the bar at the bottom of the screen).", target: "wc-paragraph" },
      { text: "Choose Left, Centre, Right or Justify for alignment." },
      { text: "Pick Line spacing: Single, 1.15, 1.5 or Double (or a larger value), and type the space Before and After the paragraph in points." },
      { text: "Under Indentation, type the Left and Right indent and the First line indent in inches. A negative first-line value makes a hanging indent." },
      { text: "Use the bullet and numbered list buttons in the same menu for lists." },
    ],
    notes: ["Only the selected paragraphs change, and your text and caret stay where they were. Line spacing, spacing, alignment and indents are all kept in the downloaded .docx."],
  },
  {
    id: "word-doc-add-page",
    kind: "howto",
    title: "Add a new page to a Word document you are creating",
    keywords: [
      "add a page",
      "add page",
      "insert a new page",
      "insert a page",
      "new page",
      "start a new page",
      "page break",
      "insert a page break",
      "new page before the current page is full",
      "page before the page is full",
    ],
    pageKeywords: ["page", "pages", "break"],
    summary: "Add page starts a new page right where your caret is, even when the page you are on is not full. It is a real page break, not a pile of blank lines.",
    route: "/create-word-document",
    routeLabel: "Open Create Word Document",
    steps: [
      { text: "Open Create Word Document.", target: "nav-tools" },
      { text: "Click where the new page should begin. Anything after the caret moves to the new page." },
      { text: "Choose Add page (the page with a plus sign) on the toolbar, or in the bar at the bottom of a phone screen. On a keyboard you can press Ctrl+Enter.", target: "wc-add-page" },
      { text: "A labelled Page break line appears and you can carry on typing at the top of the new page." },
    ],
    notes: [
      "To remove a page break, undo with Ctrl+Z straight away, or click the Page break line and press Delete.",
      "The page break is saved with your draft and kept in the downloaded .docx, so Word starts the new page in the same place.",
    ],
  },
  {
    id: "word-doc-phone-navigation",
    kind: "howto",
    title: "Move around a Word document on a phone",
    keywords: [
      "navigate on a phone",
      "navigate through my document on a phone",
      "move around on a phone",
      "arrow keys on a phone",
      "no arrow keys",
      "move the cursor on a phone",
      "move the caret",
      "phone navigation keys",
      "navigation keys",
      "scroll through my document",
      "zoom on a phone",
      "make the page bigger on my phone",
      "the page is too small on my phone",
    ],
    pageKeywords: ["navigate", "navigation", "arrow", "arrows", "cursor", "caret", "scroll", "phone", "zoom"],
    summary: "On a phone the page is the real A4 sheet drawn smaller to fit your screen. Zoom in to read and type, tap to put the caret where you want it, scroll with your finger, and show a row of on-screen navigation keys if you need them.",
    route: "/create-word-document",
    routeLabel: "Open Create Word Document",
    steps: [
      { text: "Open Create Word Document." },
      { text: "The whole A4 page is shown at once, scaled down to fit your screen. Choose the three dots (More), then the + button under Zoom (or 100%) to make it bigger, and scroll sideways to move around; Fit to screen brings the whole page back." },
      { text: "Tap in the text to put the caret there, and drag the page with your finger to scroll through the pages. The page scrolls normally, so you will not trigger editing controls by accident." },
      { text: "For finer movement, choose the three dots (More), then Show navigation keys. A row of keys appears above the bottom bar: arrows, Home and End (start and end of the line), Page up and Page down, and Top and Bottom of the document.", target: "wc-more" },
      { text: "The keys move the caret without closing the keyboard or typing anything. Choose Hide navigation keys in the same menu to put them away." },
    ],
    notes: [
      "Zooming only changes how big the page looks. The text, the line breaks and the page breaks are the same on a phone as on a computer and in the downloaded Word file, so a paragraph that takes five lines on the computer takes five lines on your phone.",
      "With a physical keyboard the arrow keys, Home, End, Page Up and Page Down work as usual in the text.",
    ],
  },
  {
    id: "word-doc-where-controls",
    kind: "faq",
    title: "Where are the page, paragraph and image controls?",
    keywords: [
      "where can i find the page controls",
      "where is the paragraph menu",
      "where are the image controls",
      "where are the page margins",
      "where is the add page button",
      "find the paragraph controls",
      "find the page controls",
      "toolbar controls",
      "where are the controls",
    ],
    pageKeywords: ["where", "find", "controls", "toolbar"],
    summary: "On a wide screen everything is on the toolbar above the page. On a phone the main actions are in a bar at the bottom of the screen and the rest are under the three dots (More).",
    route: "/create-word-document",
    routeLabel: "Open Create Word Document",
    steps: [
      { text: "Page: Margins on the toolbar sets the page margins. Add page starts a new page. On a phone, use More for Page margins and the bottom bar for Add page." },
      { text: "Paragraph: the Paragraph button opens alignment, line spacing, spacing, indents and lists. On a phone it is the first button in the bottom bar." },
      { text: "Pictures: Insert image adds a picture and Add signature adds your signature. Click a picture to see its width buttons, description box and Delete picture." },
      { text: "Text: Paragraph style, Font, the Font size group, Bold, Italic, Underline and colours are on the toolbar. On a phone, Font and the less common buttons are under More." },
      { text: "Saving and downloading: Save now and Download Word (.docx) are at the top on a wide screen and in the bottom bar on a phone." },
    ],
  },
  {
    id: "word-doc-pictures",
    kind: "howto",
    title: "Add a picture or your signature to a Word document you are creating",
    keywords: [
      "picture in my word document",
      "image in my word document",
      "insert picture in word document",
      "insert image in word document",
      "add image to word document",
      "add picture to word document",
      "add a picture to my document",
      "signature in word document",
      "signature in my word document",
      "add signature to word document",
      "add my signature to a word document",
      "sign my word document",
      "put my signature in word document",
      "signature word document",
    ],
    pageKeywords: ["insert picture", "insert image", "add picture", "add image", "picture", "image", "signature", "add signature", "sign"],
    summary: "In Create Word Document you can insert a picture from a file, or add your signature by drawing, typing or uploading it. Both are placed on the page as pictures you can resize and align.",
    route: "/create-word-document",
    routeLabel: "Open Create Word Document",
    steps: [
      { text: "Open Create Word Document and click where you want the picture to go.", target: "nav-tools" },
      { text: "Choose Insert image and pick a PNG, JPEG, WebP or GIF (up to 10 MB). You can also paste a picture or drag it onto the page.", target: "wc-insert-image" },
      { text: "For your signature, choose Add signature, then draw it, type it or upload a picture of it, and apply it.", target: "wc-signature" },
      { text: "Click the picture to select it. Picture options appear with 25%, 50%, 75% and 100% width buttons, a description box and Delete picture. Drag the corner handle to resize it, and use the align buttons to put it on the left, centre or right." },
      { text: "Click below the picture to carry on typing." },
    ],
    notes: [
      "A signature added this way is a picture of your handwriting or typed name. It is not a certified digital signature.",
      "WebP and GIF pictures are converted to PNG so Word can keep them.",
    ],
  },
  {
    id: "word-doc-save-download",
    kind: "howto",
    title: "Save and download a Word document you created",
    keywords: [
      "save my word document",
      "save my document",
      "download word document",
      "download as word",
      "download my document as word",
      "download docx",
      "save as docx",
      "recover my document",
      "restore my draft",
      "my drafts",
      "lost my document",
      "autosave",
      "new document",
    ],
    pageKeywords: ["save", "download", "draft", "drafts", "recover", "restore"],
    summary: "Create Word Document saves a draft in your browser as you type, and you download the finished document as a .docx file.",
    route: "/create-word-document",
    routeLabel: "Open Create Word Document",
    steps: [
      { text: "Just keep typing: a moment after you stop, the draft is saved in this browser. The message beside the name says Saving, Saved or Save failed." },
      { text: "Choose Save now to save straight away.", target: "wc-save" },
      { text: "To pick up later, open Create Word Document again on the same device and browser. Your last draft comes back. Choose My drafts to open or delete older ones, or New document to start another without losing this one.", target: "wc-new" },
      { text: "Choose Download Word (.docx). On a phone, Save and Download are in the bar at the bottom of the screen. The file is named after your Document name and goes to your browser's Downloads.", target: "wc-download" },
    ],
    notes: [
      "Drafts are kept in this browser on this device only. They are not uploaded and not saved to an account, and clearing the site's data removes them. Download the .docx for anything important.",
      "Word lays pages out with its own engine, so line and page breaks can differ slightly from what you see. Your text, formatting, pictures and links are kept.",
    ],
  },
  {
    id: "word-create-or-convert",
    kind: "faq",
    title: "Create a Word document, convert a PDF to Word, or extract text?",
    keywords: [
      "difference between creating a word document and converting",
      "create or convert",
      "create vs convert",
      "creating a word document and converting a pdf",
      "will creating a word document change my pdf",
      "does creating a word document change my pdf",
      "creating a word document change",
      "creating a word document affect",
      "creating a word document modify",
      "creating a word document delete",
      "create a word document or convert a pdf",
      "new word document or convert pdf",
    ],
    summary:
      "Create Word Document starts from a blank page and does not open or change any of your files. PDF to Word turns a PDF you upload into an editable Word file. OCR reads the words from a scan or photo so you can copy them.",
    route: "/create-word-document",
    routeLabel: "Open Create Word Document",
    related: ["convert-pdf-to-word", "ocr"],
    notes: [
      "Want a new document written from nothing? Use Create Word Document.",
      "Want to edit a PDF you already have in Word? Use PDF to Word.",
      "Want the text from a scanned page or a photo? Use OCR (English only).",
      "None of these changes your original PDF or image.",
    ],
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
    summary: "Not directly. Word, Excel and CSV files are converted to PDF first, so anything you add goes onto the PDF and the result is a PDF. Your original file is not changed. To get an editable Word file, use PDF to Word. To write a new Word document from a blank page instead, use Create Word Document.",
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
      "Scan with a camera or upload files; edit, sign and add pictures to pages; convert between Word, Excel, images and PDF; extract text with OCR; compress files; password-protect a PDF; and create a new Word document from a blank page.",
    route: "/tools",
    routeLabel: "See all tools",
    notes: [`Tools: ${tools.join("; ")}.`, `Converters: ${converters.join("; ")}.`],
  };
}

// On the Create Word Document page itself, its answers drop the "open the page" step: the visitor is already there.
for (const e of ENTRIES) {
  if (e.route === "/create-word-document" && e.steps && !e.variants) {
    e.variants = [{ pages: [e.route], steps: e.steps.filter((st) => !st.text.startsWith("Open Create Word Document")) }];
  }
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
  { text: "Create a Word document from scratch", entryId: "create-word-document" },
  { text: "How do I add a signature to a PDF or document?", entryId: "add-signature" },
  { text: "How do I edit a PDF or document?", entryId: "edit-document" },
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

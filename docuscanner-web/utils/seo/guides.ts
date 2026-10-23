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
          "A phone or computer with a camera (or photos you have already taken), a flat surface, and decent light. That is all. FreePDFScanner runs in your browser, so there is nothing to install.",
        ],
      },
      {
        h2: "Scan a document to PDF, step by step",
        steps: [
          "Open the FreePDFScanner scanner in your browser and choose Use camera. Allow camera access when your browser asks. If you already have photos, choose Upload document instead.",
          "Photograph the first page, then the next. Each photo becomes one page. FreePDFScanner finds the edges of the paper and straightens it for you.",
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
          "Some forms and email systems have a hard limit, such as 2 MB. Under More options you can enter a target size. FreePDFScanner picks the lightest level that fits, and says so if it cannot reach the target without ruining the pages.",
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
      { href: "/guides/how-to-compress-a-pdf-to-1mb-or-2mb", label: "How to compress a PDF to 1 MB or 2 MB", note: "Set a target size for an upload limit." },
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
          "FreePDFScanner's free OCR reads English only, and up to 30 pages in one run.",
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
      { href: "/guides/how-to-create-a-word-document-from-scratch", label: "Create a Word document from scratch", note: "Start a new document instead of reading an existing scan." },
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
          "That depends on the document and where you are. What you add here is an image of your signature placed on the page, the same as signing on paper. It is not a certificate-based digital signature, and FreePDFScanner cannot give legal advice. If the person or organisation asking for your signature requires a specific e-signature service or a certified signature, check with them first.",
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
      { href: "/guides/how-to-create-a-word-document-from-scratch", label: "Create a Word document from scratch", note: "Writing a new document? Add your signature to it too." },
      { href: "/tools/annotate", label: "Annotate a PDF", note: "Add text, dates and check marks too." },
      { href: "/tools/pdf-editor", label: "Edit a PDF online", note: "Crop, rotate and reorder pages." },
      { href: "/tools/compress-pdf", label: "Compress a PDF", note: "Shrink the signed file before you send it." },
    ],
  },
  {
    slug: "how-to-create-a-word-document-from-scratch",
    title: "Create a Word Document from Scratch (Free, No Account)",
    description:
      "Write a new Word document from a blank page in your browser, format it, add pictures and your signature, and download a real .docx. Includes saving, draft recovery and troubleshooting.",
    h1: "Create a Word document from scratch",
    intro:
      "You do not need Word installed, an account or an existing file to start a document. Create Word Document gives you a blank white page in your browser; you write, format and download it as a .docx you can keep editing in Microsoft Word.",
    published: "2026-10-22",
    updated: "2026-10-22",
    sections: [
      {
        h2: "Open Create Word Document",
        steps: [
          "Choose Tools in the top menu, then Create Word Document in the Create section at the top. It is also on the home page.",
          "Or go straight to the page with the button below. Nothing is uploaded and no account is needed.",
        ],
      },
      {
        h2: "Start a blank document",
        paragraphs: [
          "The page opens blank, with the name Untitled Document in the Document name box at the top and a formatting toolbar above an A4 page. Click the page and start typing. If you come back later, your last draft is restored; choose New document to start again with a clean page (your earlier draft is kept under My drafts).",
        ],
      },
      {
        h2: "Enter a title, headings and body text",
        steps: [
          "Type a name in the Document name box. It becomes the name of the downloaded file.",
          "Click the page and type. Press Enter to start a new paragraph.",
          "To make a heading, click in the line and open the paragraph style list on the toolbar. Choose Title, Subtitle, Heading 1, Heading 2 or Heading 3. Choose Normal text for body text.",
          "Headings are real Word headings, so they show up in Word's navigation pane after you download the file.",
        ],
      },
      {
        h2: "Select text and format it",
        paragraphs: ["Select the text first (drag over it, or double-click a word), then use the toolbar. The buttons keep your selection."],
        bullets: [
          "Font: Arial, Times New Roman, Calibri, Georgia or Verdana.",
          "Font size: the group labelled Font size has a list of standard sizes (8 to 72 points, scroll for all of them), a box where you can type any size from 1 to 400, and Decrease font size and Increase font size buttons that move one standard size at a time. If your selection has several sizes the box says Mixed.",
          "Bold, italic, underline, strikethrough, superscript and subscript.",
          "Text colour and highlight colour: pick a swatch or a custom colour.",
          "Paragraph: the Paragraph menu sets alignment (left, centre, right, justified), line spacing (Single, 1.15, 1.5, Double and more), space before and after a paragraph in points, left and right indents and a first-line or hanging indent in inches, and has the bulleted and numbered list buttons.",
          "Links, a horizontal line and your signature are on the toolbar too.",
          "Undo and redo, and Clear text formatting.",
        ],
      },
      {
        h2: "Set the page margins and add pages",
        steps: [
          "To change the margins, choose Margins on the toolbar (on a phone: the three dots, then Page margins). Pick Normal, Narrow, Moderate or Wide, or type your own top, bottom, left and right margins in inches (each from 0.25 to 4) and choose Apply custom margins. Invalid values are refused with a message.",
          "To start a new page, click where it should begin and choose Add page (the page with a plus sign), or press Ctrl+Enter. The text after the caret moves to the new page even if the page you were on is not full, and a labelled Page break line shows where it starts.",
          "To remove a page break, undo it straight away with Ctrl+Z, or click the Page break line and press Delete.",
        ],
        paragraphs: ["The margins and every page break are saved with your draft and written into the .docx, so Word separates the pages in the same places."],
      },
      {
        h2: "Insert pictures and your signature",
        steps: [
          "Choose Insert image and pick a PNG, JPEG, WebP or GIF up to 10 MB. You can also paste a picture or drag it onto the page.",
          "To add your signature, choose Add signature, draw it, type it or upload a picture of it, and apply it. It is placed like any other picture.",
          "Click a picture to select it. Choose 25%, 50%, 75% or 100% width, drag the corner handle to resize it, or use the align buttons to put it on the left, centre or right. Add a description for screen readers, or choose Delete picture.",
        ],
      },
      {
        h2: "How saving and draft recovery work",
        paragraphs: [
          "Your draft is saved in this browser a moment after you stop typing. The message beside the document name says Saving, Saved or Save failed, and it only says Saved once the draft really is stored. Choose Save now to save straight away.",
          "Drafts live on this device and in this browser only. They are not uploaded and are not saved to a FreePDFScanner account, so clearing the site's data removes them and they do not appear on your other devices. Choose My drafts to open or delete older drafts.",
        ],
      },
      {
        h2: "Download the finished .docx",
        steps: [
          "Choose Download Word (.docx).",
          "The file is named after your Document name and opens in Microsoft Word and other office apps, where you can keep editing it.",
        ],
      },
      {
        h2: "Writing on a phone",
        paragraphs: [
          "On a phone the page is drawn as wide as your screen (Phone view) so the text stays a readable size, and the page scrolls normally with your finger. The most-used actions are in a bar at the bottom of the screen: Paragraph, Image, Add page, Save and Download. Everything else is under the three dots (More), including Font, colours, Link, Signature, Page margins and a switch to Page view, which shows the whole A4 sheet.",
          "There are no arrow keys on a phone, so choose More, then Show navigation keys. A row of keys appears above the bottom bar: arrows, Home and End (start and end of the line), Page up and Page down, and Top and Bottom of the document. They move the caret without closing the keyboard or typing anything. A physical keyboard's arrow keys, Home, End, Page Up and Page Down work as usual.",
          "The downloaded file always uses the real A4 page and the margins you chose, so Phone view shows a narrower page than Word will print.",
        ],
      },
      {
        h2: "Limits and troubleshooting",
        bullets: [
          "Word and your browser lay out pages with different engines, so line and page breaks can move slightly in Word. Pages you start with Add page, your margins, your text, formatting, pictures and links are kept.",
          "Tables, headers, footers and page numbers are not available yet.",
          "A signature added here is a picture of your handwriting or typed name, not a certified digital signature.",
          "If you see Save failed, your browser has no room or is blocking site data (private browsing does this). Download the .docx straight away to keep your work, then free some space.",
          "If a picture will not insert, check that it is a PNG, JPEG, WebP or GIF under 10 MB and is not damaged.",
          "Creating a document never changes any file you already have.",
        ],
      },
      {
        h2: "Create, convert or extract text?",
        bullets: [
          "Create Word Document: write a new document from a blank page.",
          "PDF to Word: turn a PDF you already have into an editable Word file.",
          "OCR (Extract text): read the words from a scan or photo, in English.",
        ],
      },
    ],
    tool: {
      href: "/create-word-document",
      label: "Create a Word document now",
      blurb: "Free, no account, and your writing stays in your browser.",
    },
    related: [
      { href: "/convert/pdf-to-word", label: "Convert a PDF to Word", note: "Edit a PDF you already have in Word." },
      { href: "/tools/ocr", label: "Extract text with OCR", note: "Read English text from a scan or photo." },
      { href: "/guides/how-to-sign-a-pdf-online", label: "How to sign a PDF online", note: "Signing a PDF rather than a new document." },
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
  {
    slug: "how-to-compress-a-pdf-to-1mb-or-2mb",
    title: "How to Compress a PDF to 1 MB or 2 MB (or Another Size Limit)",
    description:
      "Get a PDF under an upload limit such as 500 KB, 1 MB, 2 MB or 5 MB. Set a target size, see what is realistic for your file, and keep it readable.",
    h1: "How to compress a PDF to 1 MB or 2 MB",
    intro:
      "Job portals, visa forms and email systems often reject a PDF over a fixed size. You can set that size as a target, and the compressor picks the lightest level that fits.",
    published: "2026-10-11",
    updated: "2026-10-11",
    sections: [
      {
        h2: "Compress to a target size, step by step",
        steps: [
          "Open the PDF compressor and choose your file (up to 100 MB).",
          "Open More options and choose a target size: 500 KB, 1 MB, 2 MB or 5 MB. For another limit, choose Custom and enter a size of at least 20 KB.",
          "Choose Compress PDF. FreePDFScanner picks the lightest level that fits the target, so you keep as much quality as the limit allows. This recompresses the pictures inside the PDF and leaves the text alone.",
          "Check the result before you download it. The result says either that your target was reached, or that it could not be reached without unacceptable quality loss and shows the smallest good result.",
        ],
      },
      {
        h2: "What size is realistic for your file",
        paragraphs: [
          "The amount a PDF can shrink depends on what is inside it. A scan or a PDF full of photos can often be reduced a great deal. A PDF that is mostly text is already small and will not shrink much, so a 1 MB target for a text-only file may simply not be reachable.",
          "If the target cannot be reached without unacceptable quality loss, the tool tells you and gives you the smallest good result instead of an unreadable file. If the saving would be too small to be worth it, it keeps your original rather than hand you a file that is barely smaller. In that case, see the options below.",
        ],
      },
      {
        h2: "If it will not fit",
        bullets: [
          "Remove pages you do not need to submit before compressing.",
          "For a scan, go back to the original photos, crop away the table or background, and re-scan with Black & White for text pages. High-contrast pages compress far better than colour photos of them.",
          "Choose Try stronger compression, which is offered after a result that is weak or misses the target on files of 200 KB or more. It redraws every page as a lower-resolution picture, which makes the file much smaller but means the text can no longer be selected or searched. Use it only if you must.",
          "Check the portal's real limit. Some sites accept less than they advertise, so aim a little under the stated size.",
        ],
      },
      {
        h2: "Keep the original",
        paragraphs: [
          "Your original file is never changed. You download the compressed copy separately, and compression happens in your browser. Keep the original for your records and send the compressed copy.",
        ],
      },
    ],
    tool: {
      href: "/tools/compress-pdf",
      label: "Compress a PDF now",
      blurb: "Free, no account, and your file stays in your browser.",
    },
    related: [
      { href: "/guides/how-to-reduce-pdf-file-size", label: "How to reduce a PDF's file size", note: "Why PDFs get big and what helps." },
      { href: "/scan", label: "Scan a document to PDF", note: "Re-scan pages so they compress well." },
      { href: "/tools/compress-image", label: "Compress an image", note: "Shrink a photo before it goes into a PDF." },
    ],
  },
  {
    slug: "how-to-check-a-pdf-site-does-not-upload-your-file",
    title: "How to Check Whether a PDF Website Uploads Your File",
    description:
      "A simple browser test to see whether a PDF tool uploads your document, including ours, and what you should and should not expect to see.",
    h1: "How to check if a PDF site uploads your file",
    intro:
      "Many free PDF sites send your file to a server to process it. Others work entirely in your browser. Instead of taking any site's word for it, you can check in about a minute, and the test works on any website, including this one.",
    published: "2026-10-11",
    updated: "2026-10-11",
    sections: [
      {
        h2: "The test, step by step",
        steps: [
          "Open the tool in a desktop browser and press F12 (or Ctrl+Shift+I) to open the developer tools. Choose the Network tab.",
          "Click the clear button in the Network tab so the list is empty, and tick Preserve log if you see it.",
          "Choose a small, non-sensitive test file and run the tool: convert, compress or whatever the page does.",
          "Look at the list of requests. Click any request that uses POST or PUT, and open its Payload or Request tab. If your file is being uploaded, you will see a large request carrying the file's contents, and its size will be close to the size of your file.",
          "Compare sizes. Sort the list by size. A tool that uploads a 5 MB file must send roughly 5 MB somewhere.",
        ],
      },
      {
        h2: "What you should expect to see on a browser-only tool",
        bullets: [
          "Small requests for analytics, advertising and page scripts. These are normal, and they do not contain your document.",
          "On FreePDFScanner, the text-recognition engine files are downloaded from FreePDFScanner itself the first time you use OCR. That is a download to your device, not an upload of your file.",
          "No request whose size matches your file.",
          "If you accept analytics cookies, FreePDFScanner sends usage events such as which tool was opened. If you accept session recordings, Microsoft Clarity may record page interactions, with pages that show your documents masked. The Network test checks whether your file is uploaded; it does not show everything a page might record, so read the privacy policy too.",
        ],
      },
      {
        h2: "A second check: go offline",
        paragraphs: [
          "Load the tool, then turn off your internet connection (airplane mode, or the Offline setting in the Network tab) and run it on your test file. A tool that works in your browser can often still process the file. A tool that needs a server will fail. This is a hint rather than proof, because a tool might need to fetch extra files the first time it runs, so use it alongside the Network check.",
        ],
      },
      {
        h2: "When a file is deliberately sent",
        paragraphs: [
          "Some features are meant to store a file. On FreePDFScanner, the scanner has a Save to account button. It asks you to sign in, and when you choose it, the PDF you created is sent to your account's private storage, because that is the point of saving it. Nothing is saved unless you choose that button. The tools that process a file locally do not upload it.",
          "Check any site's privacy policy as well. It should say which features use a server and which do not. Ours is at /privacy.",
        ],
      },
      {
        h2: "Be careful with sensitive files",
        bullets: [
          "Test with a harmless file first, not your passport or contract.",
          "Browser extensions can read what you open. Use a private window with extensions off for sensitive documents.",
          "If a site asks you to upload a file and you cannot tell what happens to it, use software installed on your own device instead.",
        ],
      },
    ],
    tool: {
      href: "/tools",
      label: "See the PDF tools",
      blurb: "Free, no account for the core tools. Run the test above on any of them.",
    },
    related: [
      { href: "/convert/image-to-pdf", label: "Convert images to PDF", note: "A quick tool to test with." },
      { href: "/tools/compress-pdf", label: "Compress a PDF", note: "Another easy test." },
      { href: "/tools/protect-pdf", label: "Protect a PDF with a password", note: "Lock a file before you share it." },
      { href: "/guides/ilovepdf-alternatives-compared", label: "Free iLovePDF alternatives compared", note: "Server-based, in-browser and self-hosted tools." },
    ],
  },
  {
    slug: "ilovepdf-alternatives-compared",
    title: "iLovePDF Alternatives Compared: Free, In-Browser and Self-Hosted",
    description:
      "An honest comparison of free iLovePDF alternatives: server-based sites, in-browser tools and self-hosted software, with trade-offs, including ours.",
    h1: "Free iLovePDF alternatives compared",
    intro:
      "There is no single best free PDF tool. They differ mainly in where your file is processed, what they cost, and how much you can do. This page explains those differences, so you can choose, and says plainly what FreePDFScanner does not do.",
    published: "2026-10-11",
    updated: "2026-10-11",
    sections: [
      {
        h2: "The three kinds of tool",
        bullets: [
          "Server-based websites (for example iLovePDF, Smallpdf, Sejda, PDF24's online tools). You upload a file, a server processes it and you download the result. They are often powerful and handle heavy jobs, and most say they delete uploads after a period. Read each site's own policy for its exact terms.",
          "In-browser tools (for example BentoPDF and FreePDFScanner). Processing happens on your device, so the file does not need to be uploaded. They depend on your device's memory and the browser's capabilities.",
          "Self-hosted software (for example Stirling-PDF). You run it on your own computer or server, which gives you the most control and needs some technical setup.",
        ],
      },
      {
        h2: "Where FreePDFScanner fits",
        paragraphs: [
          "FreePDFScanner is free, supported by ads, and runs in your browser. It can scan with a phone or computer camera, turn images into PDFs, convert Word and Excel to and from PDF, edit, sign and annotate PDFs, compress PDFs, images and Office files, extract text with OCR, and add passwords to PDF and Office files. The core tools do not need an account. For checking the privacy claim yourself, see our guide to testing whether a site uploads your file.",
        ],
      },
      {
        h2: "What FreePDFScanner does not do",
        bullets: [
          "OCR reads English only, up to 30 pages at a time, and the result is text you copy or correct. It does not add a hidden text layer to make the PDF itself searchable.",
          "PDFs we create from scans are made of page images, so their text is not selectable.",
          "Very large files or batches depend on your device's memory.",
          "It is a website, not software you can run on your own server. If you need that, look at a self-hosted option instead.",
        ],
      },
      {
        h2: "Which should you pick?",
        bullets: [
          "You need a quick one-off job and do not mind uploading: a server-based site is fine for non-sensitive files.",
          "You want to avoid uploading and prefer a website: an in-browser tool such as FreePDFScanner or BentoPDF.",
          "You want a camera scanner in the browser with conversions and signing in one place: FreePDFScanner.",
          "You need open-source code, automation or a private server: Stirling-PDF or another self-hosted tool.",
          "You need a searchable PDF from a scan, in another language, or heavy editing: use a tool built for it and check its current features.",
        ],
      },
      {
        h2: "A note on this comparison",
        paragraphs: [
          "We publish FreePDFScanner, so we are not a neutral reviewer. This page describes categories rather than rating products, and tools change, so check each tool's own site for current features, limits and terms before you decide.",
        ],
      },
    ],
    tool: {
      href: "/tools",
      label: "Try the PDF tools",
      blurb: "Free, and the core tools need no account. Judge for yourself.",
    },
    related: [
      { href: "/guides/how-to-check-a-pdf-site-does-not-upload-your-file", label: "How to check if a PDF site uploads your file", note: "A one-minute browser test." },
      { href: "/scan", label: "Scan a document to PDF", note: "Use your camera." },
      { href: "/tools/ocr", label: "Extract text with OCR", note: "English text from scans." },
    ],
  },
];

export function getGuide(slug: string): Guide | undefined {
  return GUIDES.find((g) => g.slug === slug);
}

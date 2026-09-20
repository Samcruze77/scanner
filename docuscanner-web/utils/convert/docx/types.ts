// Shared types for the DOCX -> PDF engine. Units follow the file format until
// layout: twips (1/20 pt) for paragraph/section geometry, half-points for font
// sizes. Layout converts everything to points.

export interface FontNames {
  ascii?: string;
  hAnsi?: string;
  eastAsia?: string;
  cs?: string;
  asciiTheme?: string;
  hAnsiTheme?: string;
}

export interface Border {
  val: string; // single, double, dashed, dotted, nil, none, ...
  sz: number; // eighths of a point
  color: string; // hex without '#', or "auto"
  space: number; // points
}

export interface Borders {
  top?: Border;
  left?: Border;
  bottom?: Border;
  right?: Border;
  between?: Border;
  insideH?: Border;
  insideV?: Border;
}

export interface TabStop {
  pos: number; // twips from the text origin
  kind: "left" | "center" | "right" | "decimal" | "bar" | "clear";
  leader: "none" | "dot" | "hyphen" | "underscore" | "middleDot";
}

// Partial run properties: undefined means "inherit".
export interface RPr {
  fonts?: FontNames;
  sz?: number; // half-points
  b?: boolean;
  i?: boolean;
  u?: string;
  strike?: boolean;
  dstrike?: boolean;
  color?: string;
  highlight?: string;
  shd?: string;
  caps?: boolean;
  smallCaps?: boolean;
  vertAlign?: string;
  spacing?: number; // twips of extra space between characters
  position?: number; // half-points raised (+) or lowered (-)
  scale?: number; // percent
  vanish?: boolean;
}

export interface PPr {
  jc?: string;
  indLeft?: number;
  indRight?: number;
  indFirstLine?: number;
  indHanging?: number;
  before?: number;
  after?: number;
  line?: number;
  lineRule?: string;
  beforeAutospacing?: boolean;
  afterAutospacing?: boolean;
  keepNext?: boolean;
  keepLines?: boolean;
  pageBreakBefore?: boolean;
  widowControl?: boolean;
  contextualSpacing?: boolean;
  tabs?: TabStop[];
  numId?: number;
  ilvl?: number;
  shd?: string;
  borders?: Borders;
  outlineLvl?: number;
  // Style the paragraph mark's own run properties carry (empty paragraphs).
  markRPr?: RPr;
}

export interface CellProps {
  shd?: string;
  borders?: Borders;
  vAlign?: string;
  margins?: { top?: number; left?: number; bottom?: number; right?: number };
}

export interface TableProps {
  borders?: Borders;
  cellMargins?: { top?: number; left?: number; bottom?: number; right?: number };
  jc?: string;
  indent?: number;
  cellSpacing?: number;
  widthType?: string;
  width?: number;
  layoutFixed?: boolean;
  look?: { firstRow: boolean; lastRow: boolean; firstCol: boolean; lastCol: boolean; bandRow: boolean; bandCol: boolean };
}

export interface ConditionalFormat {
  ppr: PPr;
  rpr: RPr;
  cell: CellProps;
}

export interface StyleDef {
  id: string;
  type: string;
  name: string;
  basedOn?: string;
  isDefault: boolean;
  ppr: PPr;
  rpr: RPr;
  table?: TableProps;
  cell?: CellProps;
  conditional?: Record<string, ConditionalFormat>;
  rowBand?: number;
  colBand?: number;
}

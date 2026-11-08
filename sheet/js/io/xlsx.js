// .xlsx (Office Open XML) export and import.
//
// Export writes formulas with cached values, number formats, fonts, fills,
// alignment and column widths. Import reads the same back, plus shared strings,
// rich text, shared formulas and the built-in number formats.

import { writeZip, readZip } from './zip.js';
import { parseXml, child, childrenOf, textOf, escapeXml } from './xml.js';
import { formatAddress, parseAddress, MAX_ROWS, MAX_COLS } from '../engine/address.js';
import { parseFormula, printFormula, mapAst } from '../engine/parser.js';
import { shiftRelative } from '../engine/rewrite.js';
import { isError } from '../engine/values.js';
import { valueToInput, PARSE_ERROR, DEFAULT_COL_WIDTH, DEFAULT_ROW_HEIGHT } from '../engine/workbook.js';

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

// Functions newer than Excel 2007 must carry a prefix inside the file.
const XLFN = new Set(['CONCAT', 'TEXTJOIN', 'IFS', 'SWITCH', 'MAXIFS', 'MINIFS', 'XOR', 'IFNA', 'XLOOKUP', 'DAYS',
  'STDEV.S', 'STDEV.P', 'VAR.S', 'VAR.P', 'MODE.SNGL', 'RANK.EQ', 'PERCENTILE.INC', 'QUARTILE.INC',
  'UNICHAR', 'UNICODE', 'TEXTBEFORE', 'TEXTAFTER']);

const BUILTIN_FMT_OUT = { 'General': 0, '0': 1, '0.00': 2, '#,##0': 3, '#,##0.00': 4, '0%': 9, '0.00%': 10, '0.00E+00': 11, '@': 49 };
const BUILTIN_FMT_IN = {
  0: 'General', 1: '0', 2: '0.00', 3: '#,##0', 4: '#,##0.00', 9: '0%', 10: '0.00%', 11: '0.00E+00',
  12: 'General', 13: 'General', 14: 'yyyy-mm-dd', 15: 'd-mmm-yy', 16: 'd-mmm', 17: 'mmm-yy',
  18: 'h:mm AM/PM', 19: 'h:mm:ss AM/PM', 20: 'h:mm', 21: 'h:mm:ss', 22: 'yyyy-mm-dd h:mm',
  37: '#,##0;-#,##0', 38: '#,##0;[Red]-#,##0', 39: '#,##0.00;-#,##0.00', 40: '#,##0.00;[Red]-#,##0.00',
  45: 'mm:ss', 46: '[h]:mm:ss', 47: 'mm:ss', 48: '0.0E+0', 49: '@',
  27: 'yyyy"年"m"月"', 28: 'm"月"d"日"', 29: 'm"月"d"日"', 30: 'm-d-yy', 31: 'yyyy"年"m"月"d"日"',
  32: 'h"时"mm"分"', 33: 'h"时"mm"分"ss"秒"', 34: '上午/下午h"时"mm"分"', 35: '上午/下午h"时"mm"分"ss"秒"', 36: 'yyyy"年"m"月"',
  50: 'yyyy"年"m"月"', 51: 'm"月"d"日"', 52: 'yyyy"年"m"月"', 53: 'm"月"d"日"', 54: 'm"月"d"日"',
  55: '上午/下午h"时"mm"分"', 56: '上午/下午h"时"mm"分"ss"秒"', 57: 'yyyy"年"m"月"', 58: 'm"月"d"日"'
};

const pxToWidth = px => Math.round(((px - 5) / 7) * 100) / 100;
const widthToPx = w => Math.round(w * 7 + 5);
const argb = hex => 'FF' + hex.replace('#', '').toUpperCase().padStart(6, '0');

function formulaForFile(ast) {
  return printFormula(mapAst(ast, n => (n.type === 'call' && XLFN.has(n.name) ? { ...n, name: '_xlfn.' + n.name } : n)));
}

// ---------- export ----------

class StyleTable {
  constructor() {
    this.numFmts = new Map();
    this.fonts = ['<font><sz val="11"/><name val="Calibri"/><family val="2"/></font>'];
    this.fontIndex = new Map([['', 0]]);
    this.fills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>'];
    this.fillIndex = new Map([['', 0]]);
    this.xfs = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'];
    this.xfIndex = new Map([['', 0]]);
  }
  numFmtId(code) {
    if (!code || code === 'General') return 0;
    if (code in BUILTIN_FMT_OUT) return BUILTIN_FMT_OUT[code];
    if (!this.numFmts.has(code)) this.numFmts.set(code, 164 + this.numFmts.size);
    return this.numFmts.get(code);
  }
  fontId(st) {
    const key = [st.bold ? 'b' : '', st.italic ? 'i' : '', st.underline ? 'u' : '', st.strike ? 's' : '', st.color || ''].join('|');
    if (key === '||||') return 0;
    if (!this.fontIndex.has(key)) {
      this.fontIndex.set(key, this.fonts.length);
      this.fonts.push(`<font>${st.bold ? '<b/>' : ''}${st.italic ? '<i/>' : ''}${st.strike ? '<strike/>' : ''}${st.underline ? '<u/>' : ''}`
        + `${st.color ? `<color rgb="${argb(st.color)}"/>` : ''}<sz val="11"/><name val="Calibri"/><family val="2"/></font>`);
    }
    return this.fontIndex.get(key);
  }
  fillId(st) {
    if (!st.fill) return 0;
    if (!this.fillIndex.has(st.fill)) {
      this.fillIndex.set(st.fill, this.fills.length);
      this.fills.push(`<fill><patternFill patternType="solid"><fgColor rgb="${argb(st.fill)}"/><bgColor indexed="64"/></patternFill></fill>`);
    }
    return this.fillIndex.get(st.fill);
  }
  xfId(st) {
    if (!st) return 0;
    const num = this.numFmtId(st.numFmt), font = this.fontId(st), fill = this.fillId(st);
    const align = ['left', 'center', 'right'].includes(st.align) ? st.align : '';
    const wrap = st.wrap ? 1 : 0;
    const key = `${num}|${font}|${fill}|${align}|${wrap}`;
    if (key === '0|0|0||0') return 0;
    if (!this.xfIndex.has(key)) {
      this.xfIndex.set(key, this.xfs.length);
      const alignXml = align || wrap ? `<alignment${align ? ` horizontal="${align}"` : ''}${wrap ? ' wrapText="1"' : ''}/>` : '';
      this.xfs.push(`<xf numFmtId="${num}" fontId="${font}" fillId="${fill}" borderId="0" xfId="0"`
        + `${num ? ' applyNumberFormat="1"' : ''}${font ? ' applyFont="1"' : ''}${fill ? ' applyFill="1"' : ''}${alignXml ? ' applyAlignment="1"' : ''}`
        + (alignXml ? `>${alignXml}</xf>` : '/>'));
    }
    return this.xfIndex.get(key);
  }
  toXml() {
    const numFmts = [...this.numFmts].map(([code, id]) => `<numFmt numFmtId="${id}" formatCode="${escapeXml(code)}"/>`).join('');
    return XML_HEAD + `<styleSheet xmlns="${NS}">`
      + (this.numFmts.size ? `<numFmts count="${this.numFmts.size}">${numFmts}</numFmts>` : '')
      + `<fonts count="${this.fonts.length}">${this.fonts.join('')}</fonts>`
      + `<fills count="${this.fills.length}">${this.fills.join('')}</fills>`
      + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
      + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
      + `<cellXfs count="${this.xfs.length}">${this.xfs.join('')}</cellXfs>`
      + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
      + '</styleSheet>';
  }
}

function cellXml(ref, cell, s) {
  const sAttr = s ? ` s="${s}"` : '';
  if (!cell || cell.input === '') return s ? `<c r="${ref}"${sAttr}/>` : '';
  const v = cell.value;
  if (cell.ast) {
    const f = `<f>${escapeXml(formulaForFile(cell.ast))}</f>`;
    if (typeof v === 'number') return `<c r="${ref}"${sAttr}>${f}<v>${v}</v></c>`;
    if (typeof v === 'boolean') return `<c r="${ref}"${sAttr} t="b">${f}<v>${v ? 1 : 0}</v></c>`;
    if (isError(v)) return `<c r="${ref}"${sAttr} t="e">${f}<v>${escapeXml(v.code)}</v></c>`;
    return `<c r="${ref}"${sAttr} t="str">${f}<v>${escapeXml(v ?? '')}</v></c>`;
  }
  if (v === PARSE_ERROR || typeof v === 'string') {
    const text = v === PARSE_ERROR ? cell.input : v;
    return `<c r="${ref}"${sAttr} t="inlineStr"><is><t xml:space="preserve">${escapeXml(text)}</t></is></c>`;
  }
  if (typeof v === 'number') return `<c r="${ref}"${sAttr}><v>${v}</v></c>`;
  if (typeof v === 'boolean') return `<c r="${ref}"${sAttr} t="b"><v>${v ? 1 : 0}</v></c>`;
  if (isError(v)) return `<c r="${ref}"${sAttr} t="e"><v>${escapeXml(v.code)}</v></c>`;
  return '';
}

function sheetXml(sheet, styles, selected) {
  const rows = new Map();
  let maxR = 0, maxC = 0;
  for (const [k, cell] of sheet.cells) {
    const r = Math.floor(k / MAX_COLS), c = k % MAX_COLS;
    if (!rows.has(r)) rows.set(r, []);
    rows.get(r).push([c, cell]);
    maxR = Math.max(maxR, r);
    maxC = Math.max(maxC, c);
  }
  for (const r of sheet.rowHeights.keys()) if (!rows.has(r)) rows.set(r, []);
  const rowXml = [...rows.keys()].sort((a, b) => a - b).map(r => {
    const cells = rows.get(r).sort((a, b) => a[0] - b[0])
      .map(([c, cell]) => cellXml(formatAddress(r, c), cell, styles.xfId(cell.style))).join('');
    const ht = sheet.rowHeights.get(r);
    const htAttr = ht ? ` ht="${Math.round(ht * 0.75 * 100) / 100}" customHeight="1"` : '';
    return cells || htAttr ? `<row r="${r + 1}"${htAttr}>${cells}</row>` : '';
  }).join('');
  const widths = [...sheet.colWidths].filter(([, w]) => w !== DEFAULT_COL_WIDTH).sort((a, b) => a[0] - b[0]);
  const cols = widths.length
    ? `<cols>${widths.map(([c, w]) => `<col min="${c + 1}" max="${c + 1}" width="${pxToWidth(w)}" customWidth="1"/>`).join('')}</cols>`
    : '';
  return XML_HEAD + `<worksheet xmlns="${NS}" xmlns:r="${NS_R}">`
    + `<dimension ref="${rows.size ? `A1:${formatAddress(maxR, maxC)}` : 'A1'}"/>`
    + `<sheetViews><sheetView workbookViewId="0"${selected ? ' tabSelected="1"' : ''}/></sheetViews>`
    + `<sheetFormatPr defaultRowHeight="${DEFAULT_ROW_HEIGHT * 0.75}" defaultColWidth="${pxToWidth(DEFAULT_COL_WIDTH)}"/>`
    + cols
    + `<sheetData>${rowXml}</sheetData>`
    + '</worksheet>';
}

export async function exportXlsx(wb, { activeSheetId = null, compress = true } = {}) {
  const styles = new StyleTable();
  const sheetFiles = wb.sheets.map((s, i) => ({
    name: `xl/worksheets/sheet${i + 1}.xml`,
    data: sheetXml(s, styles, activeSheetId === null ? i === 0 : s.id === activeSheetId)
  }));
  const activeTab = Math.max(0, wb.sheets.findIndex(s => s.id === activeSheetId));
  const entries = [
    {
      name: '[Content_Types].xml',
      data: XML_HEAD + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        + '<Default Extension="xml" ContentType="application/xml"/>'
        + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        + wb.sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')
        + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
        + '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>'
        + '</Types>'
    },
    {
      name: '_rels/.rels',
      data: XML_HEAD + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
        + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>'
        + '</Relationships>'
    },
    {
      name: 'docProps/app.xml',
      data: XML_HEAD + '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>格算</Application></Properties>'
    },
    {
      name: 'xl/workbook.xml',
      data: XML_HEAD + `<workbook xmlns="${NS}" xmlns:r="${NS_R}">`
        + `<bookViews><workbookView activeTab="${activeTab}"/></bookViews>`
        + `<sheets>${wb.sheets.map((s, i) => `<sheet name="${escapeXml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>`
        + '<calcPr calcId="191029" fullCalcOnLoad="1"/>'
        + '</workbook>'
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: XML_HEAD + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        + wb.sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')
        + `<Relationship Id="rId${wb.sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`
        + '</Relationships>'
    },
    ...sheetFiles,
    { name: 'xl/styles.xml', data: '' }
  ];
  // styles.xml last: it is only complete once every sheet has registered its styles.
  entries[entries.length - 1].data = styles.toXml();
  return writeZip(entries, { compress });
}

// ---------- import ----------

function readStyles(xml) {
  if (!xml) return [];
  const doc = parseXml(xml);
  const sheet = child(doc, 'styleSheet');
  const custom = new Map();
  for (const nf of childrenOf(child(sheet, 'numFmts'), 'numFmt')) custom.set(Number(nf.attrs.numFmtId), nf.attrs.formatCode);
  const fonts = childrenOf(child(sheet, 'fonts'), 'font').map(f => {
    const st = {};
    const isOn = n => n && n.attrs.val !== '0' && n.attrs.val !== 'false';
    if (isOn(child(f, 'b'))) st.bold = true;
    if (isOn(child(f, 'i'))) st.italic = true;
    if (child(f, 'u') && child(f, 'u').attrs.val !== 'none') st.underline = true;
    if (isOn(child(f, 'strike'))) st.strike = true;
    const rgb = child(f, 'color')?.attrs.rgb;
    if (rgb && /^[0-9A-Fa-f]{8}$/.test(rgb) && rgb.slice(2).toUpperCase() !== '000000') st.color = '#' + rgb.slice(2).toLowerCase();
    return st;
  });
  const fills = childrenOf(child(sheet, 'fills'), 'fill').map(f => {
    const p = child(f, 'patternFill');
    if (!p || p.attrs.patternType !== 'solid') return null;
    const rgb = child(p, 'fgColor')?.attrs.rgb;
    return rgb && /^[0-9A-Fa-f]{8}$/.test(rgb) ? '#' + rgb.slice(2).toLowerCase() : null;
  });
  return childrenOf(child(sheet, 'cellXfs'), 'xf').map(xf => {
    const st = {};
    const id = Number(xf.attrs.numFmtId || 0);
    const code = custom.get(id) ?? BUILTIN_FMT_IN[id] ?? 'General';
    if (code !== 'General') st.numFmt = code;
    Object.assign(st, fonts[Number(xf.attrs.fontId || 0)] || {});
    const fill = fills[Number(xf.attrs.fillId || 0)];
    if (fill) st.fill = fill;
    const al = child(xf, 'alignment');
    if (al && ['left', 'center', 'right'].includes(al.attrs.horizontal)) st.align = al.attrs.horizontal;
    if (al && (al.attrs.wrapText === '1' || al.attrs.wrapText === 'true')) st.wrap = true;
    return Object.keys(st).length ? st : null;
  });
}

const stripPrefixes = f => f.replace(/_xlfn\.|_xlws\.|_xludf\./gi, '');

function resolvePath(base, target) {
  if (target.startsWith('/')) return target.slice(1);
  const parts = base.split('/').slice(0, -1);
  for (const seg of target.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.') parts.push(seg);
  }
  return parts.join('/');
}

// Returns workbook JSON (the format Workbook.load accepts).
export async function importXlsx(bytes) {
  const files = await readZip(bytes);
  const dec = new TextDecoder();
  const read = name => (files.has(name) ? dec.decode(files.get(name)) : null);

  const rootRels = parseXml(read('_rels/.rels') || '');
  const mainRel = childrenOf(child(rootRels, 'Relationships'), 'Relationship').find(r => /officeDocument$/.test(r.attrs.Type));
  const wbPath = mainRel ? resolvePath('', mainRel.attrs.Target) : 'xl/workbook.xml';
  const wbXml = read(wbPath);
  if (!wbXml) throw new Error('文件里找不到工作簿');
  const relsPath = wbPath.replace(/[^/]+$/, m => `_rels/${m}.rels`);
  const rels = new Map(childrenOf(child(parseXml(read(relsPath) || ''), 'Relationships'), 'Relationship')
    .map(r => [r.attrs.Id, { type: r.attrs.Type, target: resolvePath(wbPath, r.attrs.Target) }]));

  let shared = [];
  let styleList = [];
  for (const rel of rels.values()) {
    if (/sharedStrings$/.test(rel.type)) shared = childrenOf(child(parseXml(read(rel.target) || ''), 'sst'), 'si').map(textOf);
    if (/styles$/.test(rel.type)) styleList = readStyles(read(rel.target));
  }

  const styles = [];
  const styleMap = new Map();
  const styleIndex = s => {
    const st = styleList[s];
    if (!st) return -1;
    if (!styleMap.has(s)) { styleMap.set(s, styles.length); styles.push(st); }
    return styleMap.get(s);
  };

  const wbDoc = child(parseXml(wbXml), 'workbook');
  const sheets = [];
  for (const sh of childrenOf(child(wbDoc, 'sheets'), 'sheet')) {
    const rel = rels.get(sh.attrs['r:id'] ?? sh.attrs.id);
    const xml = rel && read(rel.target);
    if (!xml) continue;
    sheets.push(readSheet(sh.attrs.name, xml, shared, styleIndex));
  }
  if (!sheets.length) throw new Error('文件里没有工作表');
  return { app: 'gesuan', version: 1, sheets, styles };
}

function readSheet(name, xml, shared, styleIndex) {
  const ws = child(parseXml(xml), 'worksheet');
  const colWidths = {};
  for (const col of childrenOf(child(ws, 'cols'), 'col')) {
    if (!col.attrs.width) continue;
    const px = widthToPx(Number(col.attrs.width));
    const min = Number(col.attrs.min), max = Math.min(Number(col.attrs.max), min + 200);
    if (Math.abs(px - DEFAULT_COL_WIDTH) < 2) continue;
    for (let c = min; c <= max; c++) colWidths[c - 1] = px;
  }
  const cells = [];
  const rowHeights = {};
  const masters = new Map(); // shared formula si -> { r, c, ast }
  let rowIdx = -1;
  for (const row of childrenOf(child(ws, 'sheetData'), 'row')) {
    rowIdx = row.attrs.r ? Number(row.attrs.r) - 1 : rowIdx + 1;
    if (row.attrs.ht && (row.attrs.customHeight === '1' || row.attrs.customHeight === 'true')) {
      const px = Math.round(Number(row.attrs.ht) / 0.75);
      if (Number.isFinite(px) && px !== DEFAULT_ROW_HEIGHT) rowHeights[rowIdx] = px;
    }
    let colIdx = -1;
    for (const c of childrenOf(row, 'c')) {
      let r = rowIdx, col;
      const addr = c.attrs.r ? parseAddress(c.attrs.r) : null;
      if (addr) { r = addr.row; col = addr.col; } else col = colIdx + 1;
      colIdx = col;
      if (r >= MAX_ROWS || col >= MAX_COLS) continue;
      const si = c.attrs.s !== undefined ? styleIndex(Number(c.attrs.s)) : -1;
      const t = c.attrs.t || 'n';
      const vNode = child(c, 'v');
      const v = vNode ? vNode.text : null;
      const fNode = child(c, 'f');
      let input = '';

      if (fNode) {
        let text = fNode.text.trim();
        if (fNode.attrs.t === 'shared' && fNode.attrs.si !== undefined) {
          if (text) {
            try { masters.set(fNode.attrs.si, { r, c: col, ast: parseFormula(stripPrefixes(text)) }); } catch { /* keep text */ }
          } else {
            const m = masters.get(fNode.attrs.si);
            if (m) text = printFormula(shiftRelative(m.ast, r - m.r, col - m.c));
          }
        }
        if (text) input = '=' + stripPrefixes(text);
      }
      if (!input) {
        if (t === 's') input = valueToInput(shared[Number(v)] ?? '');
        else if (t === 'inlineStr') input = valueToInput(textOf(child(c, 'is')));
        else if (t === 'str') input = valueToInput(v ?? '');
        else if (t === 'b') input = v === '1' ? 'TRUE' : v === '0' ? 'FALSE' : '';
        else if (t === 'e') input = v ?? '';
        else if (v !== null && v !== '') input = String(Number(v));
      }
      if (input === '' && si < 0) continue;
      cells.push(si >= 0 ? [r, col, input, si] : [r, col, input]);
    }
  }
  return { name, colWidths, rowHeights, cells };
}

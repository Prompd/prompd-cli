import ExcelJS from 'exceljs';

export async function excelToMarkdownSheets(filePath: string): Promise<string> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const sheets: string[] = [];
  for (const sheet of workbook.worksheets) {
    const csv = sheetToCsv(sheet);
    if (csv.trim()) {
      sheets.push(`### Sheet: ${sheet.name}\n\n\`\`\`csv\n${csv}\n\`\`\``);
    }
  }
  return sheets.join('\n\n');
}

function sheetToCsv(sheet: ExcelJS.Worksheet): string {
  const rowCount = sheet.actualRowCount;
  const colCount = sheet.actualColumnCount;
  if (rowCount === 0 || colCount === 0) return '';

  const lines: string[] = [];
  for (let r = 1; r <= rowCount; r++) {
    const row = sheet.getRow(r);
    const cells: string[] = [];
    for (let c = 1; c <= colCount; c++) {
      cells.push(formatCsvCell(row.getCell(c).value));
    }
    lines.push(cells.join(','));
  }
  return lines.join('\n');
}

function formatCsvCell(value: ExcelJS.CellValue): string {
  let s: string;
  if (value === null || value === undefined) {
    s = '';
  } else if (value instanceof Date) {
    s = value.toISOString();
  } else if (typeof value === 'object') {
    if ('richText' in value && Array.isArray(value.richText)) {
      s = value.richText.map((r: { text: string }) => r.text).join('');
    } else if ('text' in value) {
      const text = (value as { text: unknown }).text;
      s = text === null || text === undefined ? '' : String(text);
    } else if ('result' in value) {
      const result = (value as { result: unknown }).result;
      s = result === null || result === undefined ? '' : String(result);
    } else if ('error' in value) {
      s = String((value as { error: string }).error);
    } else if ('hyperlink' in value) {
      const hyperlinkValue = value as { text?: unknown; hyperlink: string };
      s = hyperlinkValue.text !== undefined && hyperlinkValue.text !== null
        ? String(hyperlinkValue.text)
        : hyperlinkValue.hyperlink;
    } else {
      s = JSON.stringify(value);
    }
  } else {
    s = String(value);
  }
  if (/[",\n\r]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

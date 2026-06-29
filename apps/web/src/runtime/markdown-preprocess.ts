export function normalizePipedMarkdownTables(text: string) {
  return text
    .split("\n")
    .map(normalizeFlattenedTableLine)
    .join("\n");
}

function normalizeFlattenedTableLine(line: string) {
  const separatorIndex = line.search(/\|\s*:?-{3,}:?\s*\|/);
  if (separatorIndex === -1) {
    return line;
  }

  const tableStart = findHeaderStart(line, separatorIndex);
  if (tableStart === -1) {
    return line;
  }

  const prefix = line.slice(0, tableStart).trimEnd();
  const tableText = line.slice(tableStart).trim();
  const rows = splitFlattenedTableRows(tableText);
  if (rows.length < 2 || !isSeparatorRow(rows[1])) {
    return line;
  }

  const tableBlock = rows.join("\n");
  return prefix ? prefix + "\n\n" + tableBlock : tableBlock;
}

function findHeaderStart(line: string, separatorIndex: number) {
  const beforeSeparator = line.slice(0, separatorIndex);
  const boundaryBeforeSeparator = beforeSeparator.search(/\|\s*$/);
  const headerEnd = boundaryBeforeSeparator === -1 ? beforeSeparator.length : boundaryBeforeSeparator + 1;
  const headerText = line.slice(0, headerEnd);

  for (let index = 0; index < headerText.length; index += 1) {
    if (headerText[index] !== "|") {
      continue;
    }

    const candidate = headerText.slice(index).trim();
    if (candidate.startsWith("|") && candidate.endsWith("|") && countPipes(candidate) >= 3) {
      return index;
    }
  }

  return -1;
}

function splitFlattenedTableRows(tableText: string) {
  const normalized = tableText
    .replace(/\s+\|\s+\|(?=:?-{3,}:?)/g, " |\n|")
    .replace(/\|\s+\|\s+/g, "|\n| ")
    .replace(/\s+\|\s+\|\s+/g, " |\n| ");
  return normalized
    .split("\n")
    .map((row) => row.trim())
    .filter(Boolean)
    .map((row) => (row.startsWith("|") ? row : "| " + row))
    .map((row) => (row.endsWith("|") ? row : row + " |"));
}

function isSeparatorRow(row: string) {
  return /^\|\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(row);
}

function countPipes(value: string) {
  return [...value].filter((char) => char === "|").length;
}

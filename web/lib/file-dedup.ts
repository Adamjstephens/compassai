export function normalizedDuplicateFileName(name: string) {
  const trimmed = name.trim().toLowerCase();
  const dot = trimmed.lastIndexOf(".");
  const stem = dot > 0 ? trimmed.slice(0, dot) : trimmed;
  const extension = dot > 0 ? trimmed.slice(dot) : "";
  const normalizedStem = stem
    .replace(/\s*\(\d+\)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return `${normalizedStem}${extension}`;
}

export function fileSignature(name: string, size: number) {
  return `${normalizedDuplicateFileName(name)}::${size}`;
}

export function splitDuplicateFiles<T extends { name: string; size: number }>(
  selected: T[],
  completed: Array<{ file_name: string; file_size_bytes?: number }>,
) {
  const signatures = new Set(
    completed
      .filter((result) => Number.isFinite(result.file_size_bytes))
      .map((result) => fileSignature(result.file_name, Number(result.file_size_bytes))),
  );
  const unique: T[] = [];
  const duplicates: T[] = [];
  selected.forEach((file) => {
    const signature = fileSignature(file.name, file.size);
    if (signatures.has(signature)) {
      duplicates.push(file);
      return;
    }
    signatures.add(signature);
    unique.push(file);
  });
  return { unique, duplicates };
}

// Replace only the frontmatter `description:` line with a JSON-style double-quoted YAML scalar
// (always valid YAML; matches how real skills already quote multi-clause descriptions).
// Returns the new file content, or null if there is no frontmatter / no single-line description.
export function replaceDescription(md: string, newDescription: string): string | null {
  const lines = md.split('\n');
  if (lines[0]?.trim() !== '---') return null;

  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      end = i;
      break;
    }
  }
  if (end === -1) return null;

  for (let i = 1; i < end; i++) {
    const m = lines[i].match(/^(\s*)description:(\s*)(.*)$/);
    if (!m) continue;
    const value = m[3].trim();
    // refuse block scalars (any | or > header, incl. indentation indicators like |2, >4, |8-)
    // and empty values that continue on following lines — a single-line replace would orphan them.
    if (value === '' || value.startsWith('|') || value.startsWith('>')) return null;
    lines[i] = `${m[1]}description: ${JSON.stringify(newDescription)}`;
    return lines.join('\n');
  }
  return null;
}

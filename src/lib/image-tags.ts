/** Statements can join the caller's publish transaction, keeping tag links atomic. */
export function createImageTagStatements(db: any, imageId: number, tags: string[]) {
  const uniqueTags = JSON.stringify([...new Set(tags)]);
  return [
    db.prepare('INSERT OR IGNORE INTO tags(name) SELECT value FROM json_each(?)').bind(uniqueTags),
    db.prepare(`
      INSERT OR IGNORE INTO image_tags(image_id, tag_id)
      SELECT ?, t.id FROM json_each(?) j JOIN tags t ON t.name = j.value
    `).bind(imageId, uniqueTags),
  ];
}

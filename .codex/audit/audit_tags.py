import collections
import json
import pathlib
import re
import sqlite3
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
DB = ROOT / ".codex" / "audit" / "gallery-db-remote.sqlite"
WORK_TAGS_TS = ROOT / "src" / "lib" / "work-tags.ts"


def parse_work_groups():
    groups = []
    current = None
    in_characters = False

    for line in WORK_TAGS_TS.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        work_match = re.match(r"work: '([^']+)'", stripped)
        if work_match:
            current = {"work": work_match.group(1), "characters": []}
            groups.append(current)
            in_characters = False
            continue

        if stripped.startswith("characters: ["):
            in_characters = True
            continue

        if in_characters:
            char_match = re.match(r"\{ tag: '([^']+)',", stripped)
            if char_match and current:
                current["characters"].append(char_match.group(1))

            if stripped.startswith("],") or stripped == "]":
                in_characters = False

    return groups


def main():
    groups = parse_work_groups()

    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    authors = {
        row["author"].lower()
        for row in cur.execute(
            "select distinct author from images where author is not null and trim(author) <> ''"
        )
        if row["author"]
    }
    tag_counts = {
        row["name"]: row["n"]
        for row in cur.execute(
            "select t.name, count(*) as n from image_tags it join tags t on t.id = it.tag_id group by t.id"
        )
    }
    all_tags = set(tag_counts)
    known_works = {group["work"] for group in groups}
    known_characters = {character for group in groups for character in group["characters"]}
    style_tags = {
        "COS",
        "絲襪",
        "白絲",
        "黑絲",
        "裸足",
        "寫真",
        "日常",
        "男娘",
        "地雷系",
        "水手服",
        "吊帶襪",
        "足控",
        "反差",
        "繩縛",
        "泳裝",
        "內衣",
        "女僕",
        "兔女郎",
        "高跟鞋",
        "眼鏡",
        "體操服",
        "和服",
        "OL",
        "JK",
    }

    work_audit = []
    for group in groups:
        work = group["work"]
        characters = group["characters"]
        if work not in tag_counts:
            continue

        if characters:
            placeholders = ",".join("?" for _ in characters)
            sql = f"""
                select i.id, i.description
                from images i
                join image_tags itw on itw.image_id = i.id
                join tags tw on tw.id = itw.tag_id and tw.name = ?
                where not exists (
                  select 1
                  from image_tags itc
                  join tags tc on tc.id = itc.tag_id
                  where itc.image_id = i.id and tc.name in ({placeholders})
                )
            """
            rows = cur.execute(sql, [work, *characters]).fetchall()
        else:
            rows = cur.execute(
                """
                select i.id, i.description
                from images i
                join image_tags itw on itw.image_id = i.id
                join tags tw on tw.id = itw.tag_id and tw.name = ?
                """,
                [work],
            ).fetchall()

        hashtag_counter = collections.Counter()
        for row in rows:
            description = row["description"] or ""
            for match in re.findall(r"[#＃]([^#\s\r\n,，/|]+)", description):
                hashtag_counter[match.strip()] += 1

        filtered_missing = []
        for tag, count in hashtag_counter.most_common(20):
            lowered = tag.lower()
            if (
                tag in all_tags
                or tag in known_works
                or tag in known_characters
                or lowered in authors
                or tag in style_tags
            ):
                continue
            filtered_missing.append({"tag": tag, "count": count})
            if len(filtered_missing) >= 8:
                break

        work_audit.append(
            {
                "work": work,
                "work_count": tag_counts.get(work, 0),
                "without_character": len(rows),
                "top_missing_hashtags": filtered_missing,
                "top_raw_hashtags": [
                    {"tag": tag, "count": count}
                    for tag, count in hashtag_counter.most_common(12)
                ],
            }
        )

    uncategorized = []
    for tag, count in sorted(tag_counts.items(), key=lambda item: (-item[1], item[0])):
        lowered = tag.lower()
        if (
            lowered in authors
            or tag in known_works
            or tag in known_characters
            or tag in style_tags
        ):
            continue
        uncategorized.append({"tag": tag, "count": count})

    alias_cooccurrence = []
    for item in uncategorized:
      tag = item["tag"]
      rows = cur.execute(
          """
          select distinct t2.name as name, count(*) as n
          from image_tags it1
          join tags t1 on t1.id = it1.tag_id
          join image_tags it2 on it2.image_id = it1.image_id and it2.tag_id != it1.tag_id
          join tags t2 on t2.id = it2.tag_id
          where t1.name = ?
          group by t2.name
          order by n desc, t2.name asc
          limit 10
          """,
          [tag],
      ).fetchall()
      alias_cooccurrence.append(
          {
              "tag": tag,
              "co_tags": [{"tag": row["name"], "count": row["n"]} for row in rows],
          }
      )

    untagged_rows = cur.execute(
        """
        select description
        from images i
        where not exists (select 1 from image_tags it where it.image_id = i.id)
          and description is not null
          and trim(description) <> ''
        """
    ).fetchall()
    untagged_hashtags = collections.Counter()
    for row in untagged_rows:
        description = row["description"] or ""
        for match in re.findall(r"[#＃]([^#\s\r\n,，/|]+)", description):
            untagged_hashtags[match.strip()] += 1

    untagged_top = [
        {"tag": tag, "count": count}
        for tag, count in untagged_hashtags.most_common(60)
    ]

    print(
        json.dumps(
            {
                "work_audit": work_audit,
                "uncategorized": uncategorized,
                "alias_cooccurrence": alias_cooccurrence,
                "untagged_top_hashtags": untagged_top,
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    main()

import csv, requests, os, re, unicodedata, io, argparse
from io import StringIO

CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQh2Z4QbBx5VxQgAwXOueCe3TKK9abQQ-XWVyf5tCGKg3pIxnjhJO6buOVhOO8pCuzYmwvr5dppYTgn/pub?output=csv"
OUTPUT_DIR = "_mutants"

def slugify(name: str) -> str:
    name = name.lower().strip()
    name = re.sub(r"[''']", "", name)     
    name = re.sub(r"[^a-z0-9]+", "-", name)
    name = name.strip("-")
    return name

def make_front_matter(row: dict) -> str:
    name     = row.get("Name",  "").strip()
    mutant_id = row.get("ID",   "").strip()
    slug     = slugify(name)
    safe_name = name.replace('"', '\\"')
    return f"""---
layout: mutant
title: "{safe_name}"
mutant_id: "{mutant_id}"
permalink: /mutants/{slug}/
---
"""

def fetch_csv(url: str) -> list[dict]:
    print(f"Fetching CSV from Google Sheets")
    response = requests.get(url, timeout=15)
    response.raise_for_status()
    reader = csv.DictReader(StringIO(response.text))
    rows = [row for row in reader if row.get("Name", "").strip()]
    print(f"{len(rows)} mutants found in sheet.")
    return rows

def get_existing_slugs(output_dir: str) -> set[str]:
    if not os.path.isdir(output_dir):
        os.makedirs(output_dir)
        return set()
    return {
        os.path.splitext(f)[0]
        for f in os.listdir(output_dir)
        if f.endswith(".md")
    }

def main():
    parser = argparse.ArgumentParser(description="Generate _mutants/*.md files from the Google Sheet CSV.")
    parser.add_argument("--overwrite",action="store_true",help="Regenerate ALL .md files, even existing ones.")
    args = parser.parse_args()
    rows = fetch_csv(CSV_URL)
    existing = get_existing_slugs(OUTPUT_DIR)
    created = 0
    skipped = 0
    overwritten = 0
    for row in rows:
        name = row.get("Name", "").strip()
        mutant_id = row.get("ID", "").strip()
        if not name or not mutant_id:
            print(f"Skipping row with missing Name or ID: {row}")
            continue
        slug = slugify(name)
        filepath = os.path.join(OUTPUT_DIR, f"{slug}.md")
        if slug in existing and not args.overwrite:
            skipped += 1
            continue
        content = make_front_matter(row)
        with open(filepath, "w", encoding="utf-8") as f:
            f.write(content)
        if slug in existing:
            print(f"Overwritten:{filepath}")
            overwritten += 1
        else:
            print(f"Created:{filepath}")
            created += 1
    print(f"  Created:     {created}")
    print(f"  Overwritten: {overwritten}")
    print(f"  Skipped:     {skipped}  (already exist — use --overwrite to force)")
if __name__ == "__main__":
    main()
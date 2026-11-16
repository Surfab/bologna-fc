#!/usr/bin/env python3
"""Scarica le ultime notizie dal feed RSS di TuttoBolognaWeb e le salva in JSON per l'app.

Tiene solo titolo, sommario breve, foto, categoria, data e link all'articolo originale:
il testo completo resta sul sito dell'editore.

Uso:  python3 scripts/fetch_news.py news.json [--from-file feed.xml]
Esce con errore (senza scrivere niente) se il feed non è leggibile, così resta l'ultimo file buono.
"""
import html
import json
import os
import re
import sys
import tempfile
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime

FEED_URL = "https://www.tuttobolognaweb.it/feed"
SITE = "https://www.tuttobolognaweb.it/"
IMAGE_HOSTS = ("https://static.tuttobolognaweb.it/", SITE)
USER_AGENT = "bologna-fc-app/1.0 (+https://github.com/Surfab/bologna-fc)"
MEDIA = "{http://search.yahoo.com/mrss/}"
MAX_ITEMS = 50
SUMMARY_MAX = 220


def clean(text):
    """Testo semplice: niente HTML, spazi normalizzati."""
    text = re.sub(r"<[^>]+>", " ", text or "")
    return re.sub(r"\s+", " ", html.unescape(text)).strip()


def shorten(text, limit):
    if len(text) <= limit:
        return text
    cut = text[:limit].rsplit(" ", 1)[0]
    return cut.rstrip(" ,.;:") + "…"


def parse(xml_bytes):
    channel = ET.fromstring(xml_bytes).find("channel")
    if channel is None:
        raise ValueError("feed senza <channel>")
    items = []
    for it in channel.findall("item"):
        title = clean(it.findtext("title"))
        link = (it.findtext("link") or "").strip()
        if not title or not link.startswith(SITE):
            continue  # solo articoli del sito, niente link esterni
        try:
            date = parsedate_to_datetime(it.findtext("pubDate")).astimezone(timezone.utc)
        except (TypeError, ValueError):
            continue
        image = ""
        media = it.find(MEDIA + "content")
        if media is not None and media.get("medium", "image") == "image":
            url = media.get("url", "")
            if url.startswith(IMAGE_HOSTS):
                image = url
        items.append({
            "title": title,
            "summary": shorten(clean(it.findtext("description")), SUMMARY_MAX),
            "link": link,
            "date": date.isoformat().replace("+00:00", "Z"),
            "category": clean(it.findtext("category")) or "News",
            "image": image,
        })
    items.sort(key=lambda x: x["date"], reverse=True)
    return items[:MAX_ITEMS]


def main(argv):
    if not argv or argv[0].startswith("-"):
        sys.exit(__doc__)
    out = argv[0]
    if "--from-file" in argv:
        with open(argv[argv.index("--from-file") + 1], "rb") as f:
            raw = f.read()
    else:
        req = urllib.request.Request(FEED_URL, headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(req, timeout=30) as r:
            raw = r.read()

    items = parse(raw)
    if not items:
        sys.exit("Nessuna notizia valida nel feed: non aggiorno il file.")

    data = {
        "source": "TuttoBolognaWeb",
        "sourceUrl": SITE,
        "checkedAt": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "items": items,
    }
    # Scrittura atomica: o il file nuovo completo, o resta quello vecchio
    folder = os.path.dirname(os.path.abspath(out))
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=folder, delete=False, suffix=".tmp") as tmp:
        json.dump(data, tmp, ensure_ascii=False, indent=1)
    os.replace(tmp.name, out)
    print(f"{len(items)} notizie salvate in {out} (la più recente: {items[0]['date']})")


if __name__ == "__main__":
    main(sys.argv[1:])

#!/usr/bin/env python3
"""Build assets/players.js: all-time league goal tallies used by Score Préci.

Sources
  * Premier League  : official premierleague.com stats API (every PL scorer).
  * LaLiga, Serie A,
    Bundesliga, Ligue 1 : BDFutbol all-time scorer rankings (top 250),
                       cross-checked and enriched (clubs, display names)
                       with the English Wikipedia all-time scorer lists.
  * Ligue 1         : BDFutbol's French data starts in the late 1970s, so its
                       tallies are only kept for players born in 1960 or later;
                       older legends come from Wikipedia's 100+ goals list.
  * Champions League: Wikipedia all-time Champions League scorers list.

Usage
  pip install -r scripts/requirements.txt
  python scripts/build_data.py [--cache .cache/sources]
"""
import argparse
import datetime as dt
import json
import os
import re
import sys
import time
import unicodedata
import urllib.parse
import urllib.request

from bs4 import BeautifulSoup

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "assets", "players.js")
UA = "ScorePreci/1.0 (+https://github.com/abderrahmanemouzoune/scorepreci)"

# ---------------------------------------------------------------- countries
# Every source spells countries differently; all of them map to FIFA trigrams.
COUNTRY = {
    # ISO 3166 (premierleague.com)
    "AG": "ATG", "AL": "ALB", "AM": "ARM", "AO": "ANG", "AR": "ARG", "AT": "AUT", "AU": "AUS",
    "BA": "BIH", "BB": "BRB", "BD": "BAN", "BE": "BEL", "BF": "BFA", "BG": "BUL", "BI": "BDI",
    "BJ": "BEN", "BM": "BER", "BR": "BRA", "BY": "BLR", "CA": "CAN", "CD": "COD", "CG": "CGO",
    "CH": "SUI", "CI": "CIV", "CL": "CHI", "CM": "CMR", "CN": "CHN", "CO": "COL", "CR": "CRC",
    "CU": "CUB", "CW": "CUW", "CY": "CYP", "CZ": "CZE", "DE": "GER", "DK": "DEN", "DO": "DOM",
    "DZ": "ALG", "EC": "ECU", "EE": "EST", "EG": "EGY", "ES": "ESP", "FI": "FIN", "FR": "FRA",
    "GA": "GAB", "GB-ENG": "ENG", "GB-NIR": "NIR", "GB-SCT": "SCO", "GB-WLS": "WAL", "GD": "GRN",
    "GE": "GEO", "GH": "GHA", "GI": "GIB", "GM": "GAM", "GN": "GUI", "GP": "GLP", "GQ": "EQG",
    "GR": "GRE", "GT": "GUA", "GW": "GNB", "GY": "GUY", "HN": "HON", "HR": "CRO", "HT": "HAI",
    "HU": "HUN", "IE": "IRL", "IL": "ISR", "IR": "IRN", "IS": "ISL", "IT": "ITA", "JM": "JAM",
    "JP": "JPN", "KE": "KEN", "KR": "KOR", "LR": "LBR", "LV": "LVA", "MA": "MAR", "ME": "MNE",
    "MK": "MKD", "ML": "MLI", "MQ": "MTQ", "MR": "MTN", "MS": "MSR", "MX": "MEX", "NG": "NGA",
    "NL": "NED", "NO": "NOR", "NZ": "NZL", "PE": "PER", "PL": "POL", "PT": "POR", "PY": "PAR",
    "RO": "ROU", "RS": "SRB", "RU": "RUS", "SE": "SWE", "SI": "SVN", "SK": "SVK", "SL": "SLE",
    "SN": "SEN", "TG": "TOG", "TN": "TUN", "TR": "TUR", "TT": "TRI", "TZ": "TAN", "UA": "UKR",
    "US": "USA", "UY": "URU", "VE": "VEN", "XK": "KVX", "ZA": "RSA", "ZM": "ZAM", "ZW": "ZIM",
    "CÔTE D'IVOIRE": "CIV", "CôTE D'IVOIRE": "CIV", "TRINIDAD AND TOBAGO": "TRI",
    # Spanish slugs (BDFutbol)
    "albania": "ALB", "alemania": "GER", "angola": "ANG", "argelia": "ALG", "argentina": "ARG",
    "austria": "AUT", "belgica": "BEL", "benin": "BEN", "bosnia": "BIH", "brasil": "BRA",
    "bulgaria": "BUL", "camerun": "CMR", "canada": "CAN", "chad": "CHA", "chile": "CHI",
    "colombia": "COL", "congo": "COD", "coreadelsur": "KOR", "costademarfil": "CIV",
    "croacia": "CRO", "dinamarca": "DEN", "eslovaquia": "SVK", "eslovenia": "SVN",
    "espanya": "ESP", "estadosunidos": "USA", "francia": "FRA", "gabon": "GAB", "gales": "WAL",
    "ghana": "GHA", "grecia": "GRE", "guadalupe": "GLP", "guinea": "GUI", "holanda": "NED",
    "hungria": "HUN", "inglaterra": "ENG", "islandia": "ISL", "italia": "ITA",
    "lareunion": "REU", "liberia": "LBR", "luxemburgo": "LUX", "macedonia": "MKD", "mali": "MLI",
    "marruecos": "MAR", "martinica": "MTQ", "mexico": "MEX", "montenegro": "MNE",
    "nigeria": "NGA", "noruega": "NOR", "nuevazelanda": "NZL", "panama": "PAN",
    "paraguay": "PAR", "peru": "PER", "polonia": "POL", "portugal": "POR",
    "republicacheca": "CZE", "republicadelcongo": "CGO", "rumania": "ROU", "rusia": "RUS",
    "senegal": "SEN", "serbia": "SRB", "sudafrica": "RSA", "suecia": "SWE", "suiza": "SUI",
    "tahiti": "TAH", "togo": "TOG", "tunez": "TUN", "turquia": "TUR", "ucrania": "UKR",
    "uruguay": "URU", "yugoslavia": "YUG", "urss": "URS", "checoslovaquia": "TCH",
    "rda": "GDR", "escocia": "SCO", "irlanda": "IRL", "irlandadelnorte": "NIR",
    "japon": "JPN", "egipto": "EGY", "georgia": "GEO", "finlandia": "FIN", "israel": "ISR",
    "venezuela": "VEN", "ecuador": "ECU", "australia": "AUS", "zambia": "ZAM",
    "guineaecuatorial": "EQG", "burkinafaso": "BFA", "caboverde": "CPV", "kosovo": "KVX",
    "cuba": "CUB", "honduras": "HON", "costarica": "CRC", "jamaica": "JAM", "iran": "IRN",
    # English names (Wikipedia flags)
    "Algeria": "ALG", "Angola": "ANG", "Argentina": "ARG", "Austria": "AUT", "Belgium": "BEL",
    "Bosnia and Herzegovina": "BIH", "Brazil": "BRA", "Bulgaria": "BUL", "Cameroon": "CMR",
    "Chile": "CHI", "Colombia": "COL", "Croatia": "CRO", "Czech Republic": "CZE",
    "Czechoslovakia": "TCH", "Denmark": "DEN", "Egypt": "EGY", "England": "ENG",
    "France": "FRA", "Francoist Spain": "ESP", "Second Spanish Republic": "ESP", "Spain": "ESP",
    "Germany": "GER", "West Germany": "FRG", "East Germany": "GDR", "Greece": "GRE",
    "Hungary": "HUN", "Italy": "ITA", "Ivory Coast": "CIV", "Luxembourg": "LUX", "Mali": "MLI",
    "Mexico": "MEX", "Morocco": "MAR", "Netherlands": "NED", "Nigeria": "NGA",
    "North Macedonia": "MKD", "Norway": "NOR", "Paraguay": "PAR", "Peru": "PER",
    "Poland": "POL", "Portugal": "POR", "Republic of Ireland": "IRL",
    "Republic of the Congo": "CGO", "Romania": "ROU", "Senegal": "SEN", "Slovakia": "SVK",
    "Socialist Federal Republic of Yugoslavia": "YUG", "Yugoslavia": "YUG",
    "Kingdom of Yugoslavia": "YUG", "Soviet Union": "URS", "South Korea": "KOR",
    "Sweden": "SWE", "Switzerland": "SUI", "Trinidad and Tobago": "TRI", "Ukraine": "UKR",
    "Uruguay": "URU", "Wales": "WAL", "Scotland": "SCO", "Northern Ireland": "NIR",
    "Serbia": "SRB", "Montenegro": "MNE", "Russia": "RUS", "Turkey": "TUR", "Türkiye": "TUR",
    "Ghana": "GHA", "Gabon": "GAB", "Togo": "TOG", "Liberia": "LBR", "Israel": "ISR",
    "Kingdom of Hungary": "HUN", "Austria-Hungary": "AUT", "Kingdom of Italy": "ITA",
    "Iceland": "ISL", "Slovenia": "SVN", "Bolivia": "BOL", "Ecuador": "ECU",
    "Venezuela": "VEN", "United States": "USA", "Canada": "CAN", "Georgia": "GEO",
    "Finland": "FIN", "Albania": "ALB", "Tunisia": "TUN", "Guinea": "GUI", "Japan": "JPN",
    "Australia": "AUS", "Benin": "BEN", "Burkina Faso": "BFA", "Kosovo": "KVX",
    "DR Congo": "COD", "Democratic Republic of the Congo": "COD", "Zambia": "ZAM",
}

POS = {"G": "GB", "D": "DEF", "M": "MIL", "F": "ATT",
       "por": "GB", "def": "DEF", "mig": "MIL", "dav": "ATT"}


def nat(key):
    if not key:
        return ""
    code = COUNTRY.get(key) or COUNTRY.get(key.strip())
    if not code:
        print(f"  ! unknown country {key!r}", file=sys.stderr)
    return code or ""


def norm(s):
    s = unicodedata.normalize("NFKD", str(s))
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = s.replace("ø", "o").replace("Ø", "O").replace("ß", "ss").replace("đ", "d").replace("ł", "l")
    s = s.replace("æ", "ae").replace("ı", "i")
    return re.sub(r"[^a-z0-9 ]+", " ", s.lower()).split()


# ---------------------------------------------------------------- fetching
class Fetcher:
    def __init__(self, cache):
        self.cache = cache
        if cache:
            os.makedirs(cache, exist_ok=True)

    def get(self, url, headers=None, key=None, pause=1.5):
        path = None
        if self.cache:
            key = key or re.sub(r"[^A-Za-z0-9._-]+", "_", url)[-150:]
            path = os.path.join(self.cache, key)
            if os.path.exists(path):
                with open(path, encoding="utf-8") as f:
                    return f.read()
        h = {"User-Agent": UA}
        h.update(headers or {})
        for attempt in range(6):
            try:
                req = urllib.request.Request(url, headers=h)
                with urllib.request.urlopen(req, timeout=60) as r:
                    body = r.read().decode("utf-8")
                break
            except Exception as e:  # 429s from Wikipedia are common: back off
                wait = 15 * (attempt + 1)
                print(f"  retry in {wait}s ({e})", file=sys.stderr)
                time.sleep(wait)
        else:
            raise SystemExit(f"could not fetch {url}")
        if path:
            with open(path, "w", encoding="utf-8") as f:
                f.write(body)
        time.sleep(pause)
        return body

    def wiki(self, title, lang="en"):
        q = urllib.parse.urlencode({"action": "parse", "page": title, "prop": "text",
                                    "redirects": 1, "formatversion": 2, "format": "json"})
        body = self.get(f"https://{lang}.wikipedia.org/w/api.php?{q}",
                        key=f"wiki_{lang}_{re.sub(r'[^A-Za-z0-9]+', '_', title)}.json", pause=4)
        return BeautifulSoup(json.loads(body)["parse"]["text"], "lxml")


# ---------------------------------------------------------------- wikipedia tables
def table_grid(table):
    """Expand a wiki table into rows of cells, honouring rowspan/colspan."""
    grid, pending = [], {}
    for tr in table.find_all("tr"):
        cells = tr.find_all(["td", "th"], recursive=False)
        row, col, i = {}, 0, 0
        while i < len(cells) or any(c >= col for c in pending):
            if col in pending:
                left, cell = pending[col]
                row[col] = cell
                if left > 1:
                    pending[col] = (left - 1, cell)
                else:
                    del pending[col]
                col += 1
                continue
            if i >= len(cells):
                break
            cell = cells[i]
            i += 1
            rs = int(re.sub(r"\D", "", cell.get("rowspan", "1") or "1") or 1)
            cs = int(re.sub(r"\D", "", cell.get("colspan", "1") or "1") or 1)
            for _ in range(cs):
                row[col] = cell
                if rs > 1:
                    pending[col] = (rs - 1, cell)
                col += 1
        grid.append([row[k] for k in sorted(row)])
    return grid


def text(cell):
    for sup in cell.find_all("sup"):
        sup.decompose()
    return re.sub(r"\s+", " ", cell.get_text(" ", strip=True)).strip()


def wiki_alltime(soup):
    """Pick the all-time table (Rank | Player | Goals ...) with most rows."""
    best = None
    for t in soup.find_all("table", class_="wikitable"):
        grid = table_grid(t)
        if not grid:
            continue
        head = [text(c).lower() for c in grid[0]]
        if len(head) < 3 or not head[0].startswith("rank") or not head[1].startswith("player"):
            continue
        if "goals" not in " ".join(head):
            continue
        if best is None or len(grid) > len(best[1]):
            best = (head, grid)
    if not best:
        raise SystemExit("all-time table not found")
    head, grid = best
    col = {h.split(" ")[0].split("(")[0]: i for i, h in enumerate(head)}
    out = []
    for row in grid[1:]:
        if len(row) < len(head) or not re.search(r"\d", text(row[0])):
            continue
        pcell = row[col["player"]]
        flag = pcell.select_one("span.flagicon a[title]") or pcell.select_one("span.flagicon img")
        country = (flag.get("title") or flag.get("alt")) if flag else ""
        link = [a for a in pcell.find_all("a") if not a.find_parent("span", class_="flagicon")]
        name = text(link[0]) if link else text(pcell)
        name = re.sub(r"[*†‡§#^]+", "", name).strip()
        goals = re.sub(r"\D", "", text(row[col["goals"]]))
        if not goals or not name or "goals" in name.lower():
            continue
        clubs_cell = next((row[i] for h, i in col.items() if h.startswith("club")), None)
        first = text(row[col["first"]]) if "first" in col else ""
        last = text(row[col["last"]]) if "last" in col else ""
        if "years" in col:
            yrs = re.findall(r"\d{4}", text(row[col["years"]]))
            first, last = (yrs[0], yrs[-1]) if yrs else ("", "")
        out.append(dict(name=name, goals=int(goals), country=nat(country) if country else "",
                        first=first, last=last,
                        clubs=parse_clubs(text(clubs_cell) if clubs_cell else "", int(goals))))
    return out


def parse_clubs(s, total):
    pairs = re.findall(r"([^,()]+?)\s*\((\d+)\s*/\s*\d+\)", s)
    if pairs:
        return [(c.strip(" ,"), int(g)) for c, g in pairs if int(g) > 0]
    return [(s.strip(), total)] if s.strip() else []


# ---------------------------------------------------------------- bdfutbol
def bdf_ranking(fetch, code):
    html = fetch.get(f"https://www.bdfutbol.com/en/c/ranking{code}.html",
                     headers={"User-Agent": "Mozilla/5.0 " + UA}, key=f"bdf_{code}.html", pause=3)
    soup = BeautifulSoup(html, "lxml")
    table = max(soup.find_all("table"), key=lambda t: len(t.find_all("tr")))
    out = []
    for tr in table.find_all("tr")[1:]:
        td = tr.find_all("td")
        if len(td) < 8:
            continue
        flag = td[1].find("div")
        country = next((c for c in (flag.get("class") or []) if c != "pais"), "") if flag else ""
        pos = td[4].find("div")
        dob = td[5].get_text(strip=True)
        out.append(dict(
            name=td[2].get_text(strip=True), full=td[3].get_text(strip=True),
            pos=POS.get((pos.get("class") or [""])[0], "") if pos else "",
            born=int(dob[-4:]) if re.search(r"\d{4}$", dob) else 0,
            country=nat(country), goals=int(re.sub(r"\D", "", td[7].get_text()) or 0)))
    return out


def bdf_display(p):
    """BDFutbol shows sport names ('Messi', 'Zarra'); add the first name when it helps."""
    name, full = p["name"], p["full"]
    nt, ft = name.split(), full.split()
    if len(nt) == 1 and len(ft) > 1:
        for i in range(1, len(ft)):
            if ft[i:i + len(nt)] == nt:
                return f"{ft[0]} {name}"
    if len(nt) > 1 and len(ft) > len(nt):
        for i in range(1, len(ft)):
            if ft[i:i + len(nt)] == nt and ft[0] != nt[0]:
                return f"{ft[0]} {name}"
    return name


# Wikipedia nickname -> surname used by BDFutbol.
NICKNAMES = {"hermidita": "hermida"}


def match(wp, pool, tolerance):
    """Find the BDFutbol row that is the same person as a Wikipedia row."""
    wt = [t for t in norm(wp["name"]) if t not in ("i", "ii", "iii", "iv")]
    if not wt:
        return None
    last = NICKNAMES.get(wt[-1], wt[-1])
    first_year = int(wp["first"]) if str(wp.get("first", "")).isdigit() else 0
    best = None
    for p in pool:
        tokens = set(norm(p["name"])) | set(norm(p["full"]))
        if last not in tokens and " ".join(wt) != " ".join(norm(p["name"])):
            continue
        if first_year and p["born"] and not (first_year - 40 <= p["born"] <= first_year - 14):
            continue
        diff = abs(p["goals"] - wp["goals"])
        if tolerance is not None and diff > tolerance:
            continue
        score = diff - 50 * len(set(wt) & tokens)
        if best is None or score < best[0]:
            best = (score, p)
    return best[1] if best else None


def entry(name, goals, country, pos, born, era, aliases, clubs):
    search = []
    for s in [name] + list(aliases):
        for t in norm(s):
            if t not in search:
                search.append(t)
    club_str = " · ".join(f"{c} {g}" for c, g in clubs) if clubs and len(clubs) > 1 else \
        (clubs[0][0] if clubs else "")
    return [name, goals, country, pos, int(born or 0), era or "", " ".join(search), club_str]


def era_of(first, last):
    if first and last and first != last:
        return f"{first}–{last[-2:]}" if first[:2] == last[:2] else f"{first}–{last}"
    return f"{first}–" if first else ""


def merge_bdf_wiki(bdf, wiki, *, born_min=0, override_until=2024, tolerance=8):
    """BDFutbol rows are the base; Wikipedia adds clubs, names and fixes legends."""
    players, used = [], set()
    for wp in wiki:
        p = match(wp, bdf, None if born_min else tolerance)
        last_year = int(wp["last"]) if str(wp.get("last", "")).isdigit() else 9999
        if p:
            used.add(id(p))
            fresh = last_year > override_until and not (born_min and p["born"] < born_min)
            goals = p["goals"] if fresh else wp["goals"]
            players.append(entry(wp["name"], goals, wp["country"] or p["country"], p["pos"],
                                 p["born"], era_of(wp["first"], wp["last"]),
                                 [p["name"], p["full"]], wp["clubs"]))
        else:
            players.append(entry(wp["name"], wp["goals"], wp["country"], "", 0,
                                 era_of(wp["first"], wp["last"]), [], wp["clubs"]))
    for p in bdf:
        if id(p) in used or (born_min and p["born"] < born_min):
            continue
        players.append(entry(bdf_display(p), p["goals"], p["country"], p["pos"], p["born"], "",
                             [p["name"], p["full"]], []))
    players.sort(key=lambda e: (-e[1], e[0]))
    return players


# ---------------------------------------------------------------- leagues
def premier_league(fetch):
    rows, page = [], 0
    while True:
        url = ("https://footballapi.pulselive.com/football/stats/ranked/players/goals"
               f"?page={page}&pageSize=100&comps=1&compCodeForActivePlayer=EN_PR&altIds=true")
        body = fetch.get(url, headers={"Origin": "https://www.premierleague.com",
                                       "Referer": "https://www.premierleague.com/"},
                         key=f"pl_goals_{page}.json", pause=0.6)
        stats = json.loads(body)["stats"]
        rows += stats["content"]
        page += 1
        if page >= stats["pageInfo"]["numPages"] or not stats["content"]:
            break
    wiki = wiki_alltime(fetch.wiki("List of footballers with 100 or more Premier League goals"))
    players = []
    for r in rows:
        o = r["owner"]
        name = o["name"]["display"]
        goals = int(r["value"])
        if goals <= 0:
            continue
        team = o.get("nationalTeam") or (o.get("birth") or {}).get("country") or {}
        born = (o.get("birth") or {}).get("date", {}).get("label", "")[-4:]
        aliases, clubs = [], []
        for wp in wiki:
            if norm(wp["name"])[-1:] == norm(name)[-1:] and abs(wp["goals"] - goals) <= 6:
                aliases.append(wp["name"])
                clubs = wp["clubs"]
                break
        nm = o["name"]
        aliases.append(" ".join(x for x in [nm.get("first"), nm.get("middle"), nm.get("last")] if x))
        players.append(entry(name, goals, nat(team.get("isoCode", "")),
                             POS.get((o.get("info") or {}).get("position", ""), ""),
                             born if born.isdigit() else 0, "", aliases, clubs))
    players.sort(key=lambda e: (-e[1], e[0]))
    return players


def champions_league(fetch):
    wiki = wiki_alltime(fetch.wiki("List of UEFA Champions League top scorers"))
    players = [entry(w["name"], w["goals"], w["country"], "", 0, era_of(w["first"], w["last"]),
                     [], w["clubs"]) for w in wiki]
    players.sort(key=lambda e: (-e[1], e[0]))
    return players


LEAGUES = [
    dict(id="pl", name="Premier League", short="PREMIER LEAGUE", country="ENG",
         scope="Tous les buteurs de l'histoire de la Premier League (depuis 1992)",
         source="premierleague.com"),
    dict(id="liga", name="LaLiga", short="LALIGA", country="ESP",
         scope="Les 250 meilleurs buteurs de l'histoire de la Liga",
         source="BDFutbol · Wikipedia"),
    dict(id="seriea", name="Serie A", short="SERIE A", country="ITA",
         scope="Les 250 meilleurs buteurs de l'histoire de la Serie A",
         source="BDFutbol · Wikipedia"),
    dict(id="bundesliga", name="Bundesliga", short="BUNDESLIGA", country="GER",
         scope="Les 250 meilleurs buteurs de l'histoire de la Bundesliga",
         source="BDFutbol · Wikipedia"),
    dict(id="ligue1", name="Ligue 1", short="LIGUE 1", country="FRA",
         scope="Les meilleurs buteurs de l'histoire du championnat de France",
         source="Wikipedia · BDFutbol"),
    dict(id="ucl", name="Ligue des champions", short="LIGUE DES CHAMPIONS", country="UEFA",
         scope="Les 100 meilleurs buteurs de l'histoire de la C1",
         source="Wikipedia"),
]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", default=os.path.join(ROOT, ".cache", "sources"))
    args = ap.parse_args()
    fetch = Fetcher(args.cache)

    built = {}
    print("Premier League…")
    built["pl"] = premier_league(fetch)
    print("LaLiga…")
    built["liga"] = merge_bdf_wiki(bdf_ranking(fetch, "G1"),
                                   wiki_alltime(fetch.wiki("List of La Liga top scorers")))
    print("Serie A…")
    built["seriea"] = merge_bdf_wiki(bdf_ranking(fetch, "GIta1"),
                                     wiki_alltime(fetch.wiki("List of Serie A players with 100 or more goals")))
    print("Bundesliga…")
    built["bundesliga"] = merge_bdf_wiki(bdf_ranking(fetch, "GGer1"),
                                         wiki_alltime(fetch.wiki("List of Bundesliga top scorers")))
    print("Ligue 1…")
    built["ligue1"] = merge_bdf_wiki(bdf_ranking(fetch, "GFra1"),
                                     wiki_alltime(fetch.wiki("List of Ligue 1 top scorers")),
                                     born_min=1960)
    print("Champions League…")
    built["ucl"] = champions_league(fetch)

    leagues = []
    for meta in LEAGUES:
        players = built[meta["id"]]
        meta = dict(meta, count=len(players), min=min(p[1] for p in players),
                    max=max(p[1] for p in players), players=players)
        leagues.append(meta)
        print(f"  {meta['name']:<20} {meta['count']:>5} players  {meta['min']}–{meta['max']} goals")

    data = {"updated": dt.date.today().isoformat(),
            "fields": ["name", "goals", "nat", "pos", "born", "era", "search", "clubs"],
            "leagues": leagues}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        f.write("/* Generated by scripts/build_data.py — do not edit by hand. */\n")
        f.write("window.SCOREPRECI_DATA = ")
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
        f.write(";\n")
    print(f"wrote {OUT} ({os.path.getsize(OUT) // 1024} KB)")


if __name__ == "__main__":
    main()

# Score Préci

Le jeu des buteurs au but près. Mobile first, sans dépendance ni build.

1. Choisis un championnat, un nombre de joueurs (3, 5, 7 ou 11) et une cible en buts.
2. Cite des buteurs un par un : chaque nom révèle ses buts dans ce championnat, toutes saisons confondues.
3. Après le dernier joueur, l'écart avec la cible donne le verdict, de **Lucarne** (écart nul) à **En tribune**.

Le tirage au sort additionne les buts de vrais joueurs, donc une combinaison parfaite existe toujours. Un **défi du jour** propose la même cible à tout le monde.

## Lancer le jeu

Ouvre `index.html` dans un navigateur, ou sers le dossier :

```sh
python3 -m http.server 8000
# puis http://localhost:8000
```

Le site est 100 % statique : il peut être publié tel quel sur GitHub Pages (Settings → Pages → branche `main`, dossier racine).

## Données

`assets/players.js` est généré par `scripts/build_data.py` :

| Championnat | Joueurs | Source |
| --- | --- | --- |
| Premier League | tous les buteurs depuis 1992 (2 894) | API officielle premierleague.com |
| LaLiga, Serie A, Bundesliga | top 250 historique | BDFutbol, recoupé avec Wikipédia |
| Ligue 1 | top 250 historique | Wikipédia (légendes) + BDFutbol (joueurs nés après 1960) |
| Ligue des champions | 52 joueurs à 25 buts et + | Wikipédia |

Seuls les buts en championnat comptent. Pour rafraîchir les totaux des joueurs en activité :

```sh
pip install -r scripts/requirements.txt
python3 scripts/build_data.py
```

Les réponses brutes sont mises en cache dans `.cache/sources` (ignoré par git) ; supprime ce dossier pour forcer un nouveau téléchargement.

## Structure

```
index.html            écrans accueil, match et résultat
assets/style.css      direction artistique : pelouse, tableau à volets, feuille de match
assets/app.js         logique du jeu, recherche, volets, sons (Web Audio), défi du jour
assets/players.js     données générées
scripts/build_data.py  pipeline de données
```

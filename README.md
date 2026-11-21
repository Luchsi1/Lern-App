# Lernkarten – Lern-App mit Spaced Repetition

Reine HTML/CSS/JavaScript-App (ES-Module, keine Abhängigkeiten, kein Build, kein Backend).
Alle Daten liegen in **IndexedDB** im Browser; nach dem ersten Laden funktioniert die App offline (Service Worker).

## Auf GitHub Pages veröffentlichen
1. Neues Repository anlegen und den **Inhalt dieses Ordners** (nicht den Ordner selbst) in den Hauptzweig hochladen.
2. Repository → *Settings* → *Pages* → Source: *Deploy from a branch* → Branch `main`, Ordner `/ (root)` → *Save*.
3. Nach ca. 1 Minute ist die App unter `https://<name>.github.io/<repo>/` erreichbar.

Alle Pfade sind relativ und die Navigation nutzt `#/…`-Routen, daher funktioniert die App auch in Unterverzeichnissen.
Lokal testen: `python3 -m http.server` im Ordner und `http://localhost:8000` öffnen (nicht per `file://`, wegen ES-Modulen).

## Struktur
- `index.html`, `css/` (Designsystem, Komponenten, Ansichten)
- `js/db.js` IndexedDB · `js/store.js` Datenmodell, Suche, Statistik · `js/srs.js` Wiederholungsalgorithmus
- `js/backup.js` Export/Import/Backups · `js/session.js` Lerneinheiten · `js/views/*` Seiten · `js/components/*` Editor, Picker
- `sw.js` Offline-Cache (bei Updates `VERSION` erhöhen)

## Datenmodell (Supabase-tauglich)
Jeder Object Store entspricht einer Tabelle, Primärschlüssel sind UUIDs, Zeitstempel sind Millisekunden (`createdAt`, `updatedAt`).
`cards`, `categories` (`parentId`), `reviews` (pro Karte), `reviewLog`, `tombstones` (gelöschte IDs für Sync), `backups`, `meta`.
Für eine Synchronisierung: pro Tabelle `updatedAt` vergleichen („neuer gewinnt“), `tombstones` als Löschungen übertragen.

## Wiederholungsalgorithmus
„Gewusst“: 1 Tag → 3 Tage → Intervall × Leichtigkeitsfaktor (leicht gestreut). „Nicht gewusst“: zurück auf Anfang, Karte kommt nach 10 Minuten wieder, Faktor sinkt (schwierige Karten wachsen langsamer). Gefestigt ab 21 Tagen Intervall.

## Datensicherheit
Jede Änderung wird sofort in IndexedDB geschrieben, dauerhafter Speicher wird angefragt, täglich entsteht ein automatisches Browser-Backup, vor Import/Löschen ebenfalls. Zusätzlich: JSON-Export/-Import (Einstellungen → Daten & Backup). Browserdaten löschen entfernt auch die Datenbank – bitte regelmäßig exportieren.

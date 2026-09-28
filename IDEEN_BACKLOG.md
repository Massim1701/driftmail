# IDEEN_BACKLOG.md — Gesammelte Ideen fuer spaeter

Regel: Hier kommen Ideen rein, die NICHT sofort umgesetzt werden, sondern erst
wenn das Fundament (Track 0-F, aktuelle WEB_INBOX.md-Auftraege) steht. Wer
etwas hier eintraegt, schreibt kurz Kontext dazu, damit man es spaeter ohne
Rueckfrage verstehen kann. Wenn eine Idee reif fuer die Umsetzung ist, wird
sie von hier nach WEB_INBOX.md verschoben (nicht kopiert — hier dann loeschen).

Format: [Datum] [Titel] — Beschreibung + Kontext

---

[2026-09-08] Newsletter-Erkennung mit Erstkontakt-Frage — Bei der ersten Newsletter-Mail eines Absenders fragt driftmail einmalig: "Hast du das angefordert?". Antwort wird pro Absender gespeichert (Tabelle etwa newsletter_sender_decision: user_id, sender_domain, decision, decided_at). Bei "nein": automatische Abmeldung ueber den sicheren List-Unsubscribe-Header (RFC 8058, wie in der bestehenden Regel — NIE Klick auf Body-Links) plus danach automatisches Entsorgen/Nie-mehr-Zustellen kuenftiger Mails dieses Absenders, ohne erneut zu fragen. Bei "ja": normale Zustellung, ggf. eigener Ordner/Kategorie. Erkennung der Erst-Newsletter-Mail ueber vorhandene List-Unsubscribe-Header-Pruefung + Content-Muster.

---



[2026-09-09] Event-Einladungen erkennen (Termine/Feiern) — Mail als Kalender-Einladung erkennen (z.B. iCal/.ics-Anhang oder typische Einladungs-Formulierungen/Datum+Uhrzeit-Muster im Text). User entscheidet aktiv: teilnehmen oder nicht. Je nach Entscheidung automatisch Zu-/Absage-Antwort an den Absender verschicken (Text editierbar wie bei anderen Antwortentwuerfen, kein Auto-Send ohne Bestaetigung, siehe bestehende Compose-Regeln). Bei Zusage: Termin im Kalender vermerken (eigener Kalender oder Verknuepfung zu einem externen, noch zu klaeren) + automatische Erinnerung 1 Tag vorher. Beruehrt vermutlich: neue Tabelle fuer erkannte Termine (aehnlich contracts/reminders-Muster aus Track D), neue Ordner-/Detail-UI fuer "Einladung" aehnlich der Vertrags-Karte, eigener Reminder-Typ oder Wiederverwendung der bestehenden reminders-Tabelle. Noch nicht spezifiziert, nur Idee.


[2026-09-27] Zweite Meinung (verdaechtige Mail an eine Vertrauensperson) — Bei einer als verdaechtig markierten Mail gibt es den Knopf "Zweite Meinung einholen". Der User waehlt eine Vertrauensperson (Kontakt), driftmail erstellt einen Entwurf mit entschaerftem Inhalt (Links nur als Text, nicht klickbar, Warnhinweise der Pruefung mit angehaengt). Der User prueft und sendet selbst, KEIN Auto-Send (bestehende Regel). Zielgruppe: Menschen, die auf Betrug leicht hereinfallen, und deren Angehoerige. Spaeter optional: feste Vertrauensperson in den Einstellungen. Beruehrt: Compose-Flow, Link-Entschaerfung in Textform. (Ideensammlung 27.09., eigene Idee, kein Nachbau.)

[2026-09-27] Heute-Uebersicht ("Was steht an") — Ein ruhiger Bildschirm mit allem, was aus den Mails folgt: Pakete unterwegs (shipments), Fristen (contracts/reminders), faellige Rechnungen, spaeter Termine (sobald Event-Einladungen existieren, siehe Eintrag 09.09.). Nutzt die vorhandene Backend-Erkennung, neu ist vor allem die Uebersichts-UI und ggf. ein GET-Endpoint, der die bestehenden Tabellen buendelt. Reine Lese-Aggregation. (Ideensammlung 27.09.)

[2026-09-27] Schutzbericht (Wochenzusammenfassung) — Kurze Karte, z.B. "12 Tracker blockiert, 2 Phishing-Versuche gestoppt, 1 Anhang gesperrt". Aggregiert aus vorhandenen Daten (scan_status, Tracking-Schutz-Zaehler, Quarantaene). Anzeige in der App (z.B. Einstellungen > Sicherheit), optional als lokale Benachrichtigung. Nur Zaehler, keine Mail-Inhalte. Zeigt den Wert von driftmail und ist guenstig zu bauen, weil die Daten schon anfallen. (Ideensammlung 27.09.)

[2026-09-27] Fristen-Waechter fuer Vertraege und Abos — Aus den erkannten Vertraegen (Track D, extractContract): Kuendigungsfrist, Jahreskosten und Gesamtsumme aller Abos. Erinnerung vor Fristende ueber den vorhandenen Reminder-Scheduler. Zur Kuendigung ein fertiger Entwurf (Text editierbar, User sendet selbst, kein Auto-Send). Baut auf contracts + reminders auf. (Ideensammlung 27.09.)

[2026-09-27] Einfach-Modus — Schaltbarer Modus in den Einstellungen: grosse Schrift, wenige grosse Knoepfe (Lesen, Antworten, Loeschen), reduzierte Ansicht. Sicherheitswarnungen bleiben dabei klar und gross sichtbar. Zielgruppe u.a. web.de/GMX-Nutzer ohne Technik-Erfahrung. Zusammen mit "Zweite Meinung" ein eigenes Profil: Mail fuer Menschen, die sich sicher fuehlen wollen. Dynamic Type auf iOS beachten. (Ideensammlung 27.09.)

[2026-09-27] Regeln in einem Satz — Statt Filter-Dialogen tippt der User einen Satz ("Alles von der Krankenkasse in Gesundheit"). driftmail versteht ihn lokal (on-device) und zeigt die Regel zur Bestaetigung an, bevor sie aktiv wird. Regeln als Liste einsehbar und loeschbar. Keine Cloud. Ist kein lokales Modell verfuegbar: einfache Mustererkennung als Fallback oder Funktion ausblenden. (Ideensammlung 27.09.)

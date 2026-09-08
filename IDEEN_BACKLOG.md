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


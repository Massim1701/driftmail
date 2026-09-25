-- driftmail — DB-Schema (Track 0 Contract)
-- Alle Tracks arbeiten gegen dieses Schema. Änderungen nur über Track 0.

-- ===== Users & Accounts =====

-- [2026-09-21] "Einstellungsbereich"-Auftrag (WEB_INBOX.md 21.09.,
-- "Ansicht: Akzentfarben-Auswahl"): accent_theme neu, siehe
-- design-tokens.json color.accentThemes fuer die moeglichen Werte.
-- [2026-09-25] WEB_INBOX.md 24.09. "DESIGN-RICHTUNG PRAEZISIERT -
-- Outlook-inspiriert": 'outlook_blue' als neuer Wert + neuer DEFAULT
-- (ersetzt 'teal'), siehe postgresStore.ts fuer die Migration bestehender
-- DBs (DROP/ADD CONSTRAINT + ALTER COLUMN SET DEFAULT).
-- [2026-09-21] "FUENF NEUE KOMFORT-FEATURES" Punkt 1 ("Unbekannte
-- Absender streng behandeln"): strict_unknown_senders neu, Default true
-- (wie im Auftrag vorgegeben). Tabelle war schon von echtem Code
-- beschrieben (Auth/Login) -- echte ALTER-TABLE-Migration in
-- postgresStore.ts noetig, siehe dort.
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT UNIQUE NOT NULL,
    accent_theme TEXT NOT NULL DEFAULT 'outlook_blue' CHECK (accent_theme IN ('teal', 'ocean_blue', 'violett', 'koralle', 'ocean_verlauf', 'outlook_blue')),
    strict_unknown_senders BOOLEAN NOT NULL DEFAULT true,
    -- [2026-09-21] "DREI WEITERE FEATURES - Gmail-Recherche" Punkt 2 ("Nudge"):
    -- Ein/Aus-Schalter, wie im Auftrag ausdruecklich verlangt ("manche Nutzer
    -- empfinden es als aufdringlich"). Default true, wie Gmail.
    nudge_unanswered_enabled BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

CREATE TABLE IF NOT EXISTS mail_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider TEXT NOT NULL CHECK (provider IN ('gmail', 'imap', 'pop3')),
    email_address TEXT NOT NULL,
    encrypted_oauth_token TEXT,
    encrypted_imap_credentials TEXT,
    sync_status TEXT NOT NULL DEFAULT 'pending' CHECK (sync_status IN ('pending', 'syncing', 'ok', 'error')),
    last_synced_at TIMESTAMPTZ
  );

-- [2026-09-10] Echte Auth (TERMINAL_INBOX.md 09.09., von Web priorisiert
-- direkt nach Persistenz; "Automatische Abmeldung bei Spam" kam als
-- Zwischen-Auftrag dazwischen, siehe WEB_INBOX.md). Bisher lief das gesamte
-- Backend gegen einen einzigen fest verdrahteten Demo-User (ensureDemoUser()
-- in db/store.ts) -- kein echter Login, kein Bearer-Token wurde je geprueft,
-- obwohl der Contract `security: bearerAuth` bereits seit 08.09. global
-- vorschreibt (Commit 42a8b53). `sessions` schliesst genau diese Luecke:
-- ein Opaque-Token (kein JWT, keine Signaturpruefung noetig, einfacher
-- Datenbank-Lookup reicht fuer diesen Umfang) pro eingeloggter Sitzung.
-- BEWUSSTE GRENZE (kein Blocker, siehe backend/README.md "Auth"):
-- Klartext-Token-Speicherung (kein Hashing wie bei Passwoertern), keine
-- Rate-Limits gegen Brute-Force, kein Refresh-Token getrennt vom
-- Zugriffstoken -- ausreichend fuer dieses Entwicklungsstadium (analog zur
-- bereits akzeptierten Sicherheitsschwelle bei den Mock-Scans/-Lookups),
-- aber vor echtem Produktivbetrieb nachzuruesten.
CREATE TABLE IF NOT EXISTS sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token TEXT UNIQUE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL
  );

CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions (token);

-- ===== Ordner (frei anlegbar, siehe SYNC.md "Contract-Aenderungen" 08.09.) =====
--
-- Ersetzt den vorherigen festen folder-Enum auf messages. Jeder User bekommt
-- bei Account-Anlage die 7 System-Ordner als Zeilen hier angelegt (Anwendungs-
-- logik, kein DB-Trigger) -- is_system=true schuetzt sie vor dem Loeschen,
-- system_key bleibt stabil fuer Code, das gezielt z.B. "quarantaene" braucht,
-- auch wenn der User den Ordner umbenennt. quarantaene/spam/entwuerfe/gesendet
-- sind NICHT umbenennbar (siehe design-tokens.json systemFolders.defaults),
-- das wird app-seitig durchgesetzt, nicht per Constraint.
--
-- [2026-09-10] Ordner-Umbau (WEB_INBOX.md 09.09. "KORREKTUR/ERWEITERUNG des
-- Ordner-Umbau-Eintrags"): system_key-Werte auf die neue 7er-Liste geaendert
-- (wichtig/rechnungen entfallen, eingang/entwuerfe/gesendet neu) -- direkt am
-- CREATE TABLE geaendert statt per ALTER TABLE (Repo-Konvention, siehe
-- message_attachments weiter unten). Bestehende wichtig/rechnungen-Ordner +
-- deren Nachrichten werden app-seitig migriert (siehe
-- backend/src/db/store.ts migrateLegacySystemFolders()), nicht per SQL.
--
-- [2026-09-21] Mehrfach-Konten (WEB_INBOX.md 21.09. "SEHR WICHTIGE LUECKE -
-- HOECHSTE PRIORITAET", Punkt 2; Massimo: "getrennte Ansichten pro Konto",
-- nicht ein vereinheitlichter Eingang): `user_id` -> `mail_account_id`
-- ersetzt, analog zu `messages` (die schon `mail_account_id` statt
-- `user_id` nutzen). Vorher teilten sich ALLE Konten eines Users denselben
-- Ordnerbaum (ein einziges "eingang" fuer den ganzen User) -- das
-- widerspricht "getrennte Ansichten", jedes Konto bekommt jetzt seine
-- eigenen 7 System-Ordner. Direkt am CREATE TABLE geaendert (Repo-
-- Konvention, s.o.); fuer eine bereits bestehende Postgres-DB (Spalte
-- `user_id` existiert noch) migriert `backend/src/db/postgresStore.ts`
-- `migrate()` die Spalte automatisch beim Start (ADD mail_account_id,
-- Backfill ueber das erste/einzige Konto jedes betroffenen Users, DROP
-- user_id) -- echte ALTER-TABLE-Migration, kein reiner App-Logik-Move wie
-- beim Ordner-Umbau oben, weil hier eine Spalte selbst (nicht nur
-- Zeileninhalte) ihre Bedeutung aendert.

CREATE TABLE IF NOT EXISTS folders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mail_account_id UUID NOT NULL REFERENCES mail_accounts(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    icon TEXT NOT NULL DEFAULT 'inbox',
    is_system BOOLEAN NOT NULL DEFAULT false,
    system_key TEXT CHECK (system_key IN ('eingang', 'entwuerfe', 'gesendet', 'sonstiges', 'quarantaene', 'spam', 'papierkorb')),
    sort_order INTEGER NOT NULL DEFAULT 0,
    UNIQUE (mail_account_id, system_key)
  );

CREATE INDEX IF NOT EXISTS idx_folders_account ON folders (mail_account_id);

-- ===== Messages =====

CREATE TABLE IF NOT EXISTS messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mail_account_id UUID NOT NULL REFERENCES mail_accounts(id) ON DELETE CASCADE,
    message_id_header TEXT NOT NULL,
    -- Provider-natives Handle fuer Papierkorb/Loeschen-Spiegelung (Terminal
    -- 09.09., siehe backend/README.md "Papierkorb / Loeschen"): Gmail-
    -- Message-ID bzw. IMAP-UID, NICHT der RFC822 Message-ID-Header oben.
    -- NULL bei Nachrichten ohne echtes Postfach dahinter (Fixtures).
    provider_message_id TEXT,
    from_address TEXT NOT NULL,
    from_display_name TEXT,
    reply_to_address TEXT,
    subject TEXT,
    body_text TEXT,
    -- [2026-09-21] "NEUE GRUNDLAGE - HTML-Rendering des Mail-Bodies":
    -- roher, NICHT sanitized-er HTML-Koerper wie vom Provider geliefert.
    -- Sanitizing (Scripts/Iframes/Forms entfernen, Remote-Bilder je nach
    -- privacySettings.blockRemoteImages blocken, Links auf /link-check
    -- umschreiben) passiert erst beim Ausliefern in routes/messages.ts
    -- (siehe mail/htmlSanitize.ts), NICHT hier beim Speichern -- ein spaeter
    -- geaenderter Privacy-Schalter soll auch fuer laengst synchronisierte
    -- Mails rueckwirkend greifen, das geht nur wenn die Rohdaten erhalten
    -- bleiben. NULL bei reinen Text-Mails oder wenn der Adapter kein HTML
    -- liefert (Fixture-Nachrichten ohne explizites bodyHtml).
    body_html TEXT,
    received_at TIMESTAMPTZ NOT NULL,
    folder_id UUID NOT NULL REFERENCES folders(id),
    raw_headers JSONB,
    -- Thread-Verknuepfung (WEB_INBOX.md 15.09., "IBAN-Wechsel im selben
    -- Thread"): aus dem "In-Reply-To"-Header aufgeloest gegen
    -- message_id_header desselben Kontos. NULL, wenn kein In-Reply-To-Header
    -- vorhanden ist ODER die referenzierte Nachricht nicht in diesem Konto
    -- synchronisiert wurde (externer/unsynchronisierter Thread-Vorgaenger) --
    -- gleiches Grenzen-Muster wie ueberall sonst in diesem Schema (NULL statt
    -- geraten). Self-Referencing FK, analog zu drafts.in_reply_to_message_id.
    in_reply_to_message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
    -- [2026-09-21] "DREI WEITERE FEATURES - Gmail-Recherche" Punkt 3
    -- ("Vertraulicher Modus"): Ablaufdatum, ab dem der Nachrichtentext
    -- serverseitig geloescht (bodyText -> NULL) wird. NULL = keine
    -- Ablaufzeit gesetzt (Normalfall). Siehe backend/src/mail/confidential.ts
    -- fuer die Loesch-Logik -- kein Hintergrund-Job, Ablauf wird lazy beim
    -- naechsten Lesezugriff (GET /messages, GET /messages/:id) geprueft und
    -- dann EINMALIG wirklich geloescht, nicht nur pro Response maskiert.
    confidential_until TIMESTAMPTZ,
    -- [2026-09-21] "NEUE AUFTRAEGE - 5 Wettbewerbs-Luecken" Punkt 5
    -- ("Snooze"): eigenes, einfaches Feld statt der bestehenden
    -- `reminders`-Tabelle (deren `contract_id NOT NULL` sie fest an die
    -- Vertragserkennung bindet, nicht an einzelne Nachrichten -- gleiche
    -- Abwaegung wie beim "Nudge"-Feature, siehe backend/README.md). NULL =
    -- nicht snoozed. Gesetzt UND in der Zukunft = aus der Ordner-Ansicht
    -- ausgeblendet (siehe store.listMessages()), taucht automatisch wieder
    -- auf, sobald der Zeitpunkt erreicht ist -- kein periodischer Job
    -- noetig, reiner Zeitvergleich bei jedem Lesezugriff.
    snoozed_until TIMESTAMPTZ,
    UNIQUE (mail_account_id, message_id_header)
  );

CREATE INDEX IF NOT EXISTS idx_messages_account_folder ON messages (mail_account_id, folder_id);

-- ===== Entwuerfe (WEB_INBOX.md 09.09. "KORREKTUR/ERWEITERUNG des
-- Ordner-Umbau-Eintrags") =====
--
-- Bewusst GETRENNT von messages: ein Entwurf hat keine echte
-- message_id_header eines Providers (messages ist auf empfangene/gesendete
-- echte Mails ausgelegt, siehe UNIQUE-Constraint oben). Der "entwuerfe"-
-- Systemordner in der UI zeigt den Inhalt dieser Tabelle, nicht messages.
-- in_reply_to_message_id nullable (Entwurf kann eine neue Mail sein, nicht
-- nur eine Antwort). Kein eigener Ordner-Bezug (folder_id) noetig -- jeder
-- Entwurf eines Users landet implizit im entwuerfe-Systemordner des Kontos.

CREATE TABLE IF NOT EXISTS drafts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    mail_account_id UUID NOT NULL REFERENCES mail_accounts(id) ON DELETE CASCADE,
    in_reply_to_message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
    to_addresses TEXT[] NOT NULL DEFAULT '{}',
    cc_addresses TEXT[] NOT NULL DEFAULT '{}',
    -- [2026-09-21] "NEUE AUFTRAEGE - 5 Wettbewerbs-Luecken" Punkt 4
    -- ("Schedule Send"): bcc fehlte hier bisher komplett (nur beim
    -- direkten POST /messages/send vorhanden, siehe dortigen bcc-Kommentar)
    -- -- fuer den geplanten Versand ueber einen Entwurf gebraucht, damit
    -- derselbe Sende-Pfad (mail/scheduler.ts) exakt dieselben Empfaenger-
    -- Felder wie ein direkter Versand unterstuetzt.
    bcc_addresses TEXT[] NOT NULL DEFAULT '{}',
    subject TEXT,
    body_text TEXT,
    -- NULL = normaler Entwurf. Gesetzt = "Spaeter senden"-Auftrag, wird vom
    -- periodischen Scheduler (mail/scheduler.ts) automatisch verschickt,
    -- sobald die Zeit erreicht ist (siehe dortigen Kommentar).
    scheduled_for TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

CREATE INDEX IF NOT EXISTS idx_drafts_user ON drafts (user_id);

-- ===== Security-Analyse (1:1 zu messages) =====

CREATE TABLE IF NOT EXISTS message_security (
    message_id UUID PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
    spf_status TEXT CHECK (spf_status IN ('pass', 'fail', 'none')),
    dkim_status TEXT CHECK (dkim_status IN ('pass', 'fail', 'none')),
    dmarc_status TEXT CHECK (dmarc_status IN ('pass', 'fail', 'none')),
    sender_domain_age_days INTEGER,
    domain_reputation_score NUMERIC(3,2),
    homoglyph_detected BOOLEAN NOT NULL DEFAULT false,
    link_mismatch_detected BOOLEAN NOT NULL DEFAULT false,
    -- Anzeigename-Spoofing / Reply-To-Mismatch (WEB_INBOX.md 15.09., "6
    -- Sicherheits-Ergaenzungen" Punkt 1+2) -- siehe
    -- contracts/ai-adapter-interface.ts SecurityResult fuer die Bedeutung.
    display_name_spoofing_detected BOOLEAN NOT NULL DEFAULT false,
    reply_to_mismatch_detected BOOLEAN NOT NULL DEFAULT false,
    urgency_language_score NUMERIC(3,2),
    contains_new_iban BOOLEAN NOT NULL DEFAULT false,
    -- IBAN-Wechsel im selben Thread (WEB_INBOX.md 15.09., "6 Sicherheits-
    -- Ergaenzungen" Punkt 3): true, wenn eine FRUEHERE Nachricht desselben
    -- Threads (messages.in_reply_to_message_id-Kette) eine ANDERE IBAN
    -- enthielt als die aktuelle Nachricht. Staerkeres Signal als
    -- contains_new_iban allein (Rechnungsbetrug-typisch), zustandsbehaftet
    -- -- kann analyzeMail() (Track B) nicht selbst liefern, wird von Track A
    -- als Nachbearbeitungsschritt befuellt (siehe backend/README.md).
    iban_changed_in_thread BOOLEAN NOT NULL DEFAULT false,
    classification TEXT NOT NULL DEFAULT 'unclear' CHECK (classification IN ('safe', 'spam', 'phishing', 'unclear')),
    -- Nur gesetzt wenn classification = 'spam'. 'adult'/'gambling'/
    -- 'advance_fee_scam' loesen sofortiges Loeschen aus (kein
    -- Quarantaene-Pfad, kein 30-Tage-Aufheben, kein Undo) -- siehe
    -- WEB_INBOX.md 08.09. bzw. 15.09. ("Vorschussbetrug"). Betrifft NICHT
    -- 'phishing', das bleibt immer im Quarantaene-Pfad.
    spam_subcategory TEXT CHECK (spam_subcategory IN ('adult', 'gambling', 'generic', 'marketing', 'advance_fee_scam')),
    -- Botnetz-Erkennung (WEB_INBOX.md 08.09.). ip_reputation_flag braucht
    -- einen externen Blocklist-Abgleich (z.B. Spamhaus XBL/CBL) -- das kann
    -- ein zustandsloses Text+Header-Modul (Track B) nicht selbst liefern,
    -- siehe SYNC.md "Offene Fragen" (dasselbe Problem wie bei
    -- domain_reputation_score). helo_mismatch ist aus dem Received-Header
    -- ableitbar, aber ohne echten Reverse-DNS-Abgleich nur eine Annaeherung.
    ip_reputation_flag TEXT CHECK (ip_reputation_flag IN ('clean', 'known_botnet', 'unknown')),
    helo_mismatch BOOLEAN DEFAULT false,
    image_to_text_ratio NUMERIC(3,2),
    confidence_score NUMERIC(3,2),
    analyzed_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

CREATE TABLE IF NOT EXISTS message_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    display_text TEXT,
    actual_url TEXT NOT NULL,
    domain_matches_display BOOLEAN NOT NULL DEFAULT true,
    is_known_malicious BOOLEAN NOT NULL DEFAULT false
  );

-- ===== Unsubscribe (nur RFC 8058, nie Body-Link) =====
--
-- [2026-09-10] Automatische Abmeldung bei Spam (WEB_INBOX.md 09.09.
-- "Automatisches Abmelden bei Spam"): zwei kleine Ergaenzungen, direkt am
-- CREATE TABLE geaendert statt per ALTER TABLE (Repo-Konvention, siehe
-- message_attachments weiter oben -- die Tabelle wurde bisher von keinem
-- Code beschrieben, kein Bestand, der eine echte Migration braeuchte).
-- 1. user_id neu: fuer adult/gambling-Spam gibt es (Auto-Delete-Regel)
--    NIE eine messages-Zeile, ueber die sich der User sonst ableiten liesse
--    (gleiches Problem wie bei security_audit_log, das userId deshalb
--    ebenfalls direkt fuehrt statt nur ueber message_id abzuleiten).
-- 2. message_id jetzt nullable, aus demselben Grund -- die automatische
--    Abmeldung bei adult/gambling-Spam muss VOR dem Verwerfen laufen
--    (Header steht beim Klassifikations-Durchlauf schon zur Verfuegung),
--    ohne dass danach je eine Nachricht angelegt wird.
CREATE TABLE IF NOT EXISTS unsubscribe_actions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    message_id UUID REFERENCES messages(id) ON DELETE CASCADE,
    method TEXT NOT NULL CHECK (method IN ('list_unsubscribe_header', 'manual')),
    list_unsubscribe_header_value TEXT,
    -- [2026-09-21] "LUECKE SCHLIESSEN - echter Abmelde-Aufruf" (WEB_INBOX.md
    -- 21.09.): 'failed' neu -- vorher wurde status blind auf 'confirmed'
    -- gesetzt, ohne dass je ein echter Netzwerk-Aufruf/Mail-Versand
    -- stattfand. Jetzt wird wirklich dispatcht (siehe mail/listUnsubscribe.ts
    -- performUnsubscribe()), 'failed' bei Netzwerkfehler/4xx/5xx/fremder
    -- Redirect-Domain. Tabelle war schon von echtem Code beschrieben (nicht
    -- wie manche andere KI-Tabellen ungenutzt) -- echte Migration in
    -- postgresStore.ts noetig, siehe migrateUnsubscribeActionsStatusCheck().
    status TEXT NOT NULL DEFAULT 'pending_confirmation' CHECK (status IN ('pending_confirmation', 'confirmed', 'rejected', 'failed')),
    triggered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    user_confirmed_at TIMESTAMPTZ
  );

-- ===== Quarantäne =====

CREATE TABLE IF NOT EXISTS quarantine (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    quarantined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    reason TEXT NOT NULL,
    auto_delete_at TIMESTAMPTZ NOT NULL,
    user_reviewed BOOLEAN NOT NULL DEFAULT false
  );

-- ===== Audit-Log =====

CREATE TABLE IF NOT EXISTS security_audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
    action TEXT NOT NULL, -- 'auto_quarantined' | 'user_unsubscribed' | 'user_overrode_warning' | ...
    timestamp TIMESTAMPTZ NOT NULL DEFAULT now()
  );

-- ===== Verträge & Reminder =====

CREATE TABLE IF NOT EXISTS contracts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    provider_name TEXT NOT NULL,
    contract_start DATE,
    contract_end DATE,
    cancellation_deadline DATE,
    cancellation_period_days INTEGER,
    status TEXT NOT NULL DEFAULT 'needs_review' CHECK (status IN ('active', 'cancelled', 'expired', 'needs_review')),
    extracted_confidence NUMERIC(3,2)
  );

CREATE TABLE IF NOT EXISTS reminders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
    remind_at TIMESTAMPTZ NOT NULL,
    sent BOOLEAN NOT NULL DEFAULT false,
    snoozed_until TIMESTAMPTZ
  );

-- ===== Signaturen =====

-- [2026-09-21] "Abwesenheitsassistent"-Auftrag (WEB_INBOX.md 21.09.): diese
-- Tabelle existierte seit dem allerersten Durchstich im Contract, wurde
-- aber NIE vom echten Backend implementiert (nur als eigenstaendiges,
-- nie angebundenes `mail-actions`-Package) -- echte Luecke, hier
-- nachgezogen, siehe backend/README.md.
CREATE TABLE IF NOT EXISTS signatures (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mail_account_id UUID NOT NULL REFERENCES mail_accounts(id) ON DELETE CASCADE,
    content_html TEXT NOT NULL,
    is_default BOOLEAN NOT NULL DEFAULT false,
    apply_to_new BOOLEAN NOT NULL DEFAULT true,
    apply_to_replies BOOLEAN NOT NULL DEFAULT false
  );

-- ===== Abwesenheitsassistent =====
-- (WEB_INBOX.md 21.09. "NEUER AUFTRAG - Abwesenheitsassistent")

-- Genau eine Zeile pro User (analog user_ai_preference) -- kein Eintrag,
-- solange nie konfiguriert. start_date/subject/body sind NULL erlaubt auf
-- DB-Ebene ("Pflicht, solange active=true" wird serverseitig bei PUT
-- /absence-responder durchgesetzt, nicht per Constraint).
CREATE TABLE IF NOT EXISTS absence_responder (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    active BOOLEAN NOT NULL DEFAULT false,
    start_date DATE,
    end_date DATE,
    subject TEXT,
    body TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

-- Grundlage fuer "pro Absender maximal eine Antwort alle X Tage" (Default
-- 4, wie Gmail) -- verhindert Antwort-Schleifen bei wiederholten Mails
-- derselben Person waehrend der Abwesenheit.
CREATE TABLE IF NOT EXISTS absence_responder_log (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    sender_address TEXT NOT NULL,
    last_sent_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (user_id, sender_address)
  );

-- ===== KI: Zusammenfassungen & Provider-Konfiguration =====

-- [2026-09-21] KORREKTUR (TERMINAL_INBOX.md 21.09.): source akzeptiert jetzt
-- auch 'heuristic' (deterministische Mustererkennung ohne KI-Modell, siehe
-- ai-adapter-interface.ts AiSource-Kommentar) -- vorher fälschlich immer
-- als 'cloud_fallback' gelabelt, obwohl kein externer Anbieter aufgerufen
-- wurde. Tabelle war bis zu diesem Schritt von keinem Code beschrieben
-- ausser mit dem alten Enum, direkt am CREATE TABLE geändert (Repo-
-- Konvention), kein ALTER noetig.
CREATE TABLE IF NOT EXISTS message_ai_summary (
    message_id UUID PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
    summary_text TEXT,
    action_required BOOLEAN NOT NULL DEFAULT false,
    action_description TEXT,
    deadline DATE,
    source TEXT NOT NULL CHECK (source IN ('on_device', 'cloud_fallback', 'heuristic')),
    generated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

-- [2026-09-21] KORREKTUR: bewusst UNGENUTZT. War urspruenglich fuer einen
-- driftmail-finanzierten "kostenlosen" Cloud-Pfad ueber guenstige Anbieter
-- (Groq/Gemini/OpenRouter) gedacht -- genau das hat Massimo direkt an
-- Claude Code korrigiert (TERMINAL_INBOX.md 21.09.): KEIN von driftmail
-- bezahlter Cloud-API-Zugang, auch nicht ueber einen guenstigen Anbieter.
-- Tabelle bleibt im Schema stehen (falls spaeter doch mal ein Admin-
-- Quota-Konzept noetig wird), aber KEIN Code liest/schreibt sie aktuell --
-- siehe user_ai_preference unten fuer den tatsaechlich implementierten Weg
-- (Geraete-eigene KI primaer, BYOK optional auf User-Kosten).
CREATE TABLE IF NOT EXISTS ai_provider_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_type TEXT NOT NULL CHECK (task_type IN ('classification', 'extraction', 'summary', 'reply_draft')),
    primary_provider TEXT NOT NULL, -- 'on_device' | 'groq' | 'gemini' | 'openrouter'
    fallback_provider TEXT,
    daily_quota_used INTEGER NOT NULL DEFAULT 0,
    quota_reset_at TIMESTAMPTZ
  );

CREATE TABLE IF NOT EXISTS user_ai_capability (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    platform TEXT NOT NULL CHECK (platform IN ('ios', 'android', 'windows', 'web')),
    device_model TEXT,
    os_version TEXT,
    on_device_supported BOOLEAN NOT NULL DEFAULT false,
    active_mode TEXT NOT NULL CHECK (active_mode IN ('on_device', 'cloud_fallback')),
    checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, platform)
  );

-- [2026-09-21] KORREKTUR (TERMINAL_INBOX.md 21.09.): User-Wahl fuer Cloud-KI
-- ist jetzt ausschliesslich "aus" vs. "eigener Zugang" (BYOK) -- kein
-- driftmail-finanzierter "free"-Modus mehr (siehe ai_provider_config-
-- Kommentar oben, dessen ehemals geplante Kaskade damit entfaellt).
-- cloud_consent_given_at: Consent-Zeitstempel, NULL = kein Consent erteilt.
-- Routing-Logik (backend/src/ai/index.ts getAiAdapterForUser()) nutzt BYOK
-- NUR wenn mode='byok' UND encrypted_api_key gesetzt UND
-- cloud_consent_given_at NICHT NULL ist -- sonst heuristischer Fallback,
-- nie automatisch On-Device (das entscheidet der jeweilige Client selbst,
-- bevor er das Backend ueberhaupt fuer eine KI-Aktion anfragt). Tabelle war
-- bis zu diesem Schritt von keinem Code beschrieben, direkt am CREATE TABLE
-- geändert (Repo-Konvention), kein ALTER noetig.
CREATE TABLE IF NOT EXISTS user_ai_preference (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    mode TEXT NOT NULL DEFAULT 'off' CHECK (mode IN ('off', 'byok')),
    byok_provider TEXT CHECK (byok_provider IN ('anthropic', 'openai', 'google', 'other')),
    encrypted_api_key TEXT,
    cloud_consent_given_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

-- ===== Sicherheit: Anhang-Scan =====

-- [2026-09-10] WEB_INBOX.md "Erweiterung des Send-Endpunkt-Eintrags": message_id
-- ist jetzt nullable + neue Spalte uploaded_by_user_id, damit ein Anhang
-- gescannt werden kann, BEVOR die gesendete Mail als messages-Zeile existiert
-- (Upload-Reihenfolge bei POST /attachments, vor POST /messages/send). Bei
-- eingehenden Anhängen (empfangene Mail) bleibt message_id wie bisher gesetzt,
-- uploaded_by_user_id null. Direkt am CREATE TABLE geändert statt per ALTER
-- TABLE (Repo-Konvention, siehe z.B. messages.provider_message_id weiter
-- oben) -- die Tabelle wurde bisher von keinem Code beschrieben, es gibt
-- also keinen Bestand, der eine echte Migration bräuchte.
CREATE TABLE IF NOT EXISTS message_attachments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id UUID REFERENCES messages(id) ON DELETE CASCADE,
    uploaded_by_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    mime_type TEXT,
    size_bytes INTEGER,
    scan_status TEXT NOT NULL DEFAULT 'pending' CHECK (scan_status IN ('pending', 'clean', 'malicious', 'blocked_type', 'scan_failed')),
    is_dangerous_type BOOLEAN NOT NULL DEFAULT false,
    scanned_at TIMESTAMPTZ,
    -- [2026-09-15] WEB_INBOX.md 15.09. "Sensible-Daten-Erkennung um Fotos
    -- von Ausweisen/Kreditkarten erweitern": analog zu scan_status, per OCR
    -- + Text-Pattern-Erkennung ermittelt (siehe backend/src/attachments/).
    -- NICHT blockierend -- gleiches Prinzip wie containsSensitiveData bei
    -- Text-IBAN/Kreditkarte im Composer.
    contains_sensitive_document TEXT NOT NULL DEFAULT 'none' CHECK (contains_sensitive_document IN ('none', 'credit_card', 'id_document')),
    CONSTRAINT message_attachments_owner_check CHECK (message_id IS NOT NULL OR uploaded_by_user_id IS NOT NULL)
  );

-- ===== Sicherheit: Tracking-Schutz (Spionage-Pixel) =====

CREATE TABLE IF NOT EXISTS user_privacy_settings (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    block_remote_images BOOLEAN NOT NULL DEFAULT true,
    block_tracking_links BOOLEAN NOT NULL DEFAULT true,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

-- ===== Sicherheit: Darkweb-/Datenleck-Ueberwachung =====
-- [2026-09-21] "NEUE AUFTRAEGE - 5 Wettbewerbs-Luecken" Punkt 3. Warnt den
-- User, falls eine verbundene Mail-Adresse in einem bekannten oeffentlichen
-- Datenleck auftaucht. Gleiche Architektur-Entscheidung wie die vier
-- bestehenden externen Lookups (WHOIS/Spamhaus/IBAN-Historie/fraud_alerts):
-- Nachbearbeitungsschritt, nicht Teil von security-classification/ selbst.
-- Anbieter bewusst gemockt (siehe backend/README.md "Darkweb-/Datenleck-
-- Ueberwachung") -- ein echter Dienst (z.B. haveibeenpwned) verlangt einen
-- kostenpflichtigen API-Key, den driftmail nicht ungefragt finanzieren will
-- (gleiches Prinzip wie die KI-Anbindung), und ein BYOK-Modell passt hier
-- nicht (Datenleck-Pruefung ist ein geteilter Bedrohungsdaten-Dienst, kein
-- persoenlicher KI-Zugang).
CREATE TABLE IF NOT EXISTS data_breach_findings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mail_account_id UUID NOT NULL REFERENCES mail_accounts(id) ON DELETE CASCADE,
    breach_name TEXT NOT NULL,
    breach_date DATE,
    discovered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    acknowledged BOOLEAN NOT NULL DEFAULT false,
    UNIQUE (mail_account_id, breach_name)
  );

-- Letzter Pruefzeitpunkt pro Konto, damit der periodische Sync (siehe
-- mail/scheduler.ts) nicht bei JEDEM Tick erneut prueft -- Datenlecks
-- aendern sich nicht minuetlich, taeglich reicht (siehe dortigen Kommentar).
CREATE TABLE IF NOT EXISTS data_breach_check_log (
    mail_account_id UUID PRIMARY KEY REFERENCES mail_accounts(id) ON DELETE CASCADE,
    last_checked_at TIMESTAMPTZ NOT NULL
  );

-- ===== Sicherheit: Account-Schutz (driftmail selbst) =====

CREATE TABLE IF NOT EXISTS user_security_settings (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    mfa_enabled BOOLEAN NOT NULL DEFAULT false,
    encrypted_mfa_secret TEXT,
    mfa_method TEXT CHECK (mfa_method IN ('totp', 'sms', 'passkey')),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

CREATE TABLE IF NOT EXISTS user_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_name TEXT,
    platform TEXT,
    ip_address_hash TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_active_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at TIMESTAMPTZ
  );

-- ===== Sicherheit: Betrugswarnung =====

CREATE TABLE IF NOT EXISTS fraud_alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    alert_type TEXT NOT NULL CHECK (alert_type IN ('new_iban', 'ceo_fraud_pattern', 'urgent_payment_request')),
    user_acknowledged BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

-- ===== Datenaufbewahrung (DSGVO) =====

CREATE TABLE IF NOT EXISTS data_retention_policy (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    delete_spam_after_days INTEGER NOT NULL DEFAULT 30,
    delete_trash_after_days INTEGER NOT NULL DEFAULT 30,
    archive_after_days INTEGER,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

-- ===== Paketdienst-Erkennung =====

CREATE TABLE IF NOT EXISTS shipments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  carrier TEXT,
  tracking_number TEXT,
  status TEXT NOT NULL DEFAULT 'in_transit'
    CHECK (status IN ('in_transit', 'out_for_delivery', 'delivered', 'delayed', 'problem')),
  estimated_delivery DATE,
  extracted_confidence NUMERIC(3,2)
);

-- ===== Versand-Missbrauchserkennung (Bot/Human, Phishing-Versand) =====
-- Nachgeliefert von Web (WEB_INBOX.md 08.09.) nach Rueckfrage -- die
-- urspruengliche ALTER-TABLE-Migration fuer 'phishing_content' ist hier
-- schon direkt in den CHECK eingearbeitet, keine separate Migration noetig.

CREATE TABLE IF NOT EXISTS outgoing_send_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_address TEXT NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  time_since_draft_shown_ms INTEGER,
  was_new_recipient BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS send_abuse_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  flag_reason TEXT NOT NULL CHECK (flag_reason IN
    ('rate_burst', 'many_new_recipients', 'duplicate_content', 'no_read_before_reply', 'phishing_content')),
  triggered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- bei flag_reason = 'phishing_content' IMMER 'send_blocked', nie 'warned'/'rate_limited'.
  action_taken TEXT NOT NULL DEFAULT 'warned' CHECK (action_taken IN ('warned', 'rate_limited', 'send_blocked')),
  resolved BOOLEAN NOT NULL DEFAULT false
);

-- ===== IBAN-Historie je Absender (Grundlage fuer containsNewIban) =====
-- Kleinere Ergaenzung (Terminal 09.09., echte Persistenz statt In-Memory-Map,
-- siehe backend/README.md "Persistenz"): "neu" heisst noch nie zuvor von
-- diesem Absender an diesen User gesehen (SYNC.md 08.09., Web-Antwort).
-- Bewusst ohne eigene id/Historie-Zeitreihe -- nur "wurde diese IBAN von
-- diesem Absender an diesen User schon einmal gesehen" wird gebraucht.

CREATE TABLE IF NOT EXISTS iban_sightings (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sender_address TEXT NOT NULL,
  iban TEXT NOT NULL,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, sender_address, iban)
);

-- ===== Dedupe-Fingerprint fuer den Auto-Delete-Pfad (adult/gambling-Spam) =====
-- Kleinere Ergaenzung (Terminal 09.09.): diese Mails bekommen laut
-- WEB_INBOX.md 08.09. NIE eine messages-Zeile (siehe backend/src/mail/sync.ts),
-- muessen aber trotzdem als "schon gesehen" markierbar sein, damit ein
-- wiederholter Sync (z.B. Server-Neustart + erneutes POST /internal/sync)
-- dieselbe Mail nicht ein zweites Mal loescht/loggt. Enthaelt bewusst keinen
-- Inhalt, nur den Dedupe-Schluessel.

CREATE TABLE IF NOT EXISTS auto_deleted_message_headers (
  mail_account_id UUID NOT NULL REFERENCES mail_accounts(id) ON DELETE CASCADE,
  message_id_header TEXT NOT NULL,
  PRIMARY KEY (mail_account_id, message_id_header)
);

-- ===== Vertrauenswuerdige Absender (User-Whitelist) =====
-- WEB_INBOX.md 15.09. ("Whitelist fuer vertrauenswuerdige Absender"):
-- bewusste User-Entscheidung, KEINE automatische Klassifikation. Hat Vorrang
-- vor der automatischen Erkennung -- eine gelistete Adresse landet immer in
-- eingang, siehe backend/src/mail/sync.ts. Wirkt nur fuer kuenftige Mail ab
-- dem Zeitpunkt des Hinzufuegens, kein Ruecktausch bestehender Nachrichten.

CREATE TABLE IF NOT EXISTS trusted_senders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sender_address TEXT NOT NULL,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, sender_address)
);

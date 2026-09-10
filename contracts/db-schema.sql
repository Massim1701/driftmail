-- driftmail — DB-Schema (Track 0 Contract)
-- Alle Tracks arbeiten gegen dieses Schema. Änderungen nur über Track 0.

-- ===== Users & Accounts =====

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT UNIQUE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

CREATE TABLE IF NOT EXISTS mail_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider TEXT NOT NULL CHECK (provider IN ('gmail', 'imap')),
    email_address TEXT NOT NULL,
    encrypted_oauth_token TEXT,
    encrypted_imap_credentials TEXT,
    sync_status TEXT NOT NULL DEFAULT 'pending' CHECK (sync_status IN ('pending', 'syncing', 'ok', 'error')),
    last_synced_at TIMESTAMPTZ
  );

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

CREATE TABLE IF NOT EXISTS folders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    icon TEXT NOT NULL DEFAULT 'inbox',
    is_system BOOLEAN NOT NULL DEFAULT false,
    system_key TEXT CHECK (system_key IN ('eingang', 'entwuerfe', 'gesendet', 'sonstiges', 'quarantaene', 'spam', 'papierkorb')),
    sort_order INTEGER NOT NULL DEFAULT 0,
    UNIQUE (user_id, system_key)
  );

CREATE INDEX IF NOT EXISTS idx_folders_user ON folders (user_id);

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
    received_at TIMESTAMPTZ NOT NULL,
    folder_id UUID NOT NULL REFERENCES folders(id),
    raw_headers JSONB,
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
    subject TEXT,
    body_text TEXT,
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
    urgency_language_score NUMERIC(3,2),
    contains_new_iban BOOLEAN NOT NULL DEFAULT false,
    classification TEXT NOT NULL DEFAULT 'unclear' CHECK (classification IN ('safe', 'spam', 'phishing', 'unclear')),
    -- Nur gesetzt wenn classification = 'spam'. 'adult'/'gambling' loesen
    -- sofortiges Loeschen aus (kein Quarantaene-Pfad, kein 30-Tage-Aufheben,
    -- kein Undo) -- siehe WEB_INBOX.md 08.09. Betrifft NICHT 'phishing',
    -- das bleibt immer im Quarantaene-Pfad.
    spam_subcategory TEXT CHECK (spam_subcategory IN ('adult', 'gambling', 'generic', 'marketing')),
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

CREATE TABLE IF NOT EXISTS unsubscribe_actions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    method TEXT NOT NULL CHECK (method IN ('list_unsubscribe_header', 'manual')),
    list_unsubscribe_header_value TEXT,
    status TEXT NOT NULL DEFAULT 'pending_confirmation' CHECK (status IN ('pending_confirmation', 'confirmed', 'rejected')),
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

CREATE TABLE IF NOT EXISTS signatures (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mail_account_id UUID NOT NULL REFERENCES mail_accounts(id) ON DELETE CASCADE,
    content_html TEXT NOT NULL,
    is_default BOOLEAN NOT NULL DEFAULT false,
    apply_to_new BOOLEAN NOT NULL DEFAULT true,
    apply_to_replies BOOLEAN NOT NULL DEFAULT false
  );

-- ===== KI: Zusammenfassungen & Provider-Konfiguration =====

CREATE TABLE IF NOT EXISTS message_ai_summary (
    message_id UUID PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
    summary_text TEXT,
    action_required BOOLEAN NOT NULL DEFAULT false,
    action_description TEXT,
    deadline DATE,
    source TEXT NOT NULL CHECK (source IN ('on_device', 'cloud_fallback')),
    generated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

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

-- User-Wahl: kostenloser Standard-Pfad vs. eigener (bezahlter) KI-Zugang.
-- Wird beim Onboarding und in den Einstellungen gesetzt. Routing-Logik
-- prueft dies VOR der ai_provider_config-Kaskade: bei 'byok' geht der
-- Call an den eigenen Schluessel des Users statt On-Device/Free-Tier.
CREATE TABLE IF NOT EXISTS user_ai_preference (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    mode TEXT NOT NULL DEFAULT 'free' CHECK (mode IN ('free', 'byok')),
    byok_provider TEXT CHECK (byok_provider IN ('anthropic', 'openai', 'google', 'other')),
    encrypted_api_key TEXT,
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
    CONSTRAINT message_attachments_owner_check CHECK (message_id IS NOT NULL OR uploaded_by_user_id IS NOT NULL)
  );

-- ===== Sicherheit: Tracking-Schutz (Spionage-Pixel) =====

CREATE TABLE IF NOT EXISTS user_privacy_settings (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    block_remote_images BOOLEAN NOT NULL DEFAULT true,
    block_tracking_links BOOLEAN NOT NULL DEFAULT true,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
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

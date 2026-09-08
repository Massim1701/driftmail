-- driftmail — DB-Schema (Track 0 Contract)
-- Alle Tracks arbeiten gegen dieses Schema. Änderungen nur über Track 0.

-- ===== Users & Accounts =====

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT UNIQUE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

CREATE TABLE mail_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider TEXT NOT NULL CHECK (provider IN ('gmail', 'imap')),
    email_address TEXT NOT NULL,
    encrypted_oauth_token TEXT,
    encrypted_imap_credentials TEXT,
    sync_status TEXT NOT NULL DEFAULT 'pending' CHECK (sync_status IN ('pending', 'syncing', 'ok', 'error')),
    last_synced_at TIMESTAMPTZ
  );

-- ===== Messages =====

CREATE TABLE messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mail_account_id UUID NOT NULL REFERENCES mail_accounts(id) ON DELETE CASCADE,
    message_id_header TEXT NOT NULL,
    from_address TEXT NOT NULL,
    from_display_name TEXT,
    reply_to_address TEXT,
    subject TEXT,
    body_text TEXT,
    received_at TIMESTAMPTZ NOT NULL,
    folder TEXT NOT NULL DEFAULT 'sonstiges' CHECK (folder IN ('wichtig', 'sonstiges', 'rechnungen', 'quarantaene', 'spam')),
    raw_headers JSONB,
    UNIQUE (mail_account_id, message_id_header)
  );

CREATE INDEX idx_messages_account_folder ON messages (mail_account_id, folder);

-- ===== Security-Analyse (1:1 zu messages) =====

CREATE TABLE message_security (
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
    confidence_score NUMERIC(3,2),
    analyzed_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

CREATE TABLE message_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    display_text TEXT,
    actual_url TEXT NOT NULL,
    domain_matches_display BOOLEAN NOT NULL DEFAULT true,
    is_known_malicious BOOLEAN NOT NULL DEFAULT false
  );

-- ===== Unsubscribe (nur RFC 8058, nie Body-Link) =====

CREATE TABLE unsubscribe_actions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    method TEXT NOT NULL CHECK (method IN ('list_unsubscribe_header', 'manual')),
    list_unsubscribe_header_value TEXT,
    status TEXT NOT NULL DEFAULT 'pending_confirmation' CHECK (status IN ('pending_confirmation', 'confirmed', 'rejected')),
    user_confirmed_at TIMESTAMPTZ
  );

-- ===== Quarantäne =====

CREATE TABLE quarantine (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    quarantined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    reason TEXT NOT NULL,
    auto_delete_at TIMESTAMPTZ NOT NULL,
    user_reviewed BOOLEAN NOT NULL DEFAULT false
  );

-- ===== Audit-Log =====

CREATE TABLE security_audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
    action TEXT NOT NULL, -- 'auto_quarantined' | 'user_unsubscribed' | 'user_overrode_warning' | ...
    timestamp TIMESTAMPTZ NOT NULL DEFAULT now()
  );

-- ===== Verträge & Reminder =====

CREATE TABLE contracts (
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

CREATE TABLE reminders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
    remind_at TIMESTAMPTZ NOT NULL,
    sent BOOLEAN NOT NULL DEFAULT false,
    snoozed_until TIMESTAMPTZ
  );

-- ===== Signaturen =====

CREATE TABLE signatures (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mail_account_id UUID NOT NULL REFERENCES mail_accounts(id) ON DELETE CASCADE,
    content_html TEXT NOT NULL,
    is_default BOOLEAN NOT NULL DEFAULT false,
    apply_to_new BOOLEAN NOT NULL DEFAULT true,
    apply_to_replies BOOLEAN NOT NULL DEFAULT false
  );

-- ===== KI: Zusammenfassungen & Provider-Konfiguration =====

CREATE TABLE message_ai_summary (
    message_id UUID PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
    summary_text TEXT,
    action_required BOOLEAN NOT NULL DEFAULT false,
    action_description TEXT,
    deadline DATE,
    source TEXT NOT NULL CHECK (source IN ('on_device', 'cloud_fallback')),
    generated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

CREATE TABLE ai_provider_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_type TEXT NOT NULL CHECK (task_type IN ('classification', 'extraction', 'summary', 'reply_draft')),
    primary_provider TEXT NOT NULL, -- 'on_device' | 'groq' | 'gemini' | 'openrouter'
    fallback_provider TEXT,
    daily_quota_used INTEGER NOT NULL DEFAULT 0,
    quota_reset_at TIMESTAMPTZ
  );

CREATE TABLE user_ai_capability (
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
CREATE TABLE user_ai_preference (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    mode TEXT NOT NULL DEFAULT 'free' CHECK (mode IN ('free', 'byok')),
    byok_provider TEXT CHECK (byok_provider IN ('anthropic', 'openai', 'google', 'other')),
    encrypted_api_key TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

-- ===== Sicherheit: Anhang-Scan =====

CREATE TABLE message_attachments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    mime_type TEXT,
    size_bytes INTEGER,
    scan_status TEXT NOT NULL DEFAULT 'pending' CHECK (scan_status IN ('pending', 'clean', 'malicious', 'blocked_type', 'scan_failed')),
    is_dangerous_type BOOLEAN NOT NULL DEFAULT false,
    scanned_at TIMESTAMPTZ
  );

-- ===== Sicherheit: Tracking-Schutz (Spionage-Pixel) =====

CREATE TABLE user_privacy_settings (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    block_remote_images BOOLEAN NOT NULL DEFAULT true,
    block_tracking_links BOOLEAN NOT NULL DEFAULT true,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

-- ===== Sicherheit: Account-Schutz (driftmail selbst) =====

CREATE TABLE user_security_settings (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    mfa_enabled BOOLEAN NOT NULL DEFAULT false,
    encrypted_mfa_secret TEXT,
    mfa_method TEXT CHECK (mfa_method IN ('totp', 'sms', 'passkey')),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

CREATE TABLE user_sessions (
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

CREATE TABLE fraud_alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    alert_type TEXT NOT NULL CHECK (alert_type IN ('new_iban', 'ceo_fraud_pattern', 'urgent_payment_request')),
    user_acknowledged BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

-- ===== Datenaufbewahrung (DSGVO) =====

CREATE TABLE data_retention_policy (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    delete_spam_after_days INTEGER NOT NULL DEFAULT 30,
    delete_trash_after_days INTEGER NOT NULL DEFAULT 30,
    archive_after_days INTEGER,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

-- ===== Paketdienst-Erkennung =====

CREATE TABLE shipments (
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

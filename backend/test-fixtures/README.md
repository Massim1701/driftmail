# Test-Fixtures

Echte PNG-Bilder für den Backend-Smoketest der Sensible-Dokument-Erkennung
(siehe `backend/README.md` "Sensible-Dokument-Erkennung"). Per
Chrome-Rendering aus einfachem HTML/CSS erzeugt (kein echtes Foto, keine
echten personenbezogenen Daten — Namen/Nummern sind frei erfunden bzw.
gängige, öffentlich bekannte Testwerte).

- `credit-card-photo.png` — simulierte Kartenansicht mit einer
  Luhn-gültigen Testnummer (`4539 1488 0343 6467`).
- `id-document-photo.png` — simulierter Reisepass mit einem TD3-MRZ-Block
  (zwei Zeilen, nicht prüfzifferngültig, siehe `mrzDetection.ts`).
- `innocuous-photo.png` — unauffälliges Foto ohne jedes Muster, für den
  Negativ-Fall (`containsSensitiveDocument: 'none'`).
- `qr-code-phishing.png` / `qr-code-clean.png` — echte QR-Codes für den
  "Quishing"-Schutz (siehe `backend/README.md` "Quishing-Schutz"), generiert
  per `qrcode`-Devdependency (`npx tsx -e "..."`, kein Foto). Der
  Phishing-Code kodiert `http://аpple.com/verify` (kyrillisches "а" statt
  "a", derselbe Homoglyph-Trick wie bei Fixture 6 im Mail-Text), der clean-Code
  `https://driftware.online/`.

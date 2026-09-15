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

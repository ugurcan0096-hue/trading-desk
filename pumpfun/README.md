# Pump.fun + Claude: Trading Desk sistemi

Rehberdeki sistemin tamamı: **7 prompt, 4 tablo, 1 sistem.** Claude analiz eder, tıklayan sensin.
Bu klasördeki hiçbir şey cüzdana dokunmaz, işlem imzalamaz, alım satım yapmaz.

> Seed phrase'ini veya private key'ini hiçbir yapay zekaya, hiçbir dosyaya yapıştırma. Bir kez bile.

## 4 katman

| Katman | Ne | Burada |
|---|---|---|
| 1. Terminal | Axiom / pump.fun, tıkladığın yer | — |
| 2. Beyin | Kuralların yüklü Claude Project | `claude-project/` |
| 3. Filtre | Her yeni token'ı okuyan, sadece geçenleri haber veren tarayıcı | `scanner/` |
| 4. Hafıza | Her işlemin yazıldığı günlük + pazar analizi | `journal/` |

## Kurulum sırası

1. **Claude Project:** claude.ai'de `TRADING DESK` adında bir Project aç.
   `claude-project/1-custom-instructions.md` içindeki bloğu custom instructions alanına yapıştır.
2. **Dosyaları yükle:** `claude-project/2-rules.md` dosyasını PDF'e çevir,
   `journal/trades.csv` (son 50 işlemin) ve `scanner/known_wallets.csv` (rugger/sniper cüzdanlar) ile birlikte yükle.
3. **Prompt paketi:** `claude-project/3-prompt-pack.md` dosyasını not olarak kaydet. Her tıklamadan önce AUTOPSY,
   her sabah NARRATIVE, her kayıptan sonra TILT, her pazar REVIEW.
4. **Tarayıcı** (isteğe bağlı, Python 3.10+, ek paket gerekmez):

   ```bash
   cd pumpfun/scanner
   cp .env.example .env        # HELIUS_API_KEY, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
   python -m unittest          # filtre testleri
   python scan.py --dry-run    # Telegram'a göndermeden dene
   python scan.py              # çalıştır
   ```

5. **Günlük:** Her işlemi `journal/trades.csv` dosyasına yaz. Pazar günü:

   ```bash
   python journal/review.py journal/trades.csv --since 2026-11-16
   ```

   Çıktıyı ve CSV'yi Project'e yükleyip REVIEW prompt'unu gönder.

## Tarayıcı ne yapar

Her 15 saniyede pump.fun'daki yeni token'ları çeker ve her biri için:

| Kontrol | Varsayılan | Nereden |
|---|---|---|
| Bonding curve ilerlemesi | %15–80 | pump.fun rezervleri |
| Yaş | ≤ 6 saat | pump.fun |
| Top 10 holder (curve hariç) | < %25 | Helius RPC `getTokenLargestAccounts` |
| Dev payı | < %5 | Helius RPC |
| Block 0'da alan cüzdan (dev hariç) | ≤ 3 | Curve'ün ilk slot işlemleri |
| Bilinen kötü cüzdan | yok | `known_wallets.csv` |

- Önce ucuz kontroller yapılır (curve, yaş). RPC kredisi sadece bunları geçenlere harcanır.
- Curve'ü henüz %15'in altında olan token'lar 30 dakika boyunca izlemede kalır ve tekrar kontrol edilir.
- Veri alınamazsa token **geçmez**. Bilinmeyen güvenli değildir.
- Her karar nedeniyle birlikte `tokens.csv` dosyasına yazılır (PASS / FAIL / PASS_QUIET).
- `QUIET_START_HOUR=1`, `QUIET_END_HOUR=8`: gece 1'den sabah 8'e kadar bildirim gönderilmez ("1'den sonra işlem yok").
- Tüm eşikler `.env` dosyasından değiştirilebilir.

Notlar:
- pump.fun'ın `frontend-api-v3` adresi resmi olmayan, herkese açık bir API'dir ve değişebilir. Değişirse `.env` içindeki `PUMPFUN_API` satırını güncelle.
- "Dev ilk 10 dakikada sattı mı" kontrolü tarayıcıda yok; bunu AUTOPSY prompt'u yapıyor. Tarayıcı sadece dev'in şu anki payına bakıyor.
- RPC istemcisi kod düzeyinde sadece `get*` metodlarına izin verir; işlem göndermesi mümkün değildir.

---
_Yatırım tavsiyesi değildir. Memecoin'ler bir dakikada sıfıra gidebilir, çoğu da gider._

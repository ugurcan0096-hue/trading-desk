# Prompt pack

Save this as a note. Fill the `[ ]` brackets.

## Quick block

```
AUTOPSY:   Read this token. Run my full rule check. Verdict only.
CURVE:     Map every wallet >2%. Model the graduation dump. Show math.
NARRATIVE: 5 narratives from the last 12 h. Rank by early + strong.
EXIT:      I'm up [X]%. Holders are [data]. Argue FOR selling now.
TILT:      I just lost [X] SOL. Should I trade in the next hour? Use my journal.
REVIEW:    Weekly CSV. Worst rule, cost in SOL, 1 rule add, 1 rule cut.
SCANNER:   Read-only pump.fun filter, Helius RPC, Telegram alerts, CSV log.
```

---

## 1. AUTOPSY: the 60-second token check (before every click)

With Claude in Chrome, open the token page and send:

```
Read this token page. Pull: market cap, bonding curve progress %,
holder count, top 10 holder %, dev wallet %, dev sell history,
bundled buys in first block, 5m and 1h volume, buy/sell ratio,
socials (X, TG, site) and their age.
Then run my full rule check from the Project instructions.
```

No browser extension? Send the contract address plus a screenshot of the holder tab:

```
CA: [contract address]
Screenshot: holder tab attached.
Run my full rule check from the Project instructions.
```

## 2. CURVE: the graduation zone

```
This token is at [X]% of the bonding curve.
List every wallet holding more than 2%. For each one: first buy time,
average entry, did it sell any yet, is it in my known-ruggers file.
Then tell me: if the top 5 sell at graduation, what % drop is realistic
based on current liquidity? Show the math.
```

## 3. NARRATIVE: every morning

```
Scan X and news for the last 12 hours. Find 5 narratives that could
spawn memecoins today: viral animals, AI launches, celebrity moments,
political events, meme formats.
For each one give: the core meme, likely ticker names (3-5),
how early it is (1-10), and what would kill it.
Rank by "early + strong."
```

Then set alerts on those tickers in your terminal. A matching launch goes straight to AUTOPSY.

## 4. EXIT: when you're in profit and don't want to sell

```
I'm up [X]% on [TOKEN]. Curve: [X]%. Top holders: [data].
Argue FOR selling now. Then check my exit rules (50% at 2x, stop -35%)
and tell me which one applies right now.
```

## 5. TILT: the one that saves accounts

```
I just lost [X] SOL on [TOKEN]. It's [time].
Should I trade in the next hour? Use my journal: what happened
the last times I traded within an hour of a loss? Numbers only.
```

## 6. REVIEW: every Sunday

First run `python journal/review.py journal/trades.csv --since [last Monday]`, then upload the CSV
and paste the output:

```
Here are my trades from this week.
1. Win rate and average R by: time of day, curve phase, narrative age.
2. Which rule did I break most, and what did it cost me in SOL?
3. My 3 worst trades: what did they have in common?
4. One rule to add. One rule to delete. Explain with numbers.
Be blunt. No encouragement.
```

## 7. SCANNER: already built

Lives in `scanner/`. See the README there. The original prompt it was built from:

```
Build a Python script that:
1. Polls new pump.fun tokens every 15 seconds via a public data API.
2. For each token, pulls holder distribution using Helius RPC
   (key from .env, never hardcoded).
3. Filters: top 10 < 25%, dev < 5%, no more than 3 block-0 buyers,
   curve progress 15-80%.
4. Sends passing tokens to my Telegram bot with: CA, mcap,
   curve %, top10 %, and a link to the token page.
5. Logs every token (passed or failed, with reason) to tokens.csv.
Read-only. No wallet, no signing, no trades.
Write tests for the filter logic first.
```

---
_Not financial advice. Memecoins can go to 0 in a minute, and most do._

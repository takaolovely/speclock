# SpecLock

**Invoices that unlock on proof, not on mood.**

Freelancers wait on a client's approval button — and a client who ghosts keeps the money stuck. Here the money unlocks when an independent agent attests the checklist both sides agreed to.

Each invoice is a **keyless NEAR sub-account**: an agent attests a deterministic checklist, splits the payout, and the account self-destructs to refund storage.

| | |
|---|---|
| Live app | https://speclock-nine.vercel.app |
| Network | NEAR testnet |
| Factory | [`speclock.testnet`](https://testnet.nearblocks.io/account/speclock.testnet) |
| Verifier | `verifier.speclock.testnet` — outbound only, no inbound port |
| Tracks | realworld, agents |

---

## The flow, in five steps

![SpecLock architecture](docs/architecture.png)

A `fail` verdict moves nothing. The invoice stays `Funded`, the money stays locked, and the freelancer can fix the delivery and ask for another check. After `deadline_ms` the client can `refund()` instead and the account deletes itself, sweeping everything back.

---

## Two things worth attacking

Most hackathon repos ask to be believed. These two are built so a reviewer with `curl` and `sha256sum` can check them instead.

### 1. The report hash is reproducible, because it excludes time

A browser report contains timings, and timings change on every run. Hash the whole report and the same page never produces the same hash twice — "re-run it and compare" becomes a claim nobody can honour.

So the hash covers only what must be identical:

```json
{
  "checklist_hash": "6d7c30e5da435503…b0d859d912",
  "invoice_id": "inv-0062",
  "overall": "pass",
  "rules": [
    { "i": 0, "p": true, "t": "http_status"      },
    { "i": 1, "p": true, "t": "console_errors"   },
    { "i": 2, "p": true, "t": "dom_selector"     },
    { "i": 3, "p": true, "t": "response_time_ms" }
  ],
  "target_url": "https://speclock-nine.vercel.app/demo-target",
  "v": 1
}
```

Timestamps, durations, console sampling and the screenshot path stay in `report.json` where a human can read them. They never enter the hash.

Measured on `inv-0062`, two runs of the same page 48 seconds apart:

```
run 1   1fadbb01adb687cb…d7e8e6bae7a814   duration_ms 2046   pass
run 2   1fadbb01adb687cb…d7e8e6bae7a814   duration_ms 2096   pass
```

The same invoice failed two runs earlier, 16 seconds apart, and the fail claim was equally stable:

```
run 1   e3c7dae91cbe319c…559c8f7f0484928   duration_ms 2111   fail (dom_selector: missing)
run 2   e3c7dae91cbe319c…559c8f7f0484928   duration_ms 2074   fail (dom_selector: missing)
```

Same claim, different clock. The contract holds the pass hash, written at attest time:

```
speclock.testnet.get_receipt("inv-0062") → 1fadbb01adb687cb…d7e8e6bae7a814 | pass
speclock.testnet.get_summary("inv-0062")
  → {"r":[{"t":"http_status","p":true},{"t":"console_errors","p":true},
          {"t":"dom_selector","p":true},{"t":"response_time_ms","p":true}]}
```

A third party re-running the check today lands on the identical 32 bytes. Canonicalisation is one function (`agents/verifier/lib/report.js`) that sorts keys and drops whitespace, used by the agent and by the contract's `checklist_hash`, so there is no second opinion to disagree with.

The proof is checkable without trusting the agent at all:

```bash
# evidence for the attested invoice
cat evidence/inv-0062/claim.json
sha256sum evidence/inv-0062/claim.json
# 1fadbb01adb687cb8efc60d14e719b077b25eff62b1b2d8d42d7e8e6bae7a814

# the same value, as recorded by the contract:
# speclock.testnet.get_receipt("inv-0062") → 1fadbb01adb687cb…d7e8e6bae7a814 | pass
```

`claim.json` is written without a trailing newline for exactly this reason: `sha256sum` on the file equals the on-chain hash, no preprocessing step.

### 2. The verifier cannot be aimed at the VPS

`target_url` is written by strangers, and the verifier is a headless Chromium with a wallet behind it. Without a gate that is an SSRF primitive pointed at the host's own network and at cloud metadata.

The gate runs before a browser is opened (`agents/verifier/lib/security.js`), and it re-resolves DNS because a public name that resolves inward is the same attack wearing a hat.

Actual output, all 9 cases:

```
BLOCK http://staging.example.com/                 → protocol http: not allowed
BLOCK https://localhost/x                         → internal hostnames are not allowed
BLOCK https://127.0.0.1/x                         → IP literals are not allowed
BLOCK https://169.254.169.254/latest/meta-data/   → IP literals are not allowed
BLOCK https://10.0.0.5/x                          → IP literals are not allowed
BLOCK https://evil.example.com/x                  → host evil.example.com is not on the allowlist
BLOCK https://user:pass@staging.example.com/      → credentials in URL are not allowed
BLOCK https://staging.example.com:8443/x          → port 8443 not allowed
ALLOW https://speclock-nine.vercel.app/           → ok
```

`127.0.0.1`, `10.0.0.5` and `169.254.169.254` are not this deployment's addresses. They are the reserved ranges every SSRF payload tries first: loopback, private RFC1918, and the cloud metadata endpoint. They are in the list because a gate that has never been shown rejecting them is a gate nobody can trust.

Run it yourself:

```bash
cd agents/verifier && node -e 'require("./lib/security").vetUrl(process.argv[1]).then(console.log)' https://169.254.169.254/
```

Beyond the gate, the worker holds no listening socket at all. It polls the factory every 12 seconds, opens one browser when there is work, and closes it. Nothing on the internet can make it fetch a URL of their choosing outside the allowlist, and nothing can reach it.

---

## Contracts

`contracts/invoice` — one ephemeral invoice account, deployed by the factory into `inv-xxxx.speclock.testnet`.

- **Keyless by construction.** The mint is `CreateAccount → Transfer → DeployContract → FunctionCall(new)`. There is no `AddKey` action anywhere, so no human — freelancer or client — can move the escrow. Only the deployed code can, and only on an attested pass. Check it on the mint transaction of `inv-0062`: four actions, no `AddKey`, and the account never had a key to begin with.
- **Split from the invoice, not the balance.** `split = invoice_amount * split_bps / 10_000`. Using `env::account_balance()` would tax the 2.1 NEAR storage stake too.
- **No half-paid invoices.** `attest(pass)` flips `Funded → Settling` *before* any promise leaves, so a second attestation landing mid-flight is rejected. The callback `on_settle` reads both `PromiseResult`s and, if the split **or** the receipt failed, returns the invoice to `Funded` instead of deleting it. A deleted invoice cannot be retried; a `Funded` one can.
- **Refund is a real path, not a fallback.** After `deadline_ms`, the client can `refund()` and the account deletes itself, sweeping everything back. Tested on `inv-0045`: client `2.4 → 2.3907` (the 0.0093 NEAR difference is gas).
- **`request_inspection()` is the meeting point.** The browser cannot call the worker and the worker cannot call the browser. One tiny on-chain transaction is enough for the worker to notice, which is why the VPS needs zero inbound ports.

`contracts/factory` — mints invoices and keeps what must outlive them.

- **Receipts are permanent.** The invoice deletes itself on success, so proof cannot live there. `record_receipt` is called by the invoice account before `delete_account`, and only accounts ending in `.speclock.testnet` may write, so a receipt cannot be forged for an invoice that was never verified.
- **Per-rule summaries survive the account.** `summaries: LookupMap<invoice_id, rules_json>` is written at the same time, which is what lets the web app show *why* a settled invoice passed when the account itself no longer exists.
- **`list_invoices()` is deduped.** A mint that fails after the id was pushed leaves a phantom entry; the view collapses duplicates so the UI cannot render the same invoice twice.
- **State migrated twice, not rebuilt.** v1 → v2 (invoice list) → v3 (per-rule summaries). `migrate()` reads the stored bytes in their *previous* Borsh shape and writes them back in the new one, because Borsh has no field defaults — the alternative is a bricked contract.

Build sizes: invoice `162,888 B`, factory `336,842 B` (the invoice wasm is embedded in the factory via `include_bytes!`).

---

## Verifier agent

`agents/verifier` — a CLI, not a service with an API.

```
node index.js --invoice inv-0062          # one invoice, dry run, no chain write
node index.js --invoice inv-0062 --attest # one invoice, publish the verdict
node index.js --poll --interval 12        # the deployed mode
```

- **No LLM, no paid API.** Every rule is measured in the browser: status code, `console.error` count, locator visibility, navigation time. Nothing is inferred, nothing is summarised by a model, nothing costs money per check.
- **The checklist is read from chain and hash-checked.** The worker loads `checklist()` from the invoice account and refuses to run if `sha256(canonical(checklist)) != checklist_hash` committed at deposit. A swapped checklist cannot pass.
- **One browser, hard ceiling.** A lock file and a 15 second inspection ceiling keep the worker from becoming a CPU problem on a small VPS. Real runs measured 1.9–3.9 s.
- **Only the demo freelancer's invoices.** Anything else is refused before the browser opens.

Evidence per invoice lands in `evidence/<invoice_id>/`: `checklist.json`, `report.json`, `claim.json`, `report.hash`, `screenshot.png`.

---

## Web app

Next.js + Tailwind on Vercel, one page. Two traps this had to handle, both of which are real:

**The UI cannot read files off the VPS.** It has no port to talk to, and serverless has no disk of ours. That is why the per-rule result is written **on chain** at attest time (`rules_summary` → factory `summaries`) and read back by `/api/invoices`. The browser renders PASS/FAIL per rule for an account that has already been deleted.

**A settled invoice no longer exists.** `view_account` on `inv-…` returns `UNKNOWN_ACCOUNT`, which is the success case, not an error. `/api/invoices` catches it and falls back to the factory receipt:

```
inv-0062      SETTLED · SELF-DESTRUCTED   0.50 NEAR
              Account deleted after payout — 100% of the storage stake returned to the freelancer.
              PASS http_status · PASS console_errors · PASS dom_selector · PASS response_time_ms
```

**A red banner for a successful payout would be a worse bug than a missing row.**

**Free RPC endpoints rate-limit, and a polling page is exactly the traffic shape that trips them.** This was found the honest way: the deployed page rendered `{"jsonrpc":"2.0","error":{"code":-429,…}}` where invoices should be. Three fixes, all visible in `lib/near.ts` and `app/api/invoices/route.ts`:

- reads fail over across endpoints, and a `-429` returned *inside* an HTTP 200 body is classified as "this node is busy", not as "the chain says no" — otherwise failover never fires;
- a 12 second server-side snapshot means ten open tabs cost one read, not ten;
- if every endpoint refuses, the API serves the last confirmed snapshot with a `warning` flag instead of an error screen. A snapshot that is twelve seconds old is still true; a red box is not.

A transient failure is also explicitly *not* treated as evidence that an account is gone — that would make a live invoice vanish from the page during a bad minute.

**On the demo client key.** The UI mints with a testnet key held server-side so a judge does not have to install a wallet to try the product. It is testnet-only and holds pocket money. A real deployment would ask the client to sign with their own wallet; nothing in the contract changes if they do.

---

## The demo target

`/demo-target` is the delivery under inspection: a small checkout page for a fictional client. It exists so the verdict in the video is not a screenshot of a file somebody edited off camera.

```
/demo-target                         broken: no #checkout-button in the DOM
/demo-target?state=fixed             fixed: the button is there
/api/demo-target/toggle  POST        the staging switch ({"mode":"fixed"})
```

Two details that were not obvious until they broke the recording:

- **A blob read is not the write.** The staging switch writes to shared storage, and the public read can answer with the previous value for a few seconds. The page therefore renders the mode the write just confirmed, and a sync badge polls the store until it agrees — because the verifier reads the plain URL, and an inspection that starts inside that window would judge the wrong version.
- **`router.refresh()` was not enough.** The client router handed back a cached payload, so the "fix" looked like it did nothing. The switch does a hard navigation with a cache-buster instead.

The switch is on the page because it is the freelancer's own preview: "what did I just deploy" is a fair question to ask of a staging URL, and the verifier genuinely does not know which state is live — it looks for the element the client asked for and reports what it found.

---

## Reproduce it

```bash
# contracts (Rust target wasm32-unknown-unknown + near-sdk 5)
cd contracts/invoice && cargo build --target wasm32-unknown-unknown --release
cd ../factory && touch src/lib.rs && cargo build --target wasm32-unknown-unknown --release
# the `touch` is not superstition: cargo does not notice that the embedded
# invoice wasm changed, and will silently ship the previous one

# verifier
cd agents/verifier && npm i && npx playwright install chromium
node index.js --invoice <id> --attest

# web
cd web && npm i && npm run dev
# env: CLIENT_ID, CLIENT_PRIVATE_KEY, FACTORY_ID, NEAR_RPC, FREELANCER_ID,
#      VERIFIER_ID, SPLIT_ID
```

RPC note: `rpc.testnet.near.org` returns HTTP 429 under any real load. Everything here uses `https://test.rpc.fastnear.com`.

---

## On-chain evidence

| what | transaction |
|---|---|
| mint `inv-0062` (0.5 NEAR escrow, keyless) | [`615p1eBn…QPWS`](https://testnet.nearblocks.io/txns/615p1eBnSDSV6GuXNcKeJAPz6nwjAo8N8mAtGh8pQPWS) |
| fail attest — money does not move | [`2UMr3eyy…q5NC`](https://testnet.nearblocks.io/txns/2UMr3eyyH7fhaB8s6pMhc4UUmtjSKwhykW8Y4n3Aq5NC) — status stays `Funded` |
| pass attest + split + receipt + self-destruct | [`34PatvWw…MZn8`](https://testnet.nearblocks.io/txns/34PatvWwqzELFr7MUkGbgCcbV5FQQFJ6c778EWF5MZn8) |
| refund path | `inv-0045` — `REFUNDED`, account deleted, client made whole |

Attested case, end to end: `attest` → `RECEIPT_RECORDED` → `SETTLED|…|pass|amount=499999999999999991611392|split=49999999999999999161139` → account deleted, 90% + full storage stake swept to the freelancer, 10% to the split wallet.

---

## Known limitations

Written down because a reviewer will find them anyway, and a repo that hides them is harder to trust than one that does not.

1. **A failed mint leaves the deposit in the factory.** The invoice id is pushed to `invoice_ids` before the promise chain resolves; if `create_account` fails, the deposit sits on the factory account with a phantom id. Deduped out of the UI, but the money needs a refund callback. Next change.
2. **2.1 NEAR of storage is fronted per invoice.** The de facto cost of a keyless account is a storage stake, refunded on delete. Fine for a demo, wrong for production: real invoices should use a shared escrow account, with the ephemeral account reserved for the headline case.
3. **One verifier is a trust anchor.** The checklist is deterministic and the evidence is reproducible, so a bad attestation is *detectable* — but only after the fact. Production needs N verifiers with a bond and a disagreement path.
4. **`wasm-opt -Oz` breaks the contract.** It compiles clean and then the NEAR runtime rejects it with `PrepareError: Deserialization`. Builds use plain `cargo build --release`; the artifact is 162 KB, and gas was never the constraint (deploy measured 9.13 TGas of a 300 TGas budget).
5. **The checklist covers delivery, not satisfaction.** The contract attests that the technical criteria both sides agreed to were met. It does not attest that the client is happy, and it is not meant to.
6. **Demo staging is staged, on-chain is not.** For the video, a staging URL is deliberately broken and then fixed. Every state transition in that recording is a real testnet transaction.

---

## Layout

```
contracts/invoice/    ephemeral invoice account: Funded → Settling → Settled/Refunded
contracts/factory/    mint (keyless), record_receipt, list_invoices, summaries, migrate
agents/verifier/      outbound-only Playwright agent: gate, inspect, canonical claim, attest
web/                  Next.js: / landing, /app dashboard, /demo-target the delivery under test
evidence/             claim.json + report.json + screenshot for the attested demo run
docs/                 the architecture diagram (html source + rendered png)
scripts/              e2e pass/fail/refund walkthroughs against testnet
```

The landing page reads its counters from the factory at request time, so the
numbers on `/` are the same ones the explorer shows. One click, one route: the
dashboard lives at `/app` and every CTA on the landing page points there.

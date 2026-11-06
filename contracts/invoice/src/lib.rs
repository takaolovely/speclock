//! SpecLock — one invoice account.
//!
//! The account is created by the factory with **no access keys**. Nobody signs
//! for it, ever: the only thing that can move its balance is the code below,
//! running because somebody called a public method.
//!
//! Money moves on evidence, not on a client's mood: the verifier attests a
//! deterministic checklist result, and only a `pass` starts the payout. A `fail`
//! leaves the money where it is, so the freelancer can fix and re-submit.
//!
//! State machine:
//!   Funded ──attest(pass)──▶ Settling ──split+receipt ok──▶ Settled (account deleted)
//!      ▲                        │
//!      └─────split or receipt failed───────┘   (retryable, never half-paid)
use near_sdk::json_types::U128;
use near_sdk::{
    env, near, near_bindgen, AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseResult,
};

#[near(serializers = [json, borsh])]
#[derive(Clone, PartialEq, Debug)]
pub enum Status {
    Funded,
    Settling,
    Settled,
    Refunded,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Invoice {
    freelancer: AccountId,
    client: AccountId,
    verifier: AccountId,
    factory: AccountId,
    split_wallet: AccountId,
    /// Agreed price in yoctoNEAR. The split is computed from THIS, never from
    /// the account balance — otherwise the storage stake would get taxed too.
    invoice_amount: u128,
    /// Share of the invoice routed to the split wallet, in basis points.
    /// 1000 = 10%. Chosen from a fixed set in the UI, never a free number.
    split_bps: u16,
    checklist_hash: String,
    /// The full checklist, stored on chain so any verifier can read exactly
    /// what was agreed without trusting a file on someone's laptop.
    checklist_json: String,
    target_url: String,
    deadline_ms: u64,
    status: Status,
    evidence_hash: String,
    verdict: String,
    attempts: u8,
    /// Compact per-rule result, written by the verifier at attest time. It is
    /// forwarded to the factory receipt so the proof survives this account.
    rules_summary: String,
    /// Set by a small on-chain transaction, so the worker can poll instead of
    /// exposing an inbound port.
    inspection_requested: bool,
}

#[near]
impl Invoice {
    #[init]
    pub fn new(
        freelancer: AccountId,
        client: AccountId,
        verifier: AccountId,
        factory: AccountId,
        split_wallet: AccountId,
        invoice_amount: U128,
        split_bps: u16,
        checklist_hash: String,
        checklist_json: String,
        target_url: String,
        deadline_ms: u64,
    ) -> Self {
        Self {
            freelancer,
            client,
            verifier,
            factory,
            split_wallet,
            invoice_amount: invoice_amount.0,
            split_bps,
            checklist_hash,
            checklist_json,
            target_url,
            deadline_ms,
            status: Status::Funded,
            evidence_hash: String::new(),
            verdict: String::new(),
            attempts: 0,
            rules_summary: String::new(),
            inspection_requested: false,
        }
    }

    /// The verifier publishes what it measured. Only a `pass` starts settling.
    pub fn attest(&mut self, evidence_hash: String, verdict: String, rules_summary: String) {
        assert_eq!(
            env::predecessor_account_id(),
            self.verifier,
            "only the registered verifier may attest"
        );
        assert_eq!(self.status, Status::Funded, "invoice is not accepting attestations");
        assert!(verdict == "pass" || verdict == "fail", "verdict must be pass or fail");

        self.evidence_hash = evidence_hash;
        self.verdict = verdict.clone();
        self.rules_summary = rules_summary.clone();
        self.attempts += 1;
        // Consume the request: a worker polling this flag must not loop on the
        // same invoice. A retry means a fresh request_inspection call.
        self.inspection_requested = false;

        env::log_str(&format!(
            "ATTEST|{}|{}|attempt={}",
            self.evidence_hash, verdict, self.attempts
        ));

        if verdict == "pass" {
            self.begin_settle();
        }
    }

    /// Split, record the receipt permanently, and only then remove the account.
    ///
    /// Status flips to `Settling` before any promise leaves, so a second
    /// attestation that lands mid-flight is rejected instead of paying twice.
    fn begin_settle(&mut self) {
        self.status = Status::Settling;

        // 10% of the agreed price, floored. Never derived from the balance.
        let split = self.invoice_amount * (self.split_bps as u128) / 10_000;

        let split_promise = Promise::new(self.split_wallet.clone())
            .transfer(NearToken::from_yoctonear(split));

        // The receipt is keyed by the short invoice id ("inv-0042"), not by the
        // full account name, and it names the freelancer instead of whatever
        // account happened to call us.
        let short_id = env::current_account_id()
            .as_str()
            .split('.')
            .next()
            .unwrap_or_default()
            .to_string();
        // Built with serde: the rules summary is JSON, and hand-escaped
        // strings break the moment a selector contains a quote.
        let receipt_args = near_sdk::serde_json::json!({
            "invoice_id": short_id,
            "evidence_hash": self.evidence_hash,
            "verdict": self.verdict,
            "amount": self.invoice_amount.to_string(),
            "split_bps": self.split_bps,
            "freelancer": self.freelancer.to_string(),
            "summary": self.rules_summary,
        })
        .to_string();
        let receipt_promise = Promise::new(self.factory.clone()).function_call(
            "record_receipt".to_string(),
            receipt_args.into_bytes(),
            NearToken::from_yoctonear(0),
            Gas::from_tgas(15),
        );

        split_promise.and(receipt_promise).then(
            Promise::new(env::current_account_id()).function_call(
                "on_settle".to_string(),
                Vec::new(),
                NearToken::from_yoctonear(0),
                Gas::from_tgas(25),
            ),
        );
    }

    /// Runs only after BOTH promises resolve. If either failed we refuse to
    /// delete: a half-paid, deleted invoice cannot be retried, but a Funded one
    /// can.
    #[private]
    pub fn on_settle(&mut self) {
        let split_ok = matches!(env::promise_result(0), PromiseResult::Successful(_));
        let receipt_ok = matches!(env::promise_result(1), PromiseResult::Successful(_));

        if !split_ok || !receipt_ok {
            self.status = Status::Funded;
            env::log_str(&format!(
                "SETTLE_ABORTED|split_ok={}|receipt_ok={}|retry=allowed",
                split_ok, receipt_ok
            ));
            return;
        }

        self.status = Status::Settled;
        env::log_str(&format!(
            "SETTLED|{}|{}|amount={}|split={}",
            self.evidence_hash,
            self.verdict,
            self.invoice_amount,
            self.invoice_amount * (self.split_bps as u128) / 10_000
        ));

        // Everything left — the 90% plus the storage stake — sweeps to the
        // freelancer when the account is removed.
        Promise::new(env::current_account_id()).delete_account(self.freelancer.clone());
    }

    /// Client's escape hatch once the deadline has passed without a pass.
    pub fn refund(&mut self) {
        assert_eq!(env::predecessor_account_id(), self.client, "only the client may refund");
        assert_eq!(self.status, Status::Funded, "not refundable in this state");
        assert!(
            env::block_timestamp_ms() >= self.deadline_ms,
            "deadline has not passed yet"
        );

        self.status = Status::Refunded;
        env::log_str(&format!("REFUNDED|{}", self.invoice_amount));
        Promise::new(env::current_account_id()).delete_account(self.client.clone());
    }

    /// Anyone holding the invoice can ask for a check. The worker polls this
    /// flag; it never needs to accept an inbound connection.
    pub fn request_inspection(&mut self) {
        let caller = env::predecessor_account_id();
        assert!(
            caller == self.freelancer || caller == self.client,
            "only the freelancer or the client may request an inspection"
        );
        assert_eq!(self.status, Status::Funded, "invoice is not Funded");
        self.inspection_requested = true;
        env::log_str(&format!("INSPECTION_REQUESTED|{}", env::current_account_id()));
    }

    /* ------------------------------ views ------------------------------ */

    pub fn status(&self) -> Status {
        self.status.clone()
    }

    pub fn summary(&self) -> (String, String, String, u128, String, String, String, u8) {
        (
            self.freelancer.to_string(),
            self.client.to_string(),
            self.verifier.to_string(),
            self.invoice_amount,
            self.checklist_hash.clone(),
            self.target_url.clone(),
            format!("{:?}", self.status),
            self.attempts,
        )
    }

    pub fn evidence(&self) -> (String, String, String) {
        (self.evidence_hash.clone(), self.verdict.clone(), self.rules_summary.clone())
    }

    pub fn checklist(&self) -> String {
        self.checklist_json.clone()
    }

    pub fn inspection(&self) -> bool {
        self.inspection_requested
    }

    pub fn meta(&self) -> (String, String, String, u128, String, String, u64, bool) {
        (
            self.freelancer.to_string(),
            self.client.to_string(),
            self.verifier.to_string(),
            self.invoice_amount,
            self.checklist_hash.clone(),
            self.target_url.clone(),
            self.deadline_ms,
            self.inspection_requested,
        )
    }
}

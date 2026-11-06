//! SpecLock factory — mints invoice accounts and keeps the permanent receipts.
//!
//! An invoice account is disposable: it is deleted the moment it settles. If the
//! proof only lived there, settling would destroy the evidence. So the factory
//! holds `record_receipt`, and the invoice contract is not allowed to delete
//! itself until the factory has answered.
//!
//! The sub-account is created with NO AddKey action on purpose. A key would mean
//! a human could move the escrow; no key means only the deployed code can, and
//! the code only pays out on an attested pass.
use near_sdk::json_types::U128;
use near_sdk::store::LookupMap;
use near_sdk::{
    env, near, near_bindgen, AccountId, Gas, NearToken, PanicOnDefault, Promise,
};

/// The invoice contract, compiled in. Deployed into every invoice account.
const INVOICE_WASM: &[u8] = include_bytes!("../../invoice/target/wasm32-unknown-unknown/release/speclock_invoice.wasm");

/// Enough to cover the code's storage stake plus the account record. Refunded
/// to the freelancer when the invoice account is deleted.
const STORAGE_BUFFER: u128 = 2_100_000_000_000_000_000_000_000; // 2.1 NEAR

#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct Receipt {
    pub invoice_id: String,
    pub evidence_hash: String,
    pub verdict: String,
    pub amount: String,
    pub freelancer: String,
    pub at_ms: u64,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Factory {
    receipts: LookupMap<String, Receipt>,
    count: u64,
    /// Every invoice this factory has minted, oldest first. The verifier polls
    /// this instead of asking anyone for a list.
    invoice_ids: Vec<String>,
    version: u32,
    /// Per-rule results, keyed by short invoice id. Lives here because the
    /// invoice account is deleted on settlement and would take the proof with
    /// it.
    summaries: LookupMap<String, String>,
}

#[near]
impl Factory {
    #[init]
    pub fn new() -> Self {
        Self {
            // The invoice code lives in this contract's binary, not in its
            // state: storing it twice would double the storage stake.
            receipts: LookupMap::new(b"r"),
            count: 0,
            invoice_ids: Vec::new(),
            version: 3,
            summaries: LookupMap::new(b"s"),
        }
    }

    /// Layout changed twice: v1 had receipts only, v2 added the invoice list,
    /// v3 adds per-rule summaries. Borsh has no field defaults, so the stored
    /// bytes must be read in their previous shape and written back in the new
    /// one — otherwise every method traps on deserialize.
    #[init(ignore_state)]
    #[private]
    pub fn migrate() -> Self {
        #[derive(near_sdk::borsh::BorshDeserialize)]
        struct OldV2 {
            receipts: LookupMap<String, Receipt>,
            count: u64,
            invoice_ids: Vec<String>,
            version: u32,
        }
        let old: OldV2 = env::state_read().expect("prior state does not match v2");
        env::log_str(&format!("MIGRATED|from={}|invoices={}", old.version, old.invoice_ids.len()));
        Self {
            receipts: old.receipts,
            count: old.count,
            invoice_ids: old.invoice_ids,
            version: 3,
            summaries: LookupMap::new(b"s"),
        }
    }

    /// Mint an invoice account. The deposit must cover the invoice plus storage.
    ///
    /// Returns a promise chain: create → fund → deploy → init, with no AddKey
    /// anywhere in it.
    #[payable]
    pub fn create_invoice(
        &mut self,
        invoice_id: String,
        freelancer: AccountId,
        client: AccountId,
        verifier: AccountId,
        split_wallet: AccountId,
        amount: U128,
        split_bps: u16,
        checklist_hash: String,
        checklist_json: String,
        target_url: String,
        deadline_ms: u64,
    ) -> Promise {
        let factory_id = env::current_account_id();
        let account: AccountId = format!("{}.{}", invoice_id, factory_id)
            .parse()
            .unwrap_or_else(|_| env::panic_str("invalid invoice id"));

        let deposit = env::attached_deposit().as_yoctonear();
        let needed = amount.0 + STORAGE_BUFFER;
        assert!(
            deposit >= needed,
            "deposit must cover amount + {} yocto storage buffer",
            STORAGE_BUFFER
        );

        // Built with serde, not format!: the checklist is JSON, and hand-built
        // strings break the moment someone quotes something.
        let init_args = near_sdk::serde_json::json!({
            "freelancer": freelancer,
            "client": client,
            "verifier": verifier,
            "factory": factory_id,
            "split_wallet": split_wallet,
            "invoice_amount": amount.0.to_string(),
            "split_bps": split_bps,
            "checklist_hash": checklist_hash,
            "checklist_json": checklist_json,
            "target_url": target_url,
            "deadline_ms": deadline_ms,
        })
        .to_string();

        self.invoice_ids.push(invoice_id.clone());
        env::log_str(&format!(
            "INVOICE_MINTED|{}|amount={}|checklist={}",
            account, amount.0, checklist_hash
        ));

        Promise::new(account)
            .create_account()
            .transfer(NearToken::from_yoctonear(deposit))
            .deploy_contract(INVOICE_WASM.to_vec())
            .function_call(
                "new".to_string(),
                init_args.into_bytes(),
                NearToken::from_yoctonear(0),
                Gas::from_tgas(80),
            )
    }

    /// Called by an invoice account right before it deletes itself.
    ///
    /// Only children of this factory may write here, so nobody can forge a
    /// receipt for an invoice that was never verified.
    pub fn record_receipt(
        &mut self,
        invoice_id: String,
        evidence_hash: String,
        verdict: String,
        amount: String,
        freelancer: String,
        summary: String,
    ) {
        let predecessor = env::predecessor_account_id().to_string();
        let suffix = format!(".{}", env::current_account_id());
        assert!(
            predecessor.ends_with(&suffix),
            "only invoice accounts of this factory may record receipts"
        );

        let receipt_key = invoice_id.clone();
        self.receipts.insert(
            invoice_id.clone(),
            Receipt {
                invoice_id,
                evidence_hash,
                verdict,
                amount,
                freelancer,
                at_ms: env::block_timestamp_ms(),
            },
        );
        self.summaries.insert(receipt_key, summary);
        self.count += 1;
        env::log_str("RECEIPT_RECORDED");
    }

    pub fn get_receipt(&self, invoice_id: String) -> Option<Receipt> {
        self.receipts.get(&invoice_id).cloned()
    }

    /// Per-rule results from the attestation, kept after the invoice account
    /// deletes itself.
    pub fn get_summary(&self, invoice_id: String) -> Option<String> {
        self.summaries.get(&invoice_id).cloned()
    }

    pub fn receipt_count(&self) -> u64 {
        self.count
    }

    /// Deduped: a mint that failed after the id was pushed leaves a phantom
    /// entry, and the UI should not render the same invoice twice.
    pub fn list_invoices(&self) -> Vec<String> {
        let mut out: Vec<String> = Vec::new();
        for id in &self.invoice_ids {
            if !out.contains(id) {
                out.push(id.clone());
            }
        }
        out
    }

    pub fn version(&self) -> u32 {
        self.version
    }

    pub fn invoice_wasm_len(&self) -> u64 {
        INVOICE_WASM.len() as u64
    }
}

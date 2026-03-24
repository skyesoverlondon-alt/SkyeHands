# Wallet model

## Currency

The default internal unit is `SKYFUEL`.

## Wallet scopes

Starter pack assumes one app token maps to one wallet.

You can later add:

- org wallets
- sub-wallets
- user wallets
- promo wallets

## Ledger operations

### reserve
Before an upstream route executes, estimate burn and reserve the amount.

### finalize
After usage returns, debit actual burn and refund the difference.

### refund
If the request fails after reserve, refund the full reserved amount.

### credit
Admin route can top up wallet balance.

## Recommended production extension

Add a parent-child wallet model later:

- org wallet -> app wallet -> user spend trace

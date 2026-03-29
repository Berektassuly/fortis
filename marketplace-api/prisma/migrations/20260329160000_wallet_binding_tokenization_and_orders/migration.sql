ALTER TABLE "listings"
ADD COLUMN "city" TEXT,
ADD COLUMN "rooms" INTEGER,
ADD COLUMN "seller_wallet_address" TEXT,
ADD COLUMN "tokenization_status" TEXT NOT NULL DEFAULT 'draft',
ADD COLUMN "tokenization_error" TEXT;

ALTER TABLE "orders"
ADD COLUMN "fortis_request_id" TEXT,
ADD COLUMN "buyer_wallet_address" TEXT,
ADD COLUMN "seller_wallet_address" TEXT,
ADD COLUMN "token_mint_address" TEXT,
ADD COLUMN "nonce" TEXT,
ADD COLUMN "error_message" TEXT;

CREATE UNIQUE INDEX "orders_fortis_request_id_key"
ON "orders" ("fortis_request_id")
WHERE "fortis_request_id" IS NOT NULL;

CREATE UNIQUE INDEX "orders_nonce_key"
ON "orders" ("nonce")
WHERE "nonce" IS NOT NULL;

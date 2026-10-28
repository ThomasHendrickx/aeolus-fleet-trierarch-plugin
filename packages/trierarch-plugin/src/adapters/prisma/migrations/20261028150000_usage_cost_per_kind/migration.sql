-- The estimated cost per token kind (the usage design, U14). Nothing writes these tables yet,
-- so the columns are replaced rather than filled from the old ones.
-- AlterTable
ALTER TABLE "usage_hours" DROP COLUMN "estimated_cost_usd",
ADD COLUMN     "estimated_cost_cache_read_usd" DECIMAL(18,6),
ADD COLUMN     "estimated_cost_cache_write_usd" DECIMAL(18,6),
ADD COLUMN     "estimated_cost_input_usd" DECIMAL(18,6),
ADD COLUMN     "estimated_cost_output_usd" DECIMAL(18,6);

-- AlterTable
ALTER TABLE "usage_days" DROP COLUMN "estimated_cost_usd",
DROP COLUMN "unpriced_tokens",
ADD COLUMN     "estimated_cost_cache_read_usd" DECIMAL(18,6) NOT NULL,
ADD COLUMN     "estimated_cost_cache_write_usd" DECIMAL(18,6) NOT NULL,
ADD COLUMN     "estimated_cost_input_usd" DECIMAL(18,6) NOT NULL,
ADD COLUMN     "estimated_cost_output_usd" DECIMAL(18,6) NOT NULL,
ADD COLUMN     "unpriced_cache_read" BIGINT NOT NULL,
ADD COLUMN     "unpriced_cache_write" BIGINT NOT NULL,
ADD COLUMN     "unpriced_input" BIGINT NOT NULL,
ADD COLUMN     "unpriced_output" BIGINT NOT NULL;


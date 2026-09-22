-- Each restaurant table gets its own identity color on the floor plan.
-- NULL means "auto-assign from the shared palette by table number".
ALTER TABLE "restaurant_tables" ADD COLUMN "color" TEXT;

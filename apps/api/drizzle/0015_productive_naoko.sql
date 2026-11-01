ALTER TABLE "listings" ADD COLUMN "search_text" text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE FUNCTION fayda_search_text(title text, tags text[], category text, description text, shop_name text, handle text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT lower(coalesce(title, '') || ' ' || coalesce(array_to_string(tags, ' '), '') || ' ' || coalesce(category, '') || ' ' || coalesce(shop_name, '') || ' ' || coalesce(handle, '') || ' ' || coalesce(description, ''))
$$;--> statement-breakpoint
CREATE FUNCTION fayda_listings_search_text_trg() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.search_text := fayda_search_text(NEW.title, NEW.tags, NEW.category, NEW.description,
    (SELECT s.name FROM sellers s WHERE s.id = NEW.seller_id), (SELECT s.handle FROM sellers s WHERE s.id = NEW.seller_id));
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER listings_search_text BEFORE INSERT OR UPDATE OF title, tags, category, description, seller_id ON listings
  FOR EACH ROW EXECUTE FUNCTION fayda_listings_search_text_trg();--> statement-breakpoint
CREATE FUNCTION fayda_sellers_search_text_trg() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE listings l SET search_text = fayda_search_text(l.title, l.tags, l.category, l.description, NEW.name, NEW.handle) WHERE l.seller_id = NEW.id;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER sellers_search_text AFTER UPDATE OF name, handle ON sellers
  FOR EACH ROW WHEN (OLD.name IS DISTINCT FROM NEW.name OR OLD.handle IS DISTINCT FROM NEW.handle) EXECUTE FUNCTION fayda_sellers_search_text_trg();--> statement-breakpoint
UPDATE listings l SET search_text = fayda_search_text(l.title, l.tags, l.category, l.description, s.name, s.handle) FROM sellers s WHERE s.id = l.seller_id;--> statement-breakpoint
CREATE INDEX "listings_search_trgm_idx" ON "listings" USING gin ("search_text" gin_trgm_ops);

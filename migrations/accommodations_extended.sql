-- Extended accommodation fields used by AdminPanel AccommodationForm / Accommodations pages.
-- Safe to run multiple times: application also adds missing columns on startup.

ALTER TABLE accommodations
  ADD COLUMN IF NOT EXISTS meta_title VARCHAR(255) NULL,
  ADD COLUMN IF NOT EXISTS meta_description TEXT NULL,
  ADD COLUMN IF NOT EXISTS page_heading VARCHAR(255) NULL,
  ADD COLUMN IF NOT EXISTS image_details LONGTEXT NULL,
  ADD COLUMN IF NOT EXISTS room_numbers LONGTEXT NULL,
  ADD COLUMN IF NOT EXISTS activities LONGTEXT NULL,
  ADD COLUMN IF NOT EXISTS meal_details LONGTEXT NULL,
  ADD COLUMN IF NOT EXISTS how_to_reach LONGTEXT NULL,
  ADD COLUMN IF NOT EXISTS nearby_places LONGTEXT NULL,
  ADD COLUMN IF NOT EXISTS rules_and_policies LONGTEXT NULL,
  ADD COLUMN IF NOT EXISTS faqs LONGTEXT NULL,
  ADD COLUMN IF NOT EXISTS guest_stories LONGTEXT NULL,
  ADD COLUMN IF NOT EXISTS max_adults INT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS max_children INT NULL DEFAULT 0;

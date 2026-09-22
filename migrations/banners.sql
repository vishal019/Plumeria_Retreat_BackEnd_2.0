-- Banners table migration
CREATE TABLE IF NOT EXISTS banners (
  id INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  subtitle VARCHAR(255) NULL,
  image_url TEXT NOT NULL,
  button_name VARCHAR(100) NULL DEFAULT 'Explore Stays',
  button_link VARCHAR(255) NULL DEFAULT '#campsites',
  accommodation_id INT NULL,
  badge_text VARCHAR(100) NULL,
  sort_order INT DEFAULT 0,
  active TINYINT(1) DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

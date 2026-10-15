-- Development-only accounts. No provider grants or sessions are created.
INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES
  ('local-owner', 'Local owner', 'owner@hasaweb.invalid', 0, 1792022400000, 1792022400000),
  ('local-example', 'Local example', 'example@hasaweb.invalid', 0, 1792022400000, 1792022400000)
ON CONFLICT(id) DO NOTHING;
INSERT INTO portfolio (id, user_id, draft, created_at, updated_at) VALUES
  ('local-portfolio', 'local-owner', '{"schemaVersion":1,"profile":{"name":"","bio":"","faceReveal":{"enabled":false}},"links":[],"components":[],"appearance":{"themeId":"default","fontId":"default","colorMode":"system"},"seo":{},"samples":{}}', 1792022400000, 1792022400000),
  ('local-example-portfolio', 'local-example', '{"schemaVersion":1,"profile":{"name":"","bio":"","faceReveal":{"enabled":false}},"links":[],"components":[],"appearance":{"themeId":"default","fontId":"default","colorMode":"system"},"seo":{},"samples":{}}', 1792022400000, 1792022400000)
ON CONFLICT(user_id) DO NOTHING;

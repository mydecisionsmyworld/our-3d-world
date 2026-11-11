-- D1 database schema for shared woodland camp message board
CREATE TABLE IF NOT EXISTS visitors (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'human',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY,
  author_id TEXT NOT NULL,
  name TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  pinned INTEGER NOT NULL DEFAULT 0 CHECK(pinned IN (0,1))
);
CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL,
  name TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS likes (
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  visitor_id TEXT NOT NULL,
  PRIMARY KEY (post_id, visitor_id)
);
CREATE INDEX IF NOT EXISTS idx_posts_created ON posts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_comments_post ON comments(post_id,created_at);
CREATE INDEX IF NOT EXISTS idx_posts_author_time ON posts(author_id,created_at);
CREATE INDEX IF NOT EXISTS idx_comments_author_time ON comments(author_id,created_at);

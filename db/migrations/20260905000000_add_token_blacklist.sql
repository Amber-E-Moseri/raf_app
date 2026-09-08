-- Durable JWT token blacklist for local auth logout.
-- Stores jti (JWT ID) of logged-out tokens until their expiry time passes.
-- A cron job or scheduled cleanup removes expired rows.

create table if not exists raf.token_blacklist (
  jti        text        not null primary key,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

-- Index for fast existence checks on verify
create index if not exists token_blacklist_jti_idx on raf.token_blacklist (jti);

-- Index for efficient cleanup of expired entries
create index if not exists token_blacklist_expires_idx on raf.token_blacklist (expires_at);

-- Function to clean up expired tokens (call from cron or scheduler)
create or replace function raf.cleanup_expired_tokens() returns void language sql as $$
  delete from raf.token_blacklist where expires_at < now();
$$;

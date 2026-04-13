# Supabase Setup Guide

## 1. Create a Supabase project

1. Go to [supabase.com](https://supabase.com) and sign in
2. Click "New Project"
   - Organization: select or create one
   - Project name: `civic-newsletter`
   - Database password: generate a strong password and save it
   - Region: West US (closest to Ashland, OR)
3. Wait for the project to provision (~2 minutes)

## 2. Get your credentials

From the project dashboard → Settings → API:
- **Project URL** → put in `.env` as `SUPABASE_URL`
- **Service Role key** (under "Project API keys") → put in `.env` as `SUPABASE_SERVICE_KEY`

From Settings → Database → Connection string (URI):
- Copy the URI → put in `.env` as `SUPABASE_DB_URL`
- Replace `[YOUR-PASSWORD]` with the database password you set

## 3. Run the schema migration

Go to SQL Editor in the Supabase dashboard, then run these files in order:

1. **`sql/001_schema.sql`** — Creates all 8 tables with indexes and constraints
2. **`sql/002_seed_data.sql`** — Seeds ops_config defaults, global style_config, and Ashland city row
3. **`sql/003_ops_user_role.sql`** — Creates the restricted `ops_user` role (DML only)

**Important:** Before running `003_ops_user_role.sql`, change the password from `CHANGE_ME_BEFORE_PRODUCTION` to a real password. Then add the ops connection string to `.env` as `SUPABASE_OPS_DB_URL`.

## 4. Verify the setup

After running all three SQL files, verify:

```sql
-- Check tables exist
SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';

-- Check seed data
SELECT * FROM ops_config;
SELECT * FROM style_config;
SELECT * FROM cities;

-- Test ops_user restrictions (should fail on CREATE TABLE)
SET ROLE ops_user;
CREATE TABLE test_ddl (id int);  -- Should get "permission denied"

-- Reset role
RESET ROLE;
```

## 5. Update .env

Your `.env` should now have:
```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=eyJ...your-service-key
SUPABASE_DB_URL=postgresql://postgres:yourpassword@db.your-project.supabase.co:5432/postgres
SUPABASE_OPS_DB_URL=postgresql://ops_user:opspassword@db.your-project.supabase.co:5432/postgres
```

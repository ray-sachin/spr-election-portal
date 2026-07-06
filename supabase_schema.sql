-- ====================================================================
-- NIT Uttarakhand SPR Election Portal Database Schema
-- ====================================================================

-- --------------------------------------------------------------------
-- 1. Tables Creation
-- --------------------------------------------------------------------

-- Table: students
CREATE TABLE IF NOT EXISTS students (
    roll_no text PRIMARY KEY,
    name text NOT NULL,
    is_admin boolean DEFAULT false NOT NULL,
    has_nominated boolean DEFAULT false NOT NULL,
    has_voted boolean DEFAULT false NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL
);

-- Table: nominations
CREATE TABLE IF NOT EXISTS nominations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    candidate_roll_no text UNIQUE NOT NULL REFERENCES students(roll_no) ON DELETE CASCADE,
    statement text NOT NULL CONSTRAINT statement_length_check CHECK (char_length(statement) <= 600),
    photo_url text,
    status text DEFAULT 'pending' NOT NULL CONSTRAINT status_check CHECK (status IN ('pending', 'approved', 'rejected')),
    submitted_at timestamptz DEFAULT now() NOT NULL,
    reviewed_at timestamptz
);

-- Table: votes
CREATE TABLE IF NOT EXISTS votes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    voter_roll_no text NOT NULL REFERENCES students(roll_no) ON DELETE CASCADE,
    candidate_roll_no text NOT NULL REFERENCES nominations(candidate_roll_no) ON DELETE CASCADE,
    cast_at timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT unique_voter_candidate UNIQUE (voter_roll_no, candidate_roll_no)
);

-- Table: election_config
CREATE TABLE IF NOT EXISTS election_config (
    id integer PRIMARY KEY DEFAULT 1 CONSTRAINT single_row CHECK (id = 1),
    nomination_start timestamptz NOT NULL,
    nomination_end timestamptz NOT NULL,
    voting_start timestamptz NOT NULL,
    voting_end timestamptz NOT NULL,
    results_published boolean DEFAULT false NOT NULL,
    seats_open integer DEFAULT 2 NOT NULL
);

-- --------------------------------------------------------------------
-- 2. Seed Default Data (Super Admin & Config)
-- --------------------------------------------------------------------

-- Seed Sachin Kumar Ray (BT24CSE001) as the Super Admin
INSERT INTO students (roll_no, name, is_admin)
VALUES ('BT24CSE001', 'SACHIN KUMAR RAY', true)
ON CONFLICT (roll_no) DO UPDATE
SET is_admin = true;

-- Seed default configuration (Nomination: now to tomorrow, Voting: tomorrow to next week)
INSERT INTO election_config (id, nomination_start, nomination_end, voting_start, voting_end, results_published, seats_open)
VALUES (
    1,
    now(),
    now() + interval '1 day',
    now() + interval '1 day',
    now() + interval '3 days',
    false,
    2
)
ON CONFLICT (id) DO NOTHING;

-- --------------------------------------------------------------------
-- 3. Row-Level Security (RLS) Configuration
-- --------------------------------------------------------------------

ALTER TABLE students ENABLE ROW LEVEL SECURITY;
ALTER TABLE nominations ENABLE ROW LEVEL SECURITY;
ALTER TABLE votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE election_config ENABLE ROW LEVEL SECURITY;

-- --------------------------------------------------------------------
-- 4. Helper & Security Functions
-- --------------------------------------------------------------------

-- Helper to extract and validate roll number from authenticated user's email
CREATE OR REPLACE FUNCTION get_auth_roll_no()
RETURNS text AS $$
DECLARE
    user_email text;
    local_part text;
    roll_no text;
BEGIN
    user_email := auth.jwt() ->> 'email';
    IF user_email IS NULL THEN
        RETURN NULL;
    END IF;

    -- Verify domain is exactly @nituk.ac.in
    IF split_part(user_email, '@', 2) <> 'nituk.ac.in' THEN
        RETURN NULL;
    END IF;

    -- Extract local part
    local_part := split_part(user_email, '@', 1);

    -- Must start with bt24cse followed by digits
    IF NOT (local_part ~* '^bt24cse\d+$') THEN
        RETURN NULL;
    END IF;

    roll_no := upper(local_part);
    RETURN roll_no;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Helper to check if a roll number is an admin (Security Definer avoids RLS recursion loops)
CREATE OR REPLACE FUNCTION check_is_admin(roll_no_input text)
RETURNS boolean AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM students WHERE roll_no = roll_no_input AND is_admin = true
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- --------------------------------------------------------------------
-- 5. RLS Policies
-- --------------------------------------------------------------------

-- Students Policies
CREATE POLICY "Students can read their own record or admins can read all"
ON students FOR SELECT TO authenticated
USING (
    roll_no = get_auth_roll_no()
    OR check_is_admin(get_auth_roll_no())
);

CREATE POLICY "Admins can insert students"
ON students FOR INSERT TO authenticated
WITH CHECK (
    check_is_admin(get_auth_roll_no())
);

CREATE POLICY "Admins can update students"
ON students FOR UPDATE TO authenticated
USING (
    check_is_admin(get_auth_roll_no())
);

-- Nominations Policies
CREATE POLICY "Users can read approved nominations, admins can read all, candidates can read own"
ON nominations FOR SELECT TO authenticated
USING (
    status = 'approved'
    OR candidate_roll_no = get_auth_roll_no()
    OR check_is_admin(get_auth_roll_no())
);

CREATE POLICY "Users can insert their own nomination"
ON nominations FOR INSERT TO authenticated
WITH CHECK (
    candidate_roll_no = get_auth_roll_no()
);

CREATE POLICY "Users can update their own pending nomination during window, admins can update any"
ON nominations FOR UPDATE TO authenticated
USING (
    (
        candidate_roll_no = get_auth_roll_no()
        AND status = 'pending'
        AND (
            SELECT now() >= nomination_start AND now() <= nomination_end
            FROM election_config LIMIT 1
        )
    )
    OR check_is_admin(get_auth_roll_no())
);

CREATE POLICY "Admins can delete nominations"
ON nominations FOR DELETE TO authenticated
USING (
    check_is_admin(get_auth_roll_no())
);

-- Votes Policies (No update/delete, no direct selects for anyone)
CREATE POLICY "Users can insert their own votes"
ON votes FOR INSERT TO authenticated
WITH CHECK (
    voter_roll_no = get_auth_roll_no()
);

-- Election Config Policies
CREATE POLICY "Anyone authenticated can read configuration"
ON election_config FOR SELECT TO authenticated
USING (true);

CREATE POLICY "Only admins can update configuration"
ON election_config FOR UPDATE TO authenticated
USING (
    check_is_admin(get_auth_roll_no())
);

-- --------------------------------------------------------------------
-- 6. Trigger Functions & Triggers
-- --------------------------------------------------------------------

-- Triggers for nominations: enforce window limits
CREATE OR REPLACE FUNCTION enforce_nomination_window()
RETURNS TRIGGER AS $$
DECLARE
    cfg record;
BEGIN
    SELECT nomination_start, nomination_end INTO cfg FROM election_config LIMIT 1;
    IF cfg IS NULL THEN
        RAISE EXCEPTION 'Election configuration is missing.';
    END IF;

    IF now() < cfg.nomination_start OR now() > cfg.nomination_end THEN
        RAISE EXCEPTION 'Nomination window is closed. Enforced by database clock.';
    END IF;

    -- Automatically set has_nominated = true on student row
    UPDATE students SET has_nominated = true WHERE roll_no = NEW.candidate_roll_no;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER nominations_window_trigger
BEFORE INSERT ON nominations
FOR EACH ROW
EXECUTE FUNCTION enforce_nomination_window();

-- Triggers for nomination updates: update has_nominated if candidate changes or triggers
CREATE OR REPLACE FUNCTION handle_nomination_update()
RETURNS TRIGGER AS $$
DECLARE
    cfg record;
BEGIN
    -- If status is being updated by admin, allow it.
    -- If text/photo is updated by candidate, enforce window.
    IF OLD.status = NEW.status AND OLD.statement <> NEW.statement THEN
        SELECT nomination_start, nomination_end INTO cfg FROM election_config LIMIT 1;
        IF now() < cfg.nomination_start OR now() > cfg.nomination_end THEN
            RAISE EXCEPTION 'Nomination window is closed. Statement cannot be edited.';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER nominations_update_trigger
BEFORE UPDATE ON nominations
FOR EACH ROW
EXECUTE FUNCTION handle_nomination_update();

-- --------------------------------------------------------------------
-- 7. Secure RPC Functions
-- --------------------------------------------------------------------

-- Atomic voting submission
CREATE OR REPLACE FUNCTION cast_votes(
    voter_roll_no_input text,
    candidate_roll_nos_input text[]
)
RETURNS void AS $$
DECLARE
    cfg record;
    voter record;
    candidate_count integer;
    invalid_candidates integer;
    c_roll text;
BEGIN
    -- 1. Check voting window
    SELECT voting_start, voting_end, seats_open INTO cfg FROM election_config LIMIT 1;
    IF cfg IS NULL THEN
        RAISE EXCEPTION 'Election configuration not found.';
    END IF;
    IF now() < cfg.voting_start OR now() > cfg.voting_end THEN
        RAISE EXCEPTION 'Voting window is closed. Enforced by database clock.';
    END IF;

    -- 2. Verify voter authorization (must match authenticated user)
    IF voter_roll_no_input <> get_auth_roll_no() THEN
        RAISE EXCEPTION 'Unauthorized: Voter roll number does not match session.';
    END IF;

    -- 3. Check if voter has already voted
    SELECT * INTO voter FROM students WHERE roll_no = voter_roll_no_input;
    IF voter IS NULL THEN
        RAISE EXCEPTION 'Voter not found on the electoral roll.';
    END IF;
    IF voter.has_voted THEN
        RAISE EXCEPTION 'You have already cast your vote. Votes are locked.';
    END IF;

    -- 4. Check selection size (1 to seats_open)
    candidate_count := array_length(candidate_roll_nos_input, 1);
    IF candidate_count IS NULL OR candidate_count < 1 OR candidate_count > cfg.seats_open THEN
        RAISE EXCEPTION 'You must select between 1 and % candidates.', cfg.seats_open;
    END IF;

    -- 5. Check for duplicate selections
    IF candidate_count <> (SELECT count(distinct x) FROM unnest(candidate_roll_nos_input) x) THEN
        RAISE EXCEPTION 'Duplicate candidates selected.';
    END IF;

    -- 6. Check if all selected candidates are approved
    SELECT count(*) INTO invalid_candidates
    FROM unnest(candidate_roll_nos_input) as c
    WHERE c NOT IN (
        SELECT candidate_roll_no FROM nominations WHERE status = 'approved'
    );
    IF invalid_candidates > 0 THEN
        RAISE EXCEPTION 'One or more selected candidates are not approved for the ballot.';
    END IF;

    -- 7. Insert votes
    FOREACH c_roll IN ARRAY candidate_roll_nos_input LOOP
        INSERT INTO votes (voter_roll_no, candidate_roll_no)
        VALUES (voter_roll_no_input, c_roll);
    END LOOP;

    -- 8. Mark voter as voted
    UPDATE students
    SET has_voted = true
    WHERE roll_no = voter_roll_no_input;

END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Secure candidate statistics aggregation
CREATE OR REPLACE FUNCTION get_candidate_stats()
RETURNS TABLE(
    candidate_roll_no text, 
    name text, 
    vote_count bigint, 
    percentage numeric
) AS $$
DECLARE
    total_votes bigint;
    cfg record;
    is_admin_user boolean;
BEGIN
    -- Check permissions: must be admin OR election results must be published
    SELECT results_published INTO cfg FROM election_config LIMIT 1;
    SELECT is_admin INTO is_admin_user FROM students WHERE roll_no = get_auth_roll_no();

    IF NOT (coalesce(is_admin_user, false) OR coalesce(cfg.results_published, false)) THEN
        RAISE EXCEPTION 'Results are not published yet.';
    END IF;

    -- Count total votes cast
    SELECT count(*) INTO total_votes FROM votes;

    RETURN QUERY
    SELECT
        n.candidate_roll_no,
        s.name,
        count(v.id) as vote_count,
        CASE
            WHEN total_votes > 0 THEN round((count(v.id)::numeric / total_votes::numeric) * 100, 2)
            ELSE 0
        END as percentage
    FROM nominations n
    JOIN students s ON n.candidate_roll_no = s.roll_no
    LEFT JOIN votes v ON n.candidate_roll_no = v.candidate_roll_no
    WHERE n.status = 'approved'
    GROUP BY n.candidate_roll_no, s.name, total_votes
    ORDER BY vote_count DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Get live turnout stats (Admin only before results, public after)
CREATE OR REPLACE FUNCTION get_turnout_stats()
RETURNS TABLE(
    total_roster bigint,
    nominations_pending bigint,
    nominations_approved bigint,
    nominations_rejected bigint,
    votes_cast bigint,
    turnout_percentage numeric
) AS $$
DECLARE
    is_admin_user boolean;
    cfg record;
    total_st bigint;
    nom_pending bigint;
    nom_approved bigint;
    nom_rejected bigint;
    v_cast bigint;
    turnout_pct numeric;
BEGIN
    SELECT results_published INTO cfg FROM election_config LIMIT 1;
    SELECT is_admin INTO is_admin_user FROM students WHERE roll_no = get_auth_roll_no();

    IF NOT (coalesce(is_admin_user, false) OR coalesce(cfg.results_published, false)) THEN
        RAISE EXCEPTION 'Turnout statistics are private until results are published.';
    END IF;

    SELECT count(*) INTO total_st FROM students;
    SELECT count(*) FILTER (WHERE status = 'pending') INTO nom_pending FROM nominations;
    SELECT count(*) FILTER (WHERE status = 'approved') INTO nom_approved FROM nominations;
    SELECT count(*) FILTER (WHERE status = 'rejected') INTO nom_rejected FROM nominations;
    SELECT count(*) FILTER (WHERE has_voted = true) INTO v_cast FROM students;

    IF total_st > 0 THEN
        turnout_pct := round((v_cast::numeric / total_st::numeric) * 100, 2);
    ELSE
        turnout_pct := 0;
    END IF;

    RETURN QUERY SELECT
        total_st,
        nom_pending,
        nom_approved,
        nom_rejected,
        v_cast,
        turnout_pct;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Get time-series database function for cumulative votes (Admin only)
CREATE OR REPLACE FUNCTION get_vote_timeseries()
RETURNS TABLE(
    time_bucket timestamptz,
    cumulative_votes bigint
) AS $$
DECLARE
    is_admin_user boolean;
BEGIN
    SELECT is_admin INTO is_admin_user FROM students WHERE roll_no = get_auth_roll_no();
    IF NOT coalesce(is_admin_user, false) THEN
        RAISE EXCEPTION 'Access Denied: Admin only function.';
    END IF;

    -- Aggregate counts by time
    RETURN QUERY
    WITH vote_times AS (
        SELECT date_trunc('minute', cast_at) as vtime, count(*) as cnt
        FROM votes
        GROUP BY vtime
        ORDER BY vtime
    )
    SELECT
        vtime as time_bucket,
        sum(cnt) OVER (ORDER BY vtime ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)::bigint as cumulative_votes
    FROM vote_times;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- --------------------------------------------------------------------
-- 8. Public Verification & Fallback Helper
-- --------------------------------------------------------------------

CREATE OR REPLACE FUNCTION check_voter_exists(email_input text)
RETURNS boolean AS $$
DECLARE
    local_part text;
    roll_no_val text;
    exists_on_roll boolean;
BEGIN
    -- 1. Validate domain
    IF split_part(email_input, '@', 2) <> 'nituk.ac.in' THEN
        RETURN false;
    END IF;

    -- 2. Validate prefix
    local_part := split_part(email_input, '@', 1);
    IF NOT (local_part ~* '^bt24cse\d+$') THEN
        RETURN false;
    END IF;

    roll_no_val := upper(local_part);

    -- 3. Check if exists in students table
    SELECT EXISTS (
        SELECT 1 FROM students WHERE roll_no = roll_no_val
    ) INTO exists_on_roll;

    RETURN exists_on_roll;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant public execution permission
GRANT EXECUTE ON FUNCTION check_voter_exists(text) TO anon, authenticated;

-- --------------------------------------------------------------------
-- 9. Auth Users Trigger for strict OAuth/OTP Signup Checks
-- --------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.check_new_user_eligibility()
RETURNS TRIGGER AS $$
DECLARE
    local_part text;
    roll_no_val text;
    exists_on_roll boolean;
BEGIN
    -- Only validate if email is provided
    IF NEW.email IS NULL THEN
        RAISE EXCEPTION 'Email is required for authentication.';
    END IF;

    -- 1. Validate domain
    IF split_part(NEW.email, '@', 2) <> 'nituk.ac.in' THEN
        RAISE EXCEPTION 'Access Denied: Only @nituk.ac.in emails are allowed.';
    END IF;

    -- 2. Validate local part format
    local_part := split_part(NEW.email, '@', 1);
    IF NOT (local_part ~* '^bt24cse\d+$') THEN
        RAISE EXCEPTION 'Access Denied: Email must be in the format bt24cseNN@nituk.ac.in.';
    END IF;

    roll_no_val := upper(local_part);

    -- 3. Check if they exist in the students table
    SELECT EXISTS (
        SELECT 1 FROM public.students WHERE roll_no = roll_no_val
    ) INTO exists_on_roll;

    IF NOT exists_on_roll THEN
        RAISE EXCEPTION 'Access Denied: This roll number is not on the electoral roll.';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Bind trigger to auth.users (before insert)
DROP TRIGGER IF EXISTS on_auth_user_signup ON auth.users;
CREATE TRIGGER on_auth_user_signup
BEFORE INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.check_new_user_eligibility();



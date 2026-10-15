-- Flight instructors and their students: a student asks an instructor in,
-- the instructor sees the student's way to the checkride, reviews each
-- solo cross-country's planning and signs endorsements in the app.

-- The pilot's name as their certificate gives it, which an endorsement
-- names them by (AC 61-65K, appendix A: "[First name, MI, Last name]");
-- the sign-in's display name may be anything. Null until they say.
ALTER TABLE pilots ADD COLUMN full_name VARCHAR(120);

-- A flight instructor's certificate, as every endorsement they sign
-- carries it (AC 61-65K, appendix A: "the instructor's signature, date of
-- signature, ... certificate number, and flight instructor recent
-- experience (RE) end date or certificate expiration date"): the number
-- (987654321CFI), the date, and which of the two the date is. Null for a
-- pilot who is not an instructor.
ALTER TABLE pilots ADD COLUMN instructor_certificate VARCHAR(20);
ALTER TABLE pilots ADD COLUMN instructor_until DATE;
ALTER TABLE pilots ADD COLUMN instructor_until_kind VARCHAR(3) CHECK (instructor_until_kind IN ('RE', 'EXP'));
ALTER TABLE pilots ADD CONSTRAINT pilots_instructor_whole CHECK (
    (instructor_certificate IS NULL) = (instructor_until IS NULL)
    AND (instructor_until IS NULL) = (instructor_until_kind IS NULL));

-- A student's instructor: asked by address, answered when someone signed
-- in with that address takes it (instructor_id set). Either may end it,
-- and it goes with either account.
CREATE TABLE instructor_students (
    id BIGSERIAL PRIMARY KEY,
    student_id BIGINT NOT NULL REFERENCES pilots (id) ON DELETE CASCADE,
    email VARCHAR(320) NOT NULL,
    instructor_id BIGINT REFERENCES pilots (id) ON DELETE CASCADE,
    asked_at TIMESTAMPTZ NOT NULL,
    accepted_at TIMESTAMPTZ,
    UNIQUE (student_id, email)
);
CREATE INDEX idx_instructor_students_email ON instructor_students (lower(email)) WHERE instructor_id IS NULL;
CREATE INDEX idx_instructor_students_instructor ON instructor_students (instructor_id);

-- An endorsement an instructor signed in the app: its words as signed,
-- the fields they were filled in from, and the signature line. Never
-- edited: a correction voids it and a new one is signed (AC 120-78B,
-- 2.2.7 and 2.2.8), and the digest of what was signed shows it unaltered.
-- The student keeps theirs when the instructor's account goes, and the
-- instructor keeps the record 14 CFR 61.189(b) asks of them, for the 3
-- years of 61.189(c), when the student's goes: hence SET NULL, and the
-- student's name kept on the row.
CREATE TABLE signed_endorsements (
    id BIGSERIAL PRIMARY KEY,
    student_id BIGINT REFERENCES pilots (id) ON DELETE SET NULL,
    instructor_id BIGINT REFERENCES pilots (id) ON DELETE SET NULL,
    code VARCHAR(40) NOT NULL,
    student_name VARCHAR(120) NOT NULL,
    fields JSONB NOT NULL,
    text VARCHAR(2000) NOT NULL,
    signature VARCHAR(200) NOT NULL,
    signed_on DATE NOT NULL,
    signed_at TIMESTAMPTZ NOT NULL,
    digest VARCHAR(64) NOT NULL,
    voided_at TIMESTAMPTZ
);
CREATE INDEX idx_signed_endorsements_student ON signed_endorsements (student_id);
CREATE INDEX idx_signed_endorsements_instructor ON signed_endorsements (instructor_id, signed_at);

-- A student's saved flight put to their instructor for the review 14 CFR
-- 61.93(c)(3) and (d) ask before each solo cross-country: answered by the
-- endorsement signed for it, or turned down with a note. Goes with the
-- student's account or the flight; the endorsement, once signed, stays.
CREATE TABLE cross_country_reviews (
    id BIGSERIAL PRIMARY KEY,
    student_id BIGINT NOT NULL REFERENCES pilots (id) ON DELETE CASCADE,
    instructor_id BIGINT NOT NULL REFERENCES pilots (id) ON DELETE CASCADE,
    flight_id BIGINT NOT NULL REFERENCES flights (id) ON DELETE CASCADE,
    make_model VARCHAR(80) NOT NULL,
    flight_on DATE NOT NULL,
    note VARCHAR(500),
    asked_at TIMESTAMPTZ NOT NULL,
    endorsement_id BIGINT REFERENCES signed_endorsements (id) ON DELETE SET NULL,
    declined_note VARCHAR(500),
    answered_at TIMESTAMPTZ
);
CREATE INDEX idx_cross_country_reviews_instructor ON cross_country_reviews (instructor_id, answered_at);
CREATE INDEX idx_cross_country_reviews_student ON cross_country_reviews (student_id);

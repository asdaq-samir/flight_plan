-- An instrument approach an instructor sets a student to learn in the
-- app's approach lesson (ApproachLesson: Brief, Fly, Quiz), with a note
-- of theirs at any of its fixes and a day to have it done by; and how far
-- the student has come with it -- briefed, flown, and their last quiz's
-- answers -- which the student's app reports as they go.
--
-- The approach as the planner's procedures name it (the FAA's CIFP, the
-- cycle it was picked in): the field's identifier, the procedure's id
-- ("I09", "R26-Y") and its name as the plate titles it, kept so the list
-- says it without asking the planner.
--
-- Teaching, not a record the regulations ask anyone to keep (an
-- endorsement is, signed_endorsements): it goes with either account, and
-- with the link between the two when either ends it (InstructorService).
CREATE TABLE approach_lessons (
    id BIGSERIAL PRIMARY KEY,
    student_id BIGINT NOT NULL REFERENCES pilots (id) ON DELETE CASCADE,
    instructor_id BIGINT NOT NULL REFERENCES pilots (id) ON DELETE CASCADE,
    airport_ident VARCHAR(5) NOT NULL,
    procedure_id VARCHAR(6) NOT NULL,
    procedure_name VARCHAR(80) NOT NULL,
    cycle VARCHAR(8),
    -- {"PYKLA": "Power to 1,800 rpm, gear down"}: the fix's identifier as
    -- the procedure's drawing has it, and the instructor's words.
    fix_notes JSONB NOT NULL DEFAULT '{}'::jsonb,
    due_on DATE,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    -- The student's progress: when they first finished the brief and
    -- flew it to its end, and their latest quiz -- each answer's question,
    -- the choice made and whether it was right -- of how many questions.
    briefed_at TIMESTAMPTZ,
    flown_at TIMESTAMPTZ,
    quiz_answers JSONB,
    quiz_of INTEGER CHECK (quiz_of IS NULL OR quiz_of BETWEEN 1 AND 40),
    quiz_at TIMESTAMPTZ,
    CHECK ((quiz_answers IS NULL) = (quiz_of IS NULL) AND (quiz_of IS NULL) = (quiz_at IS NULL))
);
CREATE INDEX idx_approach_lessons_student ON approach_lessons (student_id, created_at);
CREATE INDEX idx_approach_lessons_instructor ON approach_lessons (instructor_id, student_id);

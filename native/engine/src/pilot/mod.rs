//! The pilot's own records and what the pilot brings in as text: a
//! checklist typed or pasted (checklist), the logbook to and from a CSV
//! file, ForeFlight's export among them (csv, logbook), a handbook's
//! specifications page read off a photo (handbook), and endorsements --
//! which are in force, an instructor's lapsed date, the words signed, the
//! ACS codes of a knowledge test report (endorsements). Moved from the
//! web app's lib/checklist, lib/logbookCsv, lib/handbookText,
//! lib/endorsements and lib/checkride, which the iPhone app copied, so
//! both read a pilot's text alike; `js` holds JavaScript's own reading of
//! text and numbers, which those were first written in.

pub mod checklist;
pub mod csv;
pub mod endorsements;
pub mod handbook;
pub mod js;
pub mod logbook;

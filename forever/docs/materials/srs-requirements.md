# Writing Requirements That Can't Be Misread: The Clinic Booking System

## 1. One system, all of requirements engineering

Sadia is specifying a clinic appointment-booking system for a Dhaka hospital. Every
requirement she writes will be read by developers, testers, and lawyers who were not in the
room. The whole discipline is making one sentence mean exactly one thing to all of them. We
use EARS (Easy Approach to Requirements Syntax, from Rolls-Royce, used by NASA and Airbus)
to make each requirement unambiguous and testable.

## 2. The cost of ambiguity

A vague requirement — "the system should be fast" — cannot be built or tested. How fast?
Measured how? Under what load? Ambiguity is not a small problem: studies of failed software
projects trace a large share of defects back to requirements, and a requirement fixed at
specification time costs far less than the same defect caught in production. The requirement
is where quality is cheapest to build in.

## 3. A requirement is testable or it is nothing

The test for a good requirement: can you write a pass/fail test for it? "The system should be
user-friendly" — no test exists, so it is a wish, not a requirement. "When a user submits a
booking, the system shall confirm it within 2 seconds" — a stopwatch settles it. Every
requirement must name a trigger, a system, and a single observable response.

## 4. EARS: the five patterns

EARS constrains every requirement to one shape: "While <precondition>, when <trigger>, the
<system> shall <response>." Five patterns cover everything:

- UBIQUITOUS (always true): "The system shall encrypt all patient records at rest."
- EVENT-DRIVEN (when X happens): "When a patient cancels, the system shall release the slot."
- STATE-DRIVEN (while in a state): "While the clinic is closed, the system shall queue
  requests for the next open day."
- UNWANTED BEHAVIOR (error handling): "If the payment fails, then the system shall notify the
  patient and hold the slot for 10 minutes."
- OPTIONAL FEATURE (where present): "Where SMS is enabled, the system shall send a reminder 24
  hours before the appointment."

## 5. One "shall" per requirement

A requirement with two "shall" clauses is two requirements hiding as one — and testers will
verify one and miss the other. "The system shall confirm the booking and shall email a
receipt" splits into two testable requirements. One shall, one testable response, always.

## 6. Functional vs non-functional

Functional requirements say WHAT the system does ("when a patient books, the system shall
reserve the slot"). Non-functional requirements say HOW WELL ("the system shall confirm
within 2 seconds", "the system shall support 500 concurrent users"). Non-functional
requirements are where systems quietly fail — a booking system that is functionally correct
but takes 30 seconds is unusable. Both must be specified, and both must be measurable.

## 7. The ambiguity hunt

Take a real vague requirement and find every reading: "The system should notify the doctor of
new appointments." Ambiguities: WHICH doctor (the assigned one? all?); notify HOW (SMS?
in-app?); WHEN (instantly? daily digest?); what counts as "new"? The EARS rewrite resolves
all of them: "When a patient books an appointment, the system shall send an in-app
notification to the assigned doctor within 1 minute." The vague version had at least four
readings; the EARS version has one.

## 8. Traceability

Every requirement gets an ID and links backward to the stakeholder need it serves and forward
to the test that verifies it. When a requirement changes, traceability shows exactly which
tests must be re-run and which features are affected. A requirement no test traces to is
either untested or unnecessary — both are defects in the specification.

## 9. The misconception that produces unbuildable specs

"Requirements should describe the solution in detail." No — requirements state WHAT is needed
and HOW WELL, never HOW to build it. "The system shall store bookings in a PostgreSQL table
with a B-tree index" is a design decision masquerading as a requirement; it over-constrains
the developer and will be wrong when the design evolves. A requirement is a testable statement
of need; the solution is the developer's to choose. Confusing the two is how specifications
become both rigid and unbuildable.

## 10. What the model leaves out

EARS makes individual requirements clear but does not guarantee the SET is complete or
consistent — two perfectly-formed requirements can still contradict each other, and no syntax
catches a missing requirement. Structured requirements are the honest foundation; review,
prototyping, and stakeholder validation do the rest. A specification is trusted for the
ambiguity it removes and respected for admitting that clarity of each sentence is not yet
completeness of the whole.
